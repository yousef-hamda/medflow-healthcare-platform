"""Shared helpers for MedFlow Airflow DAGs.

Modules
-------
datasets        Canonical lakehouse paths and Airflow ``Dataset`` objects.
medflow_spark   SparkSubmitOperator factory pre-wired for Delta Lake + MinIO S3A.
ge_checkpoint   PythonOperator wrapper that runs a Great Expectations checkpoint.
alerting        Slack-free failure alerting (structured logs + Prometheus pushgateway).
"""
from __future__ import annotations
