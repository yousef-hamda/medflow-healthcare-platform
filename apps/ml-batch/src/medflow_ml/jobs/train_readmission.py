"""Train the 30-day readmission model and register ``readmission-30d``.

Pipeline
--------
1. PySpark reads gold ``visit_occurrence`` (+ ``condition_occurrence``,
   ``person``) and engineers encounter features with window functions:
   prior admission counts in 90/180/365 days **before** the index visit,
   comorbidity flags, length of stay, age band, sex and social-determinants
   columns. The label is "another inpatient visit within 30 days of
   discharge". All look-back windows are strictly historical w.r.t. the
   index discharge (see the label-leakage guard test).
2. XGBoost (binary:logistic) with early stopping on a temporally held-out
   validation set.
3. Probability calibration with sklearn (isotonic) on the validation fold.
4. SHAP ``TreeExplainer`` summary plot logged as an MLflow artifact.
5. Subgroup metrics (sex / age band / race) logged for fairness review.
6. Register as ``readmission-30d``.

All data is synthetic (Synthea, seed 42).
"""

from __future__ import annotations

import argparse
import tempfile
from dataclasses import dataclass
from pathlib import Path

from medflow_ml.config import Settings, get_settings
from medflow_ml.features.encounters import FEATURE_ORDER
from medflow_ml.logging_utils import configure_logging

READMISSION_WINDOW_DAYS = 30


@dataclass(frozen=True)
class ReadmissionDataset:
    """Featurized cohort. ``features`` columns follow :data:`FEATURE_ORDER`."""

    features: object  # pandas.DataFrame [N, len(FEATURE_ORDER)]
    labels: object  # numpy [N]
    admit_dates: object  # numpy[datetime64]
    subgroups: object  # pandas.DataFrame [sex, age_band, race]


def load_dataset(settings: Settings) -> ReadmissionDataset:
    """PySpark feature build -> pandas. Heavy imports are local."""
    from pyspark.sql import Window  # noqa: PLC0415
    from pyspark.sql import functions as F  # noqa: PLC0415

    from medflow_ml.data_io.spark_io import get_spark, read_delta_spark, stop_spark

    spark = get_spark(settings)
    try:
        visits = read_delta_spark(spark, settings.gold_table_s3a("visit_occurrence"))
        conditions = read_delta_spark(spark, settings.gold_table_s3a("condition_occurrence"))
        person = read_delta_spark(spark, settings.gold_table_s3a("person"))

        inpatient = visits.filter(F.col("visit_concept_id") == F.lit(9201)).select(
            "visit_occurrence_id",
            "person_id",
            F.col("visit_start_datetime").alias("admit_dt"),
            F.col("visit_end_datetime").alias("discharge_dt"),
            "discharge_to_concept_id",
        )

        # Prior-admission counts via self-join + windowed range counts.
        prior = _prior_admission_features(inpatient, F)

        # 30-day readmission label: any inpatient admission for the same
        # person within (discharge_dt, discharge_dt + 30d].
        readmit = _readmission_label(inpatient, F)

        # Comorbidity flags from conditions recorded on/before the index visit.
        comorbid = _comorbidity_features(inpatient, conditions, F)

        los = inpatient.withColumn(
            "length_of_stay_days",
            (F.col("discharge_dt").cast("long") - F.col("admit_dt").cast("long")) / 86400.0,
        )

        demo = person.select(
            "person_id",
            F.col("gender_source_value").alias("sex"),
            F.col("race_source_value").alias("race"),
            F.col("year_of_birth"),
        )

        joined = (
            los.join(prior, "visit_occurrence_id")
            .join(comorbid, "visit_occurrence_id")
            .join(readmit, "visit_occurrence_id")
            .join(demo, "person_id")
            .withColumn("age", F.year(F.col("admit_dt")) - F.col("year_of_birth"))
            .toPandas()
        )
    finally:
        stop_spark(spark)

    return _frame_to_dataset(joined)


def _prior_admission_features(inpatient: object, funcs: object) -> object:
    """Counts of prior admissions in 90/180/365 days before each index visit."""
    F = funcs
    a = inpatient.alias("a")
    b = inpatient.alias("b")
    joined = a.join(
        b,
        (F.col("a.person_id") == F.col("b.person_id"))
        & (F.col("b.admit_dt") < F.col("a.admit_dt")),
        how="left",
    )
    days = (F.col("a.admit_dt").cast("long") - F.col("b.admit_dt").cast("long")) / 86400.0
    return joined.groupBy(F.col("a.visit_occurrence_id").alias("visit_occurrence_id")).agg(
        F.sum(F.when(days <= 90, 1).otherwise(0)).alias("prior_admissions_90d"),
        F.sum(F.when(days <= 180, 1).otherwise(0)).alias("prior_admissions_180d"),
        F.sum(F.when(days <= 365, 1).otherwise(0)).alias("prior_admissions_365d"),
    )


def _readmission_label(inpatient: object, funcs: object) -> object:
    F = funcs
    a = inpatient.alias("a")
    b = inpatient.alias("b")
    days_after = (F.col("b.admit_dt").cast("long") - F.col("a.discharge_dt").cast("long")) / 86400.0
    joined = a.join(
        b,
        (F.col("a.person_id") == F.col("b.person_id"))
        & (F.col("b.visit_occurrence_id") != F.col("a.visit_occurrence_id"))
        & (days_after > 0)
        & (days_after <= READMISSION_WINDOW_DAYS),
        how="left",
    )
    return joined.groupBy(F.col("a.visit_occurrence_id").alias("visit_occurrence_id")).agg(
        F.max(F.when(F.col("b.visit_occurrence_id").isNotNull(), 1).otherwise(0)).alias("label")
    )


def _comorbidity_features(inpatient: object, conditions: object, funcs: object) -> object:
    from medflow_ml.features.encounters import COMORBIDITY_PREFIXES  # noqa: PLC0415

    F = funcs
    cond = conditions.select(
        "person_id",
        F.col("condition_start_datetime").alias("cond_dt"),
        F.upper(F.col("condition_source_value")).alias("icd10"),
    )
    a = inpatient.alias("a")
    joined = a.join(
        cond.alias("c"),
        (F.col("a.person_id") == F.col("c.person_id"))
        & (F.col("c.cond_dt") <= F.col("a.admit_dt")),
        how="left",
    )
    aggs = []
    for name, prefixes in COMORBIDITY_PREFIXES.items():
        match = None
        for prefix in prefixes:
            term = F.col("c.icd10").startswith(prefix)
            match = term if match is None else (match | term)
        aggs.append(F.max(F.when(match, 1).otherwise(0)).alias(name))
    aggs.append(
        F.countDistinct(F.col("c.icd10")).alias("n_diagnoses")
    )
    return joined.groupBy(F.col("a.visit_occurrence_id").alias("visit_occurrence_id")).agg(*aggs)


def _frame_to_dataset(frame: object) -> ReadmissionDataset:
    import numpy as np  # noqa: PLC0415
    import pandas as pd  # noqa: PLC0415

    from medflow_ml.features.encounters import age_band

    df = frame  # type: pd.DataFrame
    df = df.fillna(0)
    df["sex_norm"] = df["sex"].astype(str).str.lower().map(
        {"m": "male", "male": "male", "f": "female", "female": "female"}
    ).fillna("unknown")
    df["sex_female"] = (df["sex_norm"] == "female").astype(float)
    df["discharged_to_facility"] = (df["discharge_to_concept_id"].astype(int) != 8536).astype(float)
    df["has_social_support"] = 1.0  # synthetic SDOH placeholder; documented in card
    df["age_band"] = df["age"].astype(int).clip(lower=0).map(age_band)

    feature_df = pd.DataFrame()
    for col in FEATURE_ORDER:
        feature_df[col] = pd.to_numeric(df.get(col, 0.0), errors="coerce").fillna(0.0).astype(
            np.float32
        )

    subgroups = pd.DataFrame(
        {
            "sex": df["sex_norm"].to_numpy(),
            "age_band": df["age_band"].to_numpy(),
            "race": df["race"].astype(str).to_numpy(),
        }
    )
    labels = df["label"].astype(int).to_numpy()
    admit_dates = pd.to_datetime(df["admit_dt"]).to_numpy()
    return ReadmissionDataset(feature_df, labels, admit_dates, subgroups)


def train(settings: Settings) -> dict[str, float]:
    """Train + calibrate + register. Heavy imports local."""
    import matplotlib  # noqa: PLC0415

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt  # noqa: PLC0415
    import mlflow  # noqa: PLC0415
    import numpy as np  # noqa: PLC0415
    import shap  # noqa: PLC0415
    import xgboost as xgb  # noqa: PLC0415
    from sklearn.isotonic import IsotonicRegression  # noqa: PLC0415

    from medflow_ml.evaluation.metrics import auprc, auroc, expected_calibration_error, subgroup_auroc

    log = configure_logging("train_readmission")
    np.random.seed(settings.random_seed)

    data = load_dataset(settings)
    x = data.features.to_numpy(dtype=np.float32)
    y = np.asarray(data.labels, dtype=np.int32)
    order = np.argsort(data.admit_dates)
    x, y = x[order], y[order]
    subgroups = data.subgroups.iloc[order].reset_index(drop=True)

    cut = int(len(y) * 0.8)
    x_tr, x_va = x[:cut], x[cut:]
    y_tr, y_va = y[:cut], y[cut:]
    log.info("data_loaded", n_train=int(len(y_tr)), n_val=int(len(y_va)), prevalence=float(y.mean()))

    dtrain = xgb.DMatrix(x_tr, label=y_tr, feature_names=list(FEATURE_ORDER))
    dval = xgb.DMatrix(x_va, label=y_va, feature_names=list(FEATURE_ORDER))
    scale_pos = float((y_tr == 0).sum()) / max(float((y_tr == 1).sum()), 1.0)
    params = {
        "objective": "binary:logistic",
        "eval_metric": ["auc", "aucpr"],
        "max_depth": 4,
        "eta": 0.05,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "min_child_weight": 5.0,
        "scale_pos_weight": scale_pos,
        "seed": settings.random_seed,
    }

    mlflow.set_tracking_uri(settings.mlflow_tracking_uri)
    mlflow.set_experiment("readmission-30d")
    with mlflow.start_run(run_name="xgboost") as run:
        mlflow.log_params({k: v for k, v in params.items() if not isinstance(v, list)})
        booster = xgb.train(
            params,
            dtrain,
            num_boost_round=500,
            evals=[(dtrain, "train"), (dval, "val")],
            early_stopping_rounds=30,
            verbose_eval=False,
        )

        raw_val = booster.predict(dval)
        calibrator = IsotonicRegression(out_of_bounds="clip")
        calibrated = calibrator.fit_transform(raw_val, y_va)

        metrics = {
            "val_auroc": auroc(y_va, raw_val),
            "val_auprc": auprc(y_va, raw_val),
            "val_ece_raw": expected_calibration_error(y_va, raw_val),
            "val_ece_calibrated": expected_calibration_error(y_va, calibrated),
        }
        mlflow.log_metrics({k: v for k, v in metrics.items() if v == v})

        for col in subgroups.columns:
            for label, value in subgroup_auroc(y_va, raw_val, subgroups.iloc[cut:][col]).items():
                if value == value:
                    mlflow.log_metric(f"auroc__{col}__{label}".replace(" ", "_")[:240], value)

        with tempfile.TemporaryDirectory() as tmp:
            explainer = shap.TreeExplainer(booster)
            shap_values = explainer.shap_values(x_va)
            shap.summary_plot(
                shap_values, x_va, feature_names=list(FEATURE_ORDER), show=False
            )
            shap_path = Path(tmp) / "shap_summary.png"
            plt.tight_layout()
            plt.savefig(shap_path, dpi=120, bbox_inches="tight")
            plt.close("all")
            mlflow.log_artifact(str(shap_path), artifact_path="explanations")

        mlflow.xgboost.log_model(
            booster,
            artifact_path="model",
            registered_model_name=settings.readmission_model_name,
        )
        log.info("registered", model=settings.readmission_model_name, run_id=run.info.run_id, **metrics)
    return metrics


def main() -> None:
    argparse.ArgumentParser(description="Train readmission-30d XGBoost.").parse_args()
    train(get_settings())


if __name__ == "__main__":
    main()
