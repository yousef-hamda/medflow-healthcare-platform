"""Train the sepsis early-warning LSTM and register it as ``sepsis-ews``.

Pipeline
--------
1. PySpark reads the gold ``measurement`` and ``condition_occurrence`` Delta
   tables and collects per-admission vitals to pandas.
2. For each admission a 6-hour observation window is resampled onto a
   15-minute grid (24 steps x 5 vitals) using the **shared** feature module
   :mod:`medflow_ml.features.vitals` (identical to serving-time featurize).
3. Labels: an admission is positive if a sepsis condition is recorded.
   Sepsis SNOMED concept ids used (documented for auditability):

       91302008    Sepsis (disorder)
       10001005    Bacterial sepsis
       105592009   Septicemia
       434156009   Sepsis due to urinary tract infection
       76571007    Septic shock

   Concept ids are matched against ``condition_occurrence.condition_concept_id``.
4. A 2x64 LSTM (dropout 0.3) is trained with ``BCEWithLogitsLoss`` and
   torchmetrics AUROC/AUPRC.
5. Time-aware split: admissions are ordered by admission date and the most
   recent fraction is held out for validation (no future-into-past leakage).
6. Metrics + model are logged to MLflow and registered as ``sepsis-ews``.

All data is synthetic (Synthea, seed 42).
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime

from medflow_ml.config import Settings, get_settings
from medflow_ml.features.vitals import (
    SEQUENCE_STEPS,
    VITALS_FEATURES,
    VitalsSample,
    normalize_sequence,
    resample_window,
)
from medflow_ml.logging_utils import configure_logging

# Documented sepsis SNOMED concept ids (see module docstring).
SEPSIS_CONDITION_CONCEPT_IDS: tuple[int, ...] = (
    91302008,
    10001005,
    105592009,
    434156009,
    76571007,
)

# Gold ``measurement.measurement_concept_id`` -> vitals feature name. The
# OMOP concept ids below are the standard mappings of the source LOINC codes
# (documented inline) as materialized by the silver->gold OMOP ETL.
VITALS_CONCEPT_MAP: dict[int, str] = {
    3027018: "heart_rate",  # LOINC 8867-4 Heart rate
    3016502: "spo2",  # LOINC 59408-5 Oxygen saturation (SpO2)
    3024171: "resp_rate",  # LOINC 9279-1 Respiratory rate
    3020891: "temp_c",  # LOINC 8310-5 Body temperature
    3027598: "map_mmhg",  # LOINC 8478-0 Mean blood pressure
}


@dataclass(frozen=True)
class Admission:
    admission_id: str
    admission_date: datetime
    samples: list[VitalsSample]
    label: int


def load_admissions(settings: Settings) -> list[Admission]:
    """PySpark: read gold measurement + condition_occurrence into Admissions.

    Heavy (Spark) imports are local so unit tests and ``py_compile`` need no
    JVM. Returns one :class:`Admission` per visit with its vitals samples
    and sepsis label.
    """
    import pandas as pd  # noqa: PLC0415
    from pyspark.sql import functions as F  # noqa: PLC0415

    from medflow_ml.data_io.spark_io import get_spark, read_delta_spark, stop_spark

    spark = get_spark(settings)
    try:
        measurement = read_delta_spark(spark, settings.gold_table_s3a("measurement"))
        conditions = read_delta_spark(spark, settings.gold_table_s3a("condition_occurrence"))
        visits = read_delta_spark(spark, settings.gold_table_s3a("visit_occurrence"))

        vitals = (
            measurement.filter(F.col("measurement_concept_id").isin(list(VITALS_CONCEPT_MAP)))
            .select(
                "visit_occurrence_id",
                "measurement_concept_id",
                "measurement_datetime",
                "value_as_number",
            )
            .toPandas()
        )
        sepsis = (
            conditions.filter(
                F.col("condition_concept_id").isin(list(SEPSIS_CONDITION_CONCEPT_IDS))
            )
            .select("visit_occurrence_id")
            .distinct()
            .toPandas()
        )
        visit_dates = visits.select(
            "visit_occurrence_id", "visit_start_datetime"
        ).toPandas()
    finally:
        stop_spark(spark)

    sepsis_visits = set(sepsis["visit_occurrence_id"].tolist())
    date_by_visit = dict(
        zip(visit_dates["visit_occurrence_id"], visit_dates["visit_start_datetime"])
    )
    return _assemble_admissions(vitals, date_by_visit, sepsis_visits)


def _assemble_admissions(
    vitals: object, date_by_visit: dict[object, object], sepsis_visits: set[object]
) -> list[Admission]:
    import pandas as pd  # noqa: PLC0415

    frame = vitals  # type: pd.DataFrame
    admissions: list[Admission] = []
    for visit_id, group in frame.groupby("visit_occurrence_id"):
        by_ts: dict[datetime, dict[str, float]] = {}
        for _, row in group.iterrows():
            feature = VITALS_CONCEPT_MAP.get(int(row["measurement_concept_id"]))
            if feature is None:
                continue
            ts = pd.Timestamp(row["measurement_datetime"]).to_pydatetime()
            by_ts.setdefault(ts, {})[feature] = float(row["value_as_number"])
        samples = _rows_to_samples(by_ts)
        if not samples:
            continue
        admit_date = pd.Timestamp(date_by_visit.get(visit_id, samples[0].ts)).to_pydatetime()
        admissions.append(
            Admission(
                admission_id=str(visit_id),
                admission_date=admit_date,
                samples=samples,
                label=int(visit_id in sepsis_visits),
            )
        )
    return admissions


def _rows_to_samples(by_ts: dict[datetime, dict[str, float]]) -> list[VitalsSample]:
    from medflow_ml.features.vitals import POPULATION_NORMALS  # noqa: PLC0415

    samples: list[VitalsSample] = []
    for ts in sorted(by_ts):
        values = by_ts[ts]
        samples.append(
            VitalsSample(
                ts=ts,
                heart_rate=values.get("heart_rate", POPULATION_NORMALS["heart_rate"]),
                spo2=values.get("spo2", POPULATION_NORMALS["spo2"]),
                resp_rate=values.get("resp_rate", POPULATION_NORMALS["resp_rate"]),
                temp_c=values.get("temp_c", POPULATION_NORMALS["temp_c"]),
                map_mmhg=values.get("map_mmhg", POPULATION_NORMALS["map_mmhg"]),
            )
        )
    return samples


def build_tensors(admissions: list[Admission]) -> tuple[object, object]:
    """Featurize admissions into an [N, 24, 5] tensor and [N] label tensor."""
    import numpy as np  # noqa: PLC0415

    sequences = []
    labels = []
    for adm in admissions:
        grid = resample_window(adm.samples)
        sequences.append(normalize_sequence(grid))
        labels.append(adm.label)
    x = np.asarray(sequences, dtype=np.float32).reshape(-1, SEQUENCE_STEPS, len(VITALS_FEATURES))
    y = np.asarray(labels, dtype=np.float32)
    return x, y


def time_aware_split(
    admissions: list[Admission], val_fraction: float = 0.2
) -> tuple[list[Admission], list[Admission]]:
    """Split by admission date: oldest -> train, most recent -> validation."""
    ordered = sorted(admissions, key=lambda a: a.admission_date)
    cut = int(len(ordered) * (1.0 - val_fraction))
    return ordered[:cut], ordered[cut:]


def train(settings: Settings, max_epochs: int = 20) -> dict[str, float]:
    """Full training + MLflow registration. Heavy imports are local."""
    import mlflow  # noqa: PLC0415
    import numpy as np  # noqa: PLC0415
    import pytorch_lightning as pl  # noqa: PLC0415
    import torch  # noqa: PLC0415
    from torch.utils.data import DataLoader, TensorDataset  # noqa: PLC0415

    from medflow_ml.evaluation.metrics import auprc, auroc
    from medflow_ml.models.lstm import LSTMConfig, build_module

    log = configure_logging("train_sepsis")
    torch.manual_seed(settings.random_seed)
    np.random.seed(settings.random_seed)

    admissions = load_admissions(settings)
    if not admissions:
        raise RuntimeError("no admissions loaded from gold tables")
    train_adm, val_adm = time_aware_split(admissions)
    x_train, y_train = build_tensors(train_adm)
    x_val, y_val = build_tensors(val_adm)
    log.info(
        "data_loaded",
        n_train=len(train_adm),
        n_val=len(val_adm),
        train_prevalence=float(y_train.mean()),
    )

    pos = float(y_train.sum())
    neg = float(len(y_train) - pos)
    pos_weight = (neg / pos) if pos > 0 else 1.0
    cfg = LSTMConfig(input_size=len(VITALS_FEATURES), pos_weight=pos_weight)
    module = build_module(cfg)

    train_loader = DataLoader(
        TensorDataset(torch.from_numpy(x_train), torch.from_numpy(y_train)),
        batch_size=64,
        shuffle=True,
    )
    val_loader = DataLoader(
        TensorDataset(torch.from_numpy(x_val), torch.from_numpy(y_val)), batch_size=128
    )

    mlflow.set_tracking_uri(settings.mlflow_tracking_uri)
    mlflow.set_experiment("sepsis-ews")
    with mlflow.start_run(run_name="lstm") as run:
        mlflow.log_params(
            {
                "hidden_size": cfg.hidden_size,
                "num_layers": cfg.num_layers,
                "dropout": cfg.dropout,
                "pos_weight": round(pos_weight, 4),
                "sequence_steps": SEQUENCE_STEPS,
                "seed": settings.random_seed,
            }
        )
        trainer = pl.Trainer(
            max_epochs=max_epochs,
            accelerator="cpu",
            enable_checkpointing=False,
            logger=False,
            enable_progress_bar=False,
        )
        trainer.fit(module, train_loader, val_loader)

        module.eval()
        with torch.no_grad():
            val_probs = torch.sigmoid(module(torch.from_numpy(x_val))).numpy()
        metrics = {
            "val_auroc": auroc(y_val, val_probs),
            "val_auprc": auprc(y_val, val_probs),
        }
        mlflow.log_metrics({k: v for k, v in metrics.items() if v == v})  # skip nan
        mlflow.pytorch.log_model(
            module,
            artifact_path="model",
            registered_model_name=settings.sepsis_model_name,
        )
        log.info("registered", model=settings.sepsis_model_name, run_id=run.info.run_id, **metrics)
    return metrics


def main() -> None:
    parser = argparse.ArgumentParser(description="Train sepsis-ews LSTM.")
    parser.add_argument("--max-epochs", type=int, default=20)
    args = parser.parse_args()
    train(get_settings(), max_epochs=args.max_epochs)


if __name__ == "__main__":
    main()
