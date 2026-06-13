"""Data-drift monitoring with Evidently -> HTML on ``s3://drift-reports``.

Compares the distribution of **recent serving inputs** (read from the
predictions log via SQLAlchemy) against the **training baseline** parquet
captured at train time, using Evidently's ``DataDriftPreset``. The rendered
HTML is uploaded to ``s3://drift-reports/{date}/{model}.html`` (MinIO).

Run::

    python -m medflow_ml.jobs.drift_report --model sepsis-ews

All data is synthetic.
"""

from __future__ import annotations

import argparse
from datetime import date

from medflow_ml.config import Settings, get_settings
from medflow_ml.logging_utils import configure_logging

# Per-model: the SQL pulling serving-time feature columns from the
# predictions log, and the baseline parquet path under the feature store.
MODEL_QUERIES: dict[str, str] = {
    "sepsis-ews": (
        "SELECT heart_rate, spo2, resp_rate, temp_c, map_mmhg, "
        "wbc, lactate, creatinine, risk_score "
        "FROM prediction_features WHERE model_name = 'sepsis-ews' "
        "AND created_at >= now() - interval '7 days'"
    ),
    "readmission-30d": (
        "SELECT age, length_of_stay_days, prior_admissions_365d, n_diagnoses, "
        "probability FROM prediction_features WHERE model_name = 'readmission-30d' "
        "AND created_at >= now() - interval '7 days'"
    ),
}


def load_current(settings: Settings, model: str) -> object:
    """Read recent serving inputs for ``model`` from the predictions log."""
    import pandas as pd  # noqa: PLC0415
    from sqlalchemy import create_engine, text  # noqa: PLC0415

    query = MODEL_QUERIES.get(model)
    if query is None:
        raise ValueError(f"no drift query configured for model {model!r}")
    engine = create_engine(settings.predictions_database_url)
    try:
        with engine.connect() as conn:
            return pd.read_sql(text(query), conn)
    finally:
        engine.dispose()


def load_baseline(settings: Settings, model: str) -> object:
    """Read the training baseline parquet for ``model`` from the feature store."""
    from medflow_ml.data_io.delta_io import read_parquet_pandas

    return read_parquet_pandas(settings.feature_store_uri(f"baseline_{model}"), settings)


def build_report(current: object, baseline: object) -> object:
    """Build the Evidently ``DataDriftPreset`` report on shared columns."""
    from evidently.metric_preset import DataDriftPreset  # noqa: PLC0415
    from evidently.report import Report  # noqa: PLC0415

    shared = [c for c in baseline.columns if c in set(current.columns)]
    report = Report(metrics=[DataDriftPreset()])
    report.run(reference_data=baseline[shared], current_data=current[shared])
    return report


def upload_html(settings: Settings, model: str, html: str, report_date: date) -> str:
    """Upload the rendered HTML to ``s3://drift-reports/{date}/{model}.html``."""
    import boto3  # noqa: PLC0415

    key = f"{report_date.isoformat()}/{model}.html"
    s3 = boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url,
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
        region_name=settings.aws_region,
    )
    s3.put_object(
        Bucket=settings.drift_reports_bucket,
        Key=key,
        Body=html.encode("utf-8"),
        ContentType="text/html",
    )
    return f"s3://{settings.drift_reports_bucket}/{key}"


def run(settings: Settings, model: str, report_date: date | None = None) -> str:
    log = configure_logging("drift_report")
    when = report_date or date.today()
    current = load_current(settings, model)
    baseline = load_baseline(settings, model)
    report = build_report(current, baseline)
    uri = upload_html(settings, model, report.get_html(), when)
    log.info(
        "drift_report_written",
        model=model,
        uri=uri,
        n_current=int(len(current)),
        n_baseline=int(len(baseline)),
    )
    return uri


def main() -> None:
    parser = argparse.ArgumentParser(description="Evidently data-drift report.")
    parser.add_argument("--model", required=True, choices=sorted(MODEL_QUERIES))
    args = parser.parse_args()
    run(get_settings(), args.model)


if __name__ == "__main__":
    main()
