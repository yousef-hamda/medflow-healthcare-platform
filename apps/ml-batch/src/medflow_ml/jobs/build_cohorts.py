"""Materialize OMOP analytic cohorts to ``s3://lakehouse/gold/cohorts``.

Builds reusable patient cohorts from the OMOP gold tables with PySpark and
writes each as a partitioned Delta table under ``gold/cohorts/<name>``:

* ``sepsis_admissions`` - inpatient visits with a sepsis condition.
* ``readmission_index`` - inpatient discharges eligible as 30-day
  readmission index events (alive at discharge, non-transfer).
* ``adult_inpatient`` - all inpatient visits for patients >= 18 at admission.

Each cohort row carries ``cohort_name``, ``person_id``,
``visit_occurrence_id`` and the cohort start/end so downstream training and
evaluation jobs can join consistently. All data is synthetic (Synthea).
"""

from __future__ import annotations

import argparse

from medflow_ml.config import Settings, get_settings
from medflow_ml.jobs.train_sepsis import SEPSIS_CONDITION_CONCEPT_IDS
from medflow_ml.logging_utils import configure_logging

INPATIENT_VISIT_CONCEPT_ID = 9201


def build_cohorts(settings: Settings) -> dict[str, int]:
    """Build and persist all cohorts; return row counts per cohort."""
    from pyspark.sql import functions as F  # noqa: PLC0415

    from medflow_ml.data_io.spark_io import (
        get_spark,
        read_delta_spark,
        stop_spark,
        write_delta_spark,
    )

    log = configure_logging("build_cohorts")
    spark = get_spark(settings)
    counts: dict[str, int] = {}
    try:
        visits = read_delta_spark(spark, settings.gold_table_s3a("visit_occurrence"))
        conditions = read_delta_spark(spark, settings.gold_table_s3a("condition_occurrence"))
        person = read_delta_spark(spark, settings.gold_table_s3a("person"))

        inpatient = visits.filter(F.col("visit_concept_id") == F.lit(INPATIENT_VISIT_CONCEPT_ID))

        sepsis_visits = (
            conditions.filter(
                F.col("condition_concept_id").isin(list(SEPSIS_CONDITION_CONCEPT_IDS))
            )
            .select("visit_occurrence_id")
            .distinct()
        )
        sepsis_cohort = (
            inpatient.join(sepsis_visits, "visit_occurrence_id", "inner")
            .select(
                F.lit("sepsis_admissions").alias("cohort_name"),
                "person_id",
                "visit_occurrence_id",
                F.col("visit_start_datetime").alias("cohort_start_datetime"),
                F.col("visit_end_datetime").alias("cohort_end_datetime"),
            )
        )

        readmission_index = inpatient.filter(
            F.col("visit_end_datetime").isNotNull()
        ).select(
            F.lit("readmission_index").alias("cohort_name"),
            "person_id",
            "visit_occurrence_id",
            F.col("visit_start_datetime").alias("cohort_start_datetime"),
            F.col("visit_end_datetime").alias("cohort_end_datetime"),
        )

        adults = (
            inpatient.join(person.select("person_id", "year_of_birth"), "person_id")
            .withColumn(
                "age_at_admit", F.year(F.col("visit_start_datetime")) - F.col("year_of_birth")
            )
            .filter(F.col("age_at_admit") >= 18)
            .select(
                F.lit("adult_inpatient").alias("cohort_name"),
                "person_id",
                "visit_occurrence_id",
                F.col("visit_start_datetime").alias("cohort_start_datetime"),
                F.col("visit_end_datetime").alias("cohort_end_datetime"),
            )
        )

        all_cohorts = sepsis_cohort.unionByName(readmission_index).unionByName(adults)
        target = f"{settings.gold_table_s3a('cohorts')}"
        write_delta_spark(all_cohorts, target, mode="overwrite", partition_by=["cohort_name"])

        for name in ("sepsis_admissions", "readmission_index", "adult_inpatient"):
            counts[name] = all_cohorts.filter(F.col("cohort_name") == name).count()
        log.info("cohorts_written", target=target, **counts)
    finally:
        stop_spark(spark)
    return counts


def main() -> None:
    argparse.ArgumentParser(description="Materialize OMOP cohorts to gold/cohorts.").parse_args()
    build_cohorts(get_settings())


if __name__ == "__main__":
    main()
