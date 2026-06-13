"""Bronze → Silver flattening for the MedFlow lakehouse.

One invocation flattens *one* entity:

================  =========================  ==============================
``--entity``      bronze source              silver target (Delta)
================  =========================  ==============================
patients          bronze/fhir_resources      silver/patients
encounters        bronze/fhir_resources      silver/encounters
observations      bronze/fhir_resources      silver/observations
medications       bronze/fhir_resources      silver/medications
imaging_studies   bronze/dicom_metadata      silver/imaging_studies
================  =========================  ==============================

Design rules
------------
* Payloads are parsed with **explicit** ``from_json`` schemas — never schema
  inference on PHI-shaped data; unknown fields are dropped, malformed JSON
  yields NULLs that are filtered on the natural key.
* FHIR resources may arrive bare or wrapped in a change envelope
  ``{"resource": {...}}``; both are handled.
* Rows are deduplicated per natural key keeping the highest Kafka offset
  (latest version), then MERGEd into the silver table so re-runs are
  idempotent and late retries update rather than duplicate.
* Logging emits counts and identifiers only — never payload contents.
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from typing import Callable, Dict, List, NamedTuple

from pyspark.sql import Column, DataFrame, SparkSession
from pyspark.sql import functions as F
from pyspark.sql import types as T
from pyspark.sql.window import Window

logging.basicConfig(stream=sys.stdout, level=logging.INFO, format="%(message)s")
log = logging.getLogger("medflow.bronze_to_silver")

# ───────────────────────────── shared FHIR fragments ─────────────────────────────
CODING = T.StructType(
    [
        T.StructField("system", T.StringType()),
        T.StructField("code", T.StringType()),
        T.StructField("display", T.StringType()),
    ]
)
CODEABLE_CONCEPT = T.StructType(
    [
        T.StructField("coding", T.ArrayType(CODING)),
        T.StructField("text", T.StringType()),
    ]
)
REFERENCE = T.StructType(
    [
        T.StructField("reference", T.StringType()),
        T.StructField("display", T.StringType()),
    ]
)
QUANTITY = T.StructType(
    [
        T.StructField("value", T.DoubleType()),
        T.StructField("unit", T.StringType()),
        T.StructField("system", T.StringType()),
        T.StructField("code", T.StringType()),
    ]
)
PERIOD = T.StructType(
    [
        T.StructField("start", T.StringType()),
        T.StructField("end", T.StringType()),
    ]
)

PATIENT_SCHEMA = T.StructType(
    [
        T.StructField("resourceType", T.StringType()),
        T.StructField("id", T.StringType()),
        T.StructField("gender", T.StringType()),
        T.StructField("birthDate", T.StringType()),
        T.StructField("deceasedDateTime", T.StringType()),
        T.StructField(
            "name",
            T.ArrayType(
                T.StructType(
                    [
                        T.StructField("use", T.StringType()),
                        T.StructField("family", T.StringType()),
                        T.StructField("given", T.ArrayType(T.StringType())),
                        T.StructField("prefix", T.ArrayType(T.StringType())),
                    ]
                )
            ),
        ),
        T.StructField(
            "address",
            T.ArrayType(
                T.StructType(
                    [
                        T.StructField("line", T.ArrayType(T.StringType())),
                        T.StructField("city", T.StringType()),
                        T.StructField("state", T.StringType()),
                        T.StructField("postalCode", T.StringType()),
                        T.StructField("country", T.StringType()),
                    ]
                )
            ),
        ),
        T.StructField(
            "identifier",
            T.ArrayType(
                T.StructType(
                    [
                        T.StructField("system", T.StringType()),
                        T.StructField("value", T.StringType()),
                    ]
                )
            ),
        ),
        T.StructField("maritalStatus", CODEABLE_CONCEPT),
    ]
)

ENCOUNTER_SCHEMA = T.StructType(
    [
        T.StructField("resourceType", T.StringType()),
        T.StructField("id", T.StringType()),
        T.StructField("status", T.StringType()),
        T.StructField("class", CODING),
        T.StructField("type", T.ArrayType(CODEABLE_CONCEPT)),
        T.StructField("subject", REFERENCE),
        T.StructField("period", PERIOD),
        T.StructField("reasonCode", T.ArrayType(CODEABLE_CONCEPT)),
        T.StructField("serviceProvider", REFERENCE),
    ]
)

OBSERVATION_SCHEMA = T.StructType(
    [
        T.StructField("resourceType", T.StringType()),
        T.StructField("id", T.StringType()),
        T.StructField("status", T.StringType()),
        T.StructField("category", T.ArrayType(CODEABLE_CONCEPT)),
        T.StructField("code", CODEABLE_CONCEPT),
        T.StructField("subject", REFERENCE),
        T.StructField("encounter", REFERENCE),
        T.StructField("effectiveDateTime", T.StringType()),
        T.StructField("issued", T.StringType()),
        T.StructField("valueQuantity", QUANTITY),
        T.StructField("valueCodeableConcept", CODEABLE_CONCEPT),
        T.StructField("valueString", T.StringType()),
    ]
)

MEDICATION_REQUEST_SCHEMA = T.StructType(
    [
        T.StructField("resourceType", T.StringType()),
        T.StructField("id", T.StringType()),
        T.StructField("status", T.StringType()),
        T.StructField("intent", T.StringType()),
        T.StructField("medicationCodeableConcept", CODEABLE_CONCEPT),
        T.StructField("subject", REFERENCE),
        T.StructField("encounter", REFERENCE),
        T.StructField("authoredOn", T.StringType()),
        T.StructField("requester", REFERENCE),
        T.StructField(
            "dosageInstruction",
            T.ArrayType(T.StructType([T.StructField("text", T.StringType())])),
        ),
    ]
)

DICOM_MANIFEST_SCHEMA = T.StructType(
    [
        T.StructField("studyInstanceUid", T.StringType()),
        T.StructField("accessionNumber", T.StringType()),
        T.StructField("patientId", T.StringType()),
        T.StructField("modality", T.StringType()),
        T.StructField("studyDate", T.StringType()),
        T.StructField("studyDescription", T.StringType()),
        T.StructField("bodyPartExamined", T.StringType()),
        T.StructField("numberOfSeries", T.IntegerType()),
        T.StructField("numberOfInstances", T.IntegerType()),
        T.StructField("storagePath", T.StringType()),
        T.StructField("receivedAt", T.StringType()),
    ]
)


# ───────────────────────────── helpers ─────────────────────────────
def resource_json() -> Column:
    """Unwrap an optional ``{"resource": {...}}`` change envelope to bare JSON."""
    return F.coalesce(
        F.get_json_object(F.col("payload"), "$.resource"), F.col("payload")
    )


def ref_id(col: Column) -> Column:
    """``Patient/abc`` / ``urn:uuid:abc`` → ``abc`` (last path/URN segment)."""
    return F.regexp_extract(col, r"([^:/]+)$", 1)


def latest_by_key(df: DataFrame, keys: List[str]) -> DataFrame:
    """Keep only the newest Kafka offset per natural key."""
    window = Window.partitionBy(*keys).orderBy(F.col("kafka_offset").desc())
    return (
        df.withColumn("_rn", F.row_number().over(window))
        .filter(F.col("_rn") == 1)
        .drop("_rn", "kafka_offset")
    )


# ───────────────────────────── entity builders ─────────────────────────────
def build_patients(bronze: DataFrame) -> DataFrame:
    parsed = bronze.filter(F.col("resource_type") == "Patient").withColumn(
        "r", F.from_json(resource_json(), PATIENT_SCHEMA)
    )
    return parsed.select(
        F.col("r.id").alias("patient_id"),
        F.lower(F.col("r.gender")).alias("gender"),
        F.to_date(F.col("r.birthDate")).alias("birth_date"),
        F.to_timestamp(F.col("r.deceasedDateTime")).alias("deceased_datetime"),
        F.col("r.name")[0]["family"].alias("family_name"),
        F.concat_ws(" ", F.col("r.name")[0]["given"]).alias("given_name"),
        F.col("r.address")[0]["city"].alias("city"),
        F.col("r.address")[0]["state"].alias("state"),
        F.col("r.address")[0]["postalCode"].alias("zip"),
        F.col("r.address")[0]["country"].alias("country"),
        F.col("r.maritalStatus.coding")[0]["code"].alias("marital_status"),
        F.col("ingested_at"),
        F.col("kafka_offset"),
    ).filter(F.col("patient_id").isNotNull())


def build_encounters(bronze: DataFrame) -> DataFrame:
    parsed = bronze.filter(F.col("resource_type") == "Encounter").withColumn(
        "r", F.from_json(resource_json(), ENCOUNTER_SCHEMA)
    )
    return parsed.select(
        F.col("r.id").alias("encounter_id"),
        F.col("r.status").alias("status"),
        F.col("r.class.code").alias("class_code"),
        F.col("r.type")[0]["coding"][0]["code"].alias("type_code"),
        F.col("r.type")[0]["coding"][0]["display"].alias("type_display"),
        ref_id(F.col("r.subject.reference")).alias("patient_id"),
        ref_id(F.col("r.serviceProvider.reference")).alias("provider_org_id"),
        F.to_timestamp(F.col("r.period.start")).alias("start_datetime"),
        F.to_timestamp(F.col("r.period.end")).alias("end_datetime"),
        F.to_date(F.col("r.period.start")).alias("start_date"),
        F.col("r.reasonCode")[0]["coding"][0]["code"].alias("reason_code"),
        F.col("r.reasonCode")[0]["coding"][0]["display"].alias("reason_display"),
        F.col("ingested_at"),
        F.col("kafka_offset"),
    ).filter(F.col("encounter_id").isNotNull())


def build_observations(bronze: DataFrame) -> DataFrame:
    parsed = bronze.filter(F.col("resource_type") == "Observation").withColumn(
        "r", F.from_json(resource_json(), OBSERVATION_SCHEMA)
    )
    return parsed.select(
        F.col("r.id").alias("observation_id"),
        F.col("r.status").alias("status"),
        F.col("r.category")[0]["coding"][0]["code"].alias("category_code"),
        F.col("r.code.coding")[0]["system"].alias("code_system"),
        F.col("r.code.coding")[0]["code"].alias("code"),
        F.col("r.code.coding")[0]["display"].alias("code_display"),
        ref_id(F.col("r.subject.reference")).alias("patient_id"),
        ref_id(F.col("r.encounter.reference")).alias("encounter_id"),
        F.to_timestamp(
            F.coalesce(F.col("r.effectiveDateTime"), F.col("r.issued"))
        ).alias("effective_datetime"),
        F.to_date(
            F.coalesce(F.col("r.effectiveDateTime"), F.col("r.issued"))
        ).alias("effective_date"),
        F.col("r.valueQuantity.value").alias("value_as_number"),
        F.coalesce(F.col("r.valueQuantity.unit"), F.col("r.valueQuantity.code")).alias(
            "unit"
        ),
        F.coalesce(F.col("r.valueString"), F.col("r.valueCodeableConcept.text")).alias(
            "value_as_string"
        ),
        F.col("r.valueCodeableConcept.coding")[0]["code"].alias("value_code"),
        F.col("ingested_at"),
        F.col("kafka_offset"),
    ).filter(F.col("observation_id").isNotNull())


def build_medications(bronze: DataFrame) -> DataFrame:
    parsed = bronze.filter(
        F.col("resource_type") == "MedicationRequest"
    ).withColumn("r", F.from_json(resource_json(), MEDICATION_REQUEST_SCHEMA))
    return parsed.select(
        F.col("r.id").alias("medication_request_id"),
        F.col("r.status").alias("status"),
        F.col("r.intent").alias("intent"),
        F.col("r.medicationCodeableConcept.coding")[0]["code"].alias("rxnorm_code"),
        F.coalesce(
            F.col("r.medicationCodeableConcept.coding")[0]["display"],
            F.col("r.medicationCodeableConcept.text"),
        ).alias("medication_display"),
        ref_id(F.col("r.subject.reference")).alias("patient_id"),
        ref_id(F.col("r.encounter.reference")).alias("encounter_id"),
        F.to_timestamp(F.col("r.authoredOn")).alias("authored_datetime"),
        F.to_date(F.col("r.authoredOn")).alias("authored_date"),
        F.col("r.dosageInstruction")[0]["text"].alias("dosage_text"),
        F.col("ingested_at"),
        F.col("kafka_offset"),
    ).filter(F.col("medication_request_id").isNotNull())


def build_imaging_studies(bronze: DataFrame) -> DataFrame:
    parsed = bronze.withColumn(
        "r", F.from_json(F.col("payload"), DICOM_MANIFEST_SCHEMA)
    )
    return parsed.select(
        F.col("r.studyInstanceUid").alias("study_instance_uid"),
        F.col("r.accessionNumber").alias("accession_number"),
        F.col("r.patientId").alias("patient_id"),
        F.upper(F.col("r.modality")).alias("modality"),
        F.to_date(F.col("r.studyDate")).alias("study_date"),
        F.col("r.studyDescription").alias("study_description"),
        F.col("r.bodyPartExamined").alias("body_part"),
        F.col("r.numberOfSeries").alias("number_of_series"),
        F.col("r.numberOfInstances").alias("number_of_instances"),
        F.col("r.storagePath").alias("storage_path"),
        F.to_timestamp(F.col("r.receivedAt")).alias("received_at"),
        F.col("ingested_at"),
        F.col("kafka_offset"),
    ).filter(F.col("study_instance_uid").isNotNull())


class Entity(NamedTuple):
    builder: Callable[[DataFrame], DataFrame]
    keys: List[str]
    partition_cols: List[str]


ENTITIES: Dict[str, Entity] = {
    "patients": Entity(build_patients, ["patient_id"], []),
    "encounters": Entity(build_encounters, ["encounter_id"], ["start_date"]),
    "observations": Entity(build_observations, ["observation_id"], ["effective_date"]),
    "medications": Entity(
        build_medications, ["medication_request_id"], ["authored_date"]
    ),
    "imaging_studies": Entity(
        build_imaging_studies, ["study_instance_uid"], ["study_date"]
    ),
}


def merge_to_silver(
    spark: SparkSession,
    df: DataFrame,
    table_path: str,
    keys: List[str],
    partition_cols: List[str],
) -> int:
    """Upsert by natural key; creates the partitioned table on first run."""
    from delta.tables import DeltaTable

    if df.rdd.isEmpty():
        log.info(json.dumps({"event": "no_rows", "table": table_path}))
        return 0
    count = df.count()
    if DeltaTable.isDeltaTable(spark, table_path):
        target = DeltaTable.forPath(spark, table_path)
        cond = " AND ".join(f"t.{k} = s.{k}" for k in keys)
        (
            target.alias("t")
            .merge(df.alias("s"), cond)
            .whenMatchedUpdateAll()
            .whenNotMatchedInsertAll()
            .execute()
        )
    else:
        writer = df.write.format("delta").mode("append")
        if partition_cols:
            writer = writer.partitionBy(*partition_cols)
        writer.save(table_path)
    return count


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--entity", required=True, choices=sorted(ENTITIES))
    parser.add_argument("--source-path", required=True, help="bronze Delta path (s3a://...)")
    parser.add_argument("--target-path", required=True, help="silver Delta path (s3a://...)")
    parser.add_argument("--run-id", default="manual")
    return parser.parse_args(argv)


def main(argv: List[str]) -> None:
    args = parse_args(argv)
    entity = ENTITIES[args.entity]
    spark = SparkSession.builder.appName(
        f"medflow-bronze-to-silver-{args.entity}"
    ).getOrCreate()
    spark.sparkContext.setLogLevel("WARN")

    bronze = spark.read.format("delta").load(args.source_path)
    silver = latest_by_key(entity.builder(bronze), entity.keys).withColumn(
        "silver_loaded_at", F.current_timestamp()
    )
    written = merge_to_silver(
        spark, silver, args.target_path, entity.keys, entity.partition_cols
    )
    log.info(
        json.dumps(
            {
                "event": "silver_load_done",
                "entity": args.entity,
                "table": args.target_path,
                "rows_upserted": written,
                "run_id": args.run_id,
            }
        )
    )
    spark.stop()


if __name__ == "__main__":
    main(sys.argv[1:])
