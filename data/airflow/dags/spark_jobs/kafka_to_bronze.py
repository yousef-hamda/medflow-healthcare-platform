"""Generic Kafka topic → Delta bronze table batch loader.

Used by the ``synthea_to_bronze``, ``hl7_to_bronze`` and ``vitals_to_bronze``
DAGs. Reads a bounded slice of a Kafka topic with the spark-sql-kafka batch
source and MERGEs it into a bronze Delta table.

Idempotency
-----------
Every record carries its ``(kafka_topic, kafka_partition, kafka_offset)``
coordinates and the table is written with a Delta ``MERGE`` keyed on those
columns: re-running a window (Airflow retry, manual re-trigger, overlapping
``--lookback-hours``) never duplicates rows. Topic retention (7 days, see
infra/docker/kafka/create-topics.sh) bounds the cost of re-reads; production
would additionally checkpoint committed offsets.

Payload formats
---------------
``fhir``   fhir.changes — FHIR resources / change events (JSON).
            Adds ``resource_type`` + ``resource_id`` columns and partitions by
            ``resource_type, ingest_date``. With ``--raw-landing-path`` the raw
            bundle JSON is also landed (text files) for replay — s3://synthea-raw.
``hl7``    hl7.raw — raw HL7v2 (MLLP payload as text). Extracts the MSH-9
            message type and MSH-10 control id; partitions by ``ingest_date``.
``vitals`` vitals.raw — device vitals JSON; extracts patient_id/device metrics
            envelope fields plus the numeric vitals themselves (so Great
            Expectations can range-check them); partitions by ``ingest_date``.
``dicom``  dicom.received — imaging-study manifest JSON emitted when a DICOM
            study lands; extracts study/patient/modality; partitions by
            ``ingest_date``.

Structured logging prints counts and offsets only — never message bodies
(bronze payloads contain PHI-shaped synthetic data; we keep good hygiene anyway).
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from typing import List

from pyspark.sql import DataFrame, SparkSession
from pyspark.sql import functions as F

logging.basicConfig(stream=sys.stdout, level=logging.INFO, format="%(message)s")
log = logging.getLogger("medflow.kafka_to_bronze")

KAFKA_BOOTSTRAP_DEFAULT = "kafka:9092"
MERGE_KEYS = ["kafka_topic", "kafka_partition", "kafka_offset"]


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--topic", required=True)
    parser.add_argument(
        "--payload-format", required=True, choices=["fhir", "hl7", "vitals", "dicom"]
    )
    parser.add_argument("--table-path", required=True, help="Delta table location (s3a://...)")
    parser.add_argument("--bootstrap-servers", default=KAFKA_BOOTSTRAP_DEFAULT)
    parser.add_argument(
        "--lookback-hours",
        type=int,
        default=0,
        help="If >0, start from now-N hours via startingOffsetsByTimestamp; "
        "0 means 'earliest' (MERGE keeps this idempotent).",
    )
    parser.add_argument(
        "--raw-landing-path",
        default=None,
        help="Optional s3a:// prefix where raw payloads are landed as JSON text "
        "(used for Synthea bundles → s3://synthea-raw).",
    )
    parser.add_argument("--run-id", default="manual", help="Airflow run id, for logs/landing prefix only")
    return parser.parse_args(argv)


def read_kafka_batch(
    spark: SparkSession, topic: str, bootstrap: str, lookback_hours: int
) -> DataFrame:
    """Bounded batch read of a topic: earliest (default) or timestamp-based start."""
    reader = (
        spark.read.format("kafka")
        .option("kafka.bootstrap.servers", bootstrap)
        .option("subscribe", topic)
        .option("endingOffsets", "latest")
        .option("failOnDataLoss", "false")
    )
    if lookback_hours > 0:
        start_ms = int(
            (spark.sql("SELECT unix_millis(current_timestamp())").collect()[0][0])
            - lookback_hours * 3600 * 1000
        )
        reader = reader.option(
            "startingOffsetsByTimestamp", json.dumps({topic: {"-1": start_ms}})
        ).option("startingOffsetsByTimestampStrategy", "latest")
    else:
        reader = reader.option("startingOffsets", "earliest")
    return reader.load()


def with_envelope(raw: DataFrame) -> DataFrame:
    """Common bronze envelope: payload + kafka coordinates + ingest metadata."""
    return raw.select(
        F.col("value").cast("string").alias("payload"),
        F.col("key").cast("string").alias("message_key"),
        F.col("topic").alias("kafka_topic"),
        F.col("partition").alias("kafka_partition"),
        F.col("offset").alias("kafka_offset"),
        F.col("timestamp").alias("kafka_timestamp"),
        F.current_timestamp().alias("ingested_at"),
        F.to_date(F.col("timestamp")).alias("ingest_date"),
    )


def shape_fhir(df: DataFrame) -> DataFrame:
    """fhir.changes: resource may arrive bare or wrapped in a change envelope."""
    return df.withColumn(
        "resource_type",
        F.coalesce(
            F.get_json_object("payload", "$.resourceType"),
            F.get_json_object("payload", "$.resource.resourceType"),
            F.lit("Unknown"),
        ),
    ).withColumn(
        "resource_id",
        F.coalesce(
            F.get_json_object("payload", "$.id"),
            F.get_json_object("payload", "$.resource.id"),
        ),
    )


def shape_hl7(df: DataFrame) -> DataFrame:
    """hl7.raw: pull MSH-9 (message type) and MSH-10 (control id) from segment 1."""
    msh = F.split(F.split(F.col("payload"), "\r|\n").getItem(0), "\\|")
    return df.withColumn("message_type", msh.getItem(8)).withColumn(
        "message_control_id", msh.getItem(9)
    )


#: vitals.raw JSON field → bronze numeric column (doubles, range-checked by GE).
VITAL_NUMERIC_FIELDS = {
    "heart_rate": "$.heartRate",
    "respiratory_rate": "$.respiratoryRate",
    "systolic_bp": "$.systolicBp",
    "diastolic_bp": "$.diastolicBp",
    "spo2": "$.spo2",
    "temperature": "$.temperature",
}


def shape_vitals(df: DataFrame) -> DataFrame:
    """vitals.raw: lift envelope fields *and* the numeric vitals out of the JSON."""
    shaped = (
        df.withColumn("patient_id", F.get_json_object("payload", "$.patientId"))
        .withColumn("device_id", F.get_json_object("payload", "$.deviceId"))
        .withColumn(
            "event_time",
            F.coalesce(
                F.to_timestamp(F.get_json_object("payload", "$.timestamp")),
                F.col("kafka_timestamp"),
            ),
        )
    )
    for column, json_path in VITAL_NUMERIC_FIELDS.items():
        shaped = shaped.withColumn(
            column, F.get_json_object("payload", json_path).cast("double")
        )
    return shaped


def shape_dicom(df: DataFrame) -> DataFrame:
    """dicom.received: imaging-study manifest — study/patient/modality envelope."""
    return (
        df.withColumn(
            "study_instance_uid",
            F.get_json_object("payload", "$.studyInstanceUid"),
        )
        .withColumn("patient_id", F.get_json_object("payload", "$.patientId"))
        .withColumn("modality", F.upper(F.get_json_object("payload", "$.modality")))
    )


SHAPERS = {
    "fhir": shape_fhir,
    "hl7": shape_hl7,
    "vitals": shape_vitals,
    "dicom": shape_dicom,
}
PARTITIONS = {
    "fhir": ["resource_type", "ingest_date"],
    "hl7": ["ingest_date"],
    "vitals": ["ingest_date"],
    "dicom": ["ingest_date"],
}


def merge_to_delta(spark: SparkSession, df: DataFrame, table_path: str, partition_cols: List[str]) -> int:
    """Idempotent MERGE on kafka coordinates; creates the table on first run."""
    from delta.tables import DeltaTable

    if df.rdd.isEmpty():
        log.info(json.dumps({"event": "no_new_messages", "table": table_path}))
        return 0
    count = df.count()
    if DeltaTable.isDeltaTable(spark, table_path):
        target = DeltaTable.forPath(spark, table_path)
        cond = " AND ".join(f"t.{k} = s.{k}" for k in MERGE_KEYS)
        (
            target.alias("t")
            .merge(df.alias("s"), cond)
            .whenNotMatchedInsertAll()
            .execute()
        )
    else:
        (
            df.write.format("delta")
            .partitionBy(*partition_cols)
            .mode("append")
            .save(table_path)
        )
    return count


def main(argv: List[str]) -> None:
    args = parse_args(argv)
    spark = SparkSession.builder.appName(f"medflow-kafka-to-bronze-{args.topic}").getOrCreate()
    spark.sparkContext.setLogLevel("WARN")

    raw = read_kafka_batch(spark, args.topic, args.bootstrap_servers, args.lookback_hours)
    shaped = SHAPERS[args.payload_format](with_envelope(raw))

    if args.raw_landing_path:
        # Land raw payload text for replay/audit; one prefix per run keeps it idempotent.
        landing = f"{args.raw_landing_path.rstrip('/')}/run_id={args.run_id}"
        shaped.select("payload").write.mode("overwrite").format("text").save(landing)
        log.info(json.dumps({"event": "raw_landed", "path": landing}))

    written = merge_to_delta(spark, shaped, args.table_path, PARTITIONS[args.payload_format])
    log.info(
        json.dumps(
            {
                "event": "bronze_load_done",
                "topic": args.topic,
                "table": args.table_path,
                "rows_read": written,
                "run_id": args.run_id,
            }
        )
    )
    spark.stop()


if __name__ == "__main__":
    main(sys.argv[1:])
