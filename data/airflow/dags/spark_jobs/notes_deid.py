"""Bronze FHIR DocumentReference → ``silver/notes_deid`` via the deid-service.

Pipeline
--------
1. Read ``bronze/fhir_resources``, keep ``DocumentReference`` rows, parse with
   an explicit schema and base64-decode the inline note attachment.
2. Deduplicate per ``note_id`` (latest Kafka offset) *before* calling the
   service so retries don't re-de-identify the same note.
3. ``mapPartitions``: POST each note body to the deid-service
   (``http://deid-service:8093/v1/deid/text``) with stdlib ``urllib`` (no extra
   deps on Spark executors).

PHI guarantee
-------------
The raw note text is **never** written to silver. If the deid-service is
unreachable or returns an error, the row is written with
``deid_status='failed'`` and a NULL body, and the job exits non-zero when the
failure ratio exceeds ``--max-failure-ratio`` so Airflow retries and the GE
gate stays closed. Logs carry counts and note ids only — never text.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import urllib.error
import urllib.request
from typing import Iterable, Iterator, List

from pyspark.sql import DataFrame, Row, SparkSession
from pyspark.sql import functions as F
from pyspark.sql import types as T
from pyspark.sql.window import Window

logging.basicConfig(stream=sys.stdout, level=logging.INFO, format="%(message)s")
log = logging.getLogger("medflow.notes_deid")

DEID_URL_DEFAULT = os.environ.get(
    "MEDFLOW_DEID_URL", "http://deid-service:8093/v1/deid/text"
)

DOC_REFERENCE_SCHEMA = T.StructType(
    [
        T.StructField("resourceType", T.StringType()),
        T.StructField("id", T.StringType()),
        T.StructField("status", T.StringType()),
        T.StructField(
            "type",
            T.StructType(
                [
                    T.StructField(
                        "coding",
                        T.ArrayType(
                            T.StructType(
                                [
                                    T.StructField("system", T.StringType()),
                                    T.StructField("code", T.StringType()),
                                    T.StructField("display", T.StringType()),
                                ]
                            )
                        ),
                    ),
                    T.StructField("text", T.StringType()),
                ]
            ),
        ),
        T.StructField(
            "subject",
            T.StructType([T.StructField("reference", T.StringType())]),
        ),
        T.StructField(
            "context",
            T.StructType(
                [
                    T.StructField(
                        "encounter",
                        T.ArrayType(
                            T.StructType(
                                [T.StructField("reference", T.StringType())]
                            )
                        ),
                    )
                ]
            ),
        ),
        T.StructField("date", T.StringType()),
        T.StructField(
            "content",
            T.ArrayType(
                T.StructType(
                    [
                        T.StructField(
                            "attachment",
                            T.StructType(
                                [
                                    T.StructField("contentType", T.StringType()),
                                    T.StructField("data", T.StringType()),
                                    T.StructField("title", T.StringType()),
                                ]
                            ),
                        )
                    ]
                )
            ),
        ),
    ]
)

OUTPUT_SCHEMA = T.StructType(
    [
        T.StructField("note_id", T.StringType(), False),
        T.StructField("patient_id", T.StringType()),
        T.StructField("encounter_id", T.StringType()),
        T.StructField("note_datetime", T.StringType()),
        T.StructField("note_type_code", T.StringType()),
        T.StructField("note_title", T.StringType()),
        T.StructField("content_type", T.StringType()),
        T.StructField("deid_text", T.StringType()),
        T.StructField("entities_json", T.StringType()),
        T.StructField("deid_status", T.StringType(), False),
    ]
)


def call_deid_service(text: str, url: str, timeout: float) -> "tuple[str, str, str]":
    """POST one note to the deid-service → (deid_text, entities_json, status)."""
    body = json.dumps({"text": text}).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception:  # noqa: BLE001 - any failure means: do NOT emit raw text
        return None, None, "failed"
    deid = payload.get("text") or payload.get("deidentified_text")
    if not deid:
        return None, None, "failed"
    return deid, json.dumps(payload.get("entities", [])), "deidentified"


def deid_partition(
    rows: Iterable[Row], url: str, timeout: float
) -> Iterator[Row]:
    for row in rows:
        raw_text = row["raw_text"]
        if raw_text:
            deid, entities, status = call_deid_service(raw_text, url, timeout)
        else:
            deid, entities, status = None, None, "empty"
        yield Row(
            note_id=row["note_id"],
            patient_id=row["patient_id"],
            encounter_id=row["encounter_id"],
            note_datetime=row["note_datetime"],
            note_type_code=row["note_type_code"],
            note_title=row["note_title"],
            content_type=row["content_type"],
            deid_text=deid,
            entities_json=entities,
            deid_status=status,
        )


def extract_notes(bronze: DataFrame) -> DataFrame:
    """DocumentReference rows → one decoded note per note_id (latest version)."""
    parsed = bronze.filter(F.col("resource_type") == "DocumentReference").withColumn(
        "r",
        F.from_json(
            F.coalesce(
                F.get_json_object(F.col("payload"), "$.resource"), F.col("payload")
            ),
            DOC_REFERENCE_SCHEMA,
        ),
    )
    notes = parsed.select(
        F.col("r.id").alias("note_id"),
        F.regexp_extract(F.col("r.subject.reference"), r"([^:/]+)$", 1).alias(
            "patient_id"
        ),
        F.regexp_extract(
            F.col("r.context.encounter")[0]["reference"], r"([^:/]+)$", 1
        ).alias("encounter_id"),
        F.col("r.date").alias("note_datetime"),
        F.col("r.type.coding")[0]["code"].alias("note_type_code"),
        F.coalesce(
            F.col("r.content")[0]["attachment"]["title"],
            F.col("r.type.coding")[0]["display"],
            F.col("r.type.text"),
        ).alias("note_title"),
        F.col("r.content")[0]["attachment"]["contentType"].alias("content_type"),
        F.unbase64(F.col("r.content")[0]["attachment"]["data"])
        .cast("string")
        .alias("raw_text"),
        F.col("kafka_offset"),
    ).filter(F.col("note_id").isNotNull())
    window = Window.partitionBy("note_id").orderBy(F.col("kafka_offset").desc())
    return (
        notes.withColumn("_rn", F.row_number().over(window))
        .filter(F.col("_rn") == 1)
        .drop("_rn", "kafka_offset")
    )


def merge_to_silver(spark: SparkSession, df: DataFrame, table_path: str) -> None:
    from delta.tables import DeltaTable

    if DeltaTable.isDeltaTable(spark, table_path):
        target = DeltaTable.forPath(spark, table_path)
        (
            target.alias("t")
            .merge(df.alias("s"), "t.note_id = s.note_id")
            .whenMatchedUpdateAll()
            .whenNotMatchedInsertAll()
            .execute()
        )
    else:
        df.write.format("delta").mode("append").save(table_path)


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-path", required=True, help="bronze fhir Delta path")
    parser.add_argument("--target-path", required=True, help="silver notes_deid path")
    parser.add_argument("--deid-url", default=DEID_URL_DEFAULT)
    parser.add_argument("--timeout-seconds", type=float, default=10.0)
    parser.add_argument(
        "--max-failure-ratio",
        type=float,
        default=0.05,
        help="Fail the job if more than this share of notes could not be "
        "de-identified (the failed rows are still written, with NULL bodies).",
    )
    parser.add_argument("--run-id", default="manual")
    return parser.parse_args(argv)


def main(argv: List[str]) -> None:
    args = parse_args(argv)
    spark = SparkSession.builder.appName("medflow-notes-deid").getOrCreate()
    spark.sparkContext.setLogLevel("WARN")

    notes = extract_notes(spark.read.format("delta").load(args.source_path))
    if notes.rdd.isEmpty():
        log.info(json.dumps({"event": "no_notes", "run_id": args.run_id}))
        spark.stop()
        return

    url, timeout = args.deid_url, args.timeout_seconds
    deidentified = spark.createDataFrame(
        notes.rdd.mapPartitions(lambda part: deid_partition(part, url, timeout)),
        schema=OUTPUT_SCHEMA,
    ).select(
        "note_id",
        "patient_id",
        "encounter_id",
        F.to_timestamp("note_datetime").alias("note_datetime"),
        "note_type_code",
        "note_title",
        "content_type",
        "deid_text",
        "entities_json",
        "deid_status",
        F.current_timestamp().alias("silver_loaded_at"),
    ).cache()

    total = deidentified.count()
    failed = deidentified.filter(F.col("deid_status") == "failed").count()
    merge_to_silver(spark, deidentified, args.target_path)
    log.info(
        json.dumps(
            {
                "event": "notes_deid_done",
                "notes": total,
                "failed": failed,
                "run_id": args.run_id,
            }
        )
    )
    if total and failed / total > args.max_failure_ratio:
        spark.stop()
        raise SystemExit(
            f"deid failure ratio {failed}/{total} exceeds {args.max_failure_ratio}"
        )
    spark.stop()


if __name__ == "__main__":
    main(sys.argv[1:])
