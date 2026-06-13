"""Backfill the offline feature store and materialize into Feast online store.

Computes, per patient and feature timestamp:

* rolling vitals statistics over 1h / 6h / 24h windows
  (``mean`` / ``min`` / ``max`` / ``slope``) using the shared pure functions
  in :mod:`medflow_ml.features.vitals`,
* prior-encounter counts (90/180/365 day look-backs),
* lab abnormality flags (:mod:`medflow_ml.features.labs`),

writes them as parquet to the offline store
(``s3://lakehouse/feature_store/...``), then calls ``feast materialize``
via subprocess so the online Redis store is populated. If Feast is not
installed the materialize step is skipped gracefully.

All windows are strictly historical relative to their event timestamp, so
there is no label leakage when these features back a point-in-time join.
"""

from __future__ import annotations

import argparse
import subprocess
from datetime import datetime

from medflow_ml.config import Settings, get_settings
from medflow_ml.features.labs import lab_abnormality_flags
from medflow_ml.features.vitals import VITALS_FEATURES, rolling_stats
from medflow_ml.logging_utils import configure_logging

ROLLING_WINDOWS_HOURS: tuple[int, ...] = (1, 6, 24)


def compute_vitals_stats_rows(
    patient_series: dict[str, list[tuple[datetime, float]]],
    event_times: list[datetime],
) -> list[dict[str, float]]:
    """Per event_time, rolling mean/min/max/slope of each vital over 1/6/24h.

    ``patient_series`` maps a vital name to its ``(ts, value)`` observations.
    Pure function (no Spark/pandas) so it is unit-testable and matches the
    serving featurizer's windowing semantics.
    """
    rows: list[dict[str, float]] = []
    for event_time in event_times:
        row: dict[str, float] = {}
        for vital in VITALS_FEATURES:
            series = patient_series.get(vital, [])
            for hours in ROLLING_WINDOWS_HOURS:
                stats = rolling_stats(series, event_time, float(hours))
                for stat in ("mean", "min", "max", "slope"):
                    row[f"{vital}_{stat}_{hours}h"] = float(stats.get(stat, 0.0))
        rows.append(row)
    return rows


def load_and_build(settings: Settings) -> tuple[object, object, object]:
    """PySpark read of gold vitals/encounters/labs -> three pandas frames.

    Returns (vitals_stats_df, encounter_history_df, lab_flags_df), each with
    ``patient_id`` + ``event_timestamp`` columns for Feast ingestion.
    """
    import pandas as pd  # noqa: PLC0415
    from pyspark.sql import functions as F  # noqa: PLC0415

    from medflow_ml.data_io.spark_io import get_spark, read_delta_spark, stop_spark
    from medflow_ml.jobs.train_sepsis import VITALS_CONCEPT_MAP

    spark = get_spark(settings)
    try:
        measurement = read_delta_spark(spark, settings.gold_table_s3a("measurement"))
        visits = read_delta_spark(spark, settings.gold_table_s3a("visit_occurrence"))

        vitals_pd = (
            measurement.filter(
                F.col("measurement_concept_id").isin(list(VITALS_CONCEPT_MAP))
            )
            .select(
                F.col("person_id").alias("patient_id"),
                "measurement_concept_id",
                F.col("measurement_datetime").alias("event_timestamp"),
                "value_as_number",
            )
            .toPandas()
        )
        labs_pd = (
            measurement.filter(~F.col("measurement_concept_id").isin(list(VITALS_CONCEPT_MAP)))
            .select(
                F.col("person_id").alias("patient_id"),
                F.col("measurement_source_value").alias("lab_name"),
                F.col("measurement_datetime").alias("event_timestamp"),
                "value_as_number",
            )
            .toPandas()
        )
        enc_pd = (
            visits.select(
                F.col("person_id").alias("patient_id"),
                F.col("visit_start_datetime").alias("event_timestamp"),
            )
            .toPandas()
        )
    finally:
        stop_spark(spark)

    return (
        _vitals_stats_frame(vitals_pd),
        _encounter_history_frame(enc_pd),
        _lab_flags_frame(labs_pd),
    )


def _vitals_stats_frame(vitals_pd: object) -> object:
    import pandas as pd  # noqa: PLC0415

    from medflow_ml.jobs.train_sepsis import VITALS_CONCEPT_MAP

    out_rows: list[dict[str, object]] = []
    for patient_id, group in vitals_pd.groupby("patient_id"):
        series: dict[str, list[tuple[datetime, float]]] = {v: [] for v in VITALS_FEATURES}
        for _, r in group.iterrows():
            vital = VITALS_CONCEPT_MAP.get(int(r["measurement_concept_id"]))
            if vital is None:
                continue
            ts = pd.Timestamp(r["event_timestamp"]).to_pydatetime()
            series[vital].append((ts, float(r["value_as_number"])))
        event_times = sorted({ts for s in series.values() for ts, _ in s})
        for event_time, feats in zip(event_times, compute_vitals_stats_rows(series, event_times)):
            out_rows.append({"patient_id": str(patient_id), "event_timestamp": event_time, **feats})
    return pd.DataFrame(out_rows)


def _encounter_history_frame(enc_pd: object) -> object:
    import pandas as pd  # noqa: PLC0415

    from medflow_ml.features.encounters import prior_admission_counts

    out_rows: list[dict[str, object]] = []
    for patient_id, group in enc_pd.groupby("patient_id"):
        dates = sorted(pd.Timestamp(t).date() for t in group["event_timestamp"])
        for i, idx_date in enumerate(dates):
            counts = prior_admission_counts(dates[:i], idx_date)
            out_rows.append(
                {
                    "patient_id": str(patient_id),
                    "event_timestamp": pd.Timestamp(idx_date),
                    "n_prior_encounters": float(i),
                    **{k: float(v) for k, v in counts.items()},
                }
            )
    return pd.DataFrame(out_rows)


def _lab_flags_frame(labs_pd: object) -> object:
    import pandas as pd  # noqa: PLC0415

    from medflow_ml.features.labs import lab_flag_field_names

    out_rows: list[dict[str, object]] = []
    for (patient_id, event_timestamp), group in labs_pd.groupby(["patient_id", "event_timestamp"]):
        labs = {
            str(r["lab_name"]).lower(): float(r["value_as_number"])
            for _, r in group.iterrows()
        }
        flags = lab_abnormality_flags(labs)
        out_rows.append(
            {
                "patient_id": str(patient_id),
                "event_timestamp": pd.Timestamp(event_timestamp),
                **{name: float(flags[name]) for name in lab_flag_field_names()},
            }
        )
    return pd.DataFrame(out_rows)


def write_offline_store(settings: Settings, frames: dict[str, object]) -> None:
    """Persist each feature frame to the offline parquet store."""
    from medflow_ml.data_io.delta_io import write_parquet_pandas

    log = configure_logging("backfill_features")
    for name, frame in frames.items():
        uri = settings.feature_store_uri(name)
        write_parquet_pandas(frame, uri, settings)
        log.info("offline_written", dataset=name, rows=int(len(frame)), uri=uri)


def run_feast_materialize(settings: Settings, end_date: datetime | None = None) -> bool:
    """Call ``feast materialize-incremental`` via subprocess; graceful if absent."""
    log = configure_logging("backfill_features")
    end = (end_date or datetime.utcnow()).strftime("%Y-%m-%dT%H:%M:%S")
    cmd = [
        "feast",
        "-c",
        settings.feast_repo_path,
        "materialize-incremental",
        end,
    ]
    try:
        result = subprocess.run(  # noqa: S603
            cmd, check=True, capture_output=True, text=True
        )
    except FileNotFoundError:
        log.warning("feast_missing", note="feast CLI not installed; skipping materialize")
        return False
    except subprocess.CalledProcessError as exc:
        log.error("feast_failed", returncode=exc.returncode, stderr=exc.stderr[-500:])
        return False
    log.info("feast_materialized", end=end, stdout=result.stdout[-200:])
    return True


def run(settings: Settings) -> None:
    log = configure_logging("backfill_features")
    vitals_stats, encounter_history, lab_flags = load_and_build(settings)
    write_offline_store(
        settings,
        {
            "vitals_stats": vitals_stats,
            "encounter_history": encounter_history,
            "lab_flags": lab_flags,
        },
    )
    run_feast_materialize(settings)
    log.info("backfill_complete")


def main() -> None:
    argparse.ArgumentParser(description="Backfill offline features + Feast materialize.").parse_args()
    run(get_settings())


if __name__ == "__main__":
    main()
