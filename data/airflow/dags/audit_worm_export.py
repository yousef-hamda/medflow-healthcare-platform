"""Daily export of the Postgres ``audit_log`` to the WORM audit bucket.

HIPAA-style audit trails must be immutable. Every day this DAG reads the prior
day's rows from the ``audit_log`` table in the ``medflow`` Postgres database and
writes them as a single gzipped JSON-lines object to
``s3://audit-worm/audit/{ds}.jsonl.gz`` (object-locked / compliance bucket — the
exporter only ever PUTs, never deletes or overwrites).

The whole export is a single ``PythonOperator`` using ``psycopg2`` (already a
dependency of the Postgres provider) to stream rows and ``boto3`` to PUT the
compressed object to MinIO. It is idempotent over the partition date: the object
key is deterministic, so a retry re-PUTs the same content. The export streams
through a server-side cursor and writes only structured metadata; the operator
logs counts and the object key, never row contents.
"""
from __future__ import annotations

import gzip
import io
import json
import logging
import os
from datetime import datetime, timedelta
from typing import Any, Dict, Iterator

from airflow import DAG
from airflow.exceptions import AirflowException
from airflow.operators.python import PythonOperator

from common.alerting import medflow_default_args, sla_miss_callback

log = logging.getLogger("medflow.audit_worm")

AUDIT_BUCKET = os.environ.get("MEDFLOW_AUDIT_WORM_BUCKET", "audit-worm")
AUDIT_TABLE = os.environ.get("MEDFLOW_AUDIT_TABLE", "audit_log")
AUDIT_TS_COLUMN = os.environ.get("MEDFLOW_AUDIT_TS_COLUMN", "event_time")

PG_DSN = os.environ.get(
    "MEDFLOW_AUDIT_PG_DSN",
    "host=postgres port=5432 dbname=medflow user=medflow "
    "password=medflow_dev_password",
)

MINIO_ENDPOINT = os.environ.get("MEDFLOW_MINIO_ENDPOINT", "http://minio:9000")
MINIO_ACCESS_KEY = os.environ.get("MEDFLOW_MINIO_ACCESS_KEY", "minio_admin")
MINIO_SECRET_KEY = os.environ.get("MEDFLOW_MINIO_SECRET_KEY", "minio_dev_password")

DOC_MD = """
### audit_worm_export

Daily immutable export of the Postgres ``audit_log`` to the WORM audit bucket.

* **Window:** rows with ``event_time`` in ``[ds 00:00, next_ds 00:00)`` (the
  logical day), exported to ``s3://audit-worm/audit/{ds}.jsonl.gz``.
* **Immutability:** the object-locked bucket only accepts PUTs; the exporter
  never deletes/overwrites. The key is deterministic, so retries are safe.
* **Hygiene:** structured logs carry counts and the object key only; rows are
  streamed via a server-side cursor and gzipped in-memory.
"""


def _row_to_jsonable(columns: Any, row: Any) -> Dict[str, Any]:
    record: Dict[str, Any] = {}
    for name, value in zip(columns, row):
        if isinstance(value, (datetime,)):
            record[name] = value.isoformat()
        elif hasattr(value, "isoformat"):  # date / time
            record[name] = value.isoformat()
        elif isinstance(value, (dict, list)):
            record[name] = value
        elif value is None or isinstance(value, (str, int, float, bool)):
            record[name] = value
        else:
            record[name] = str(value)
    return record


def _iter_audit_rows(cursor: Any) -> Iterator[bytes]:
    columns = [desc[0] for desc in cursor.description]
    while True:
        batch = cursor.fetchmany(1000)
        if not batch:
            break
        for row in batch:
            record = _row_to_jsonable(columns, row)
            yield (json.dumps(record, separators=(",", ":")) + "\n").encode("utf-8")


def export_audit_day(**context: Any) -> None:
    """Export one logical day's ``audit_log`` rows to ``audit-worm`` as jsonl.gz."""
    import boto3
    import psycopg2

    ds = context["ds"]
    next_ds = context["next_ds"]
    key = f"audit/{ds}.jsonl.gz"

    log.info(
        "MEDFLOW_AUDIT %s",
        json.dumps({"event": "export_start", "ds": ds, "key": key}),
    )

    buffer = io.BytesIO()
    row_count = 0
    conn = psycopg2.connect(PG_DSN)
    try:
        # Named (server-side) cursor → streams instead of materialising the day.
        with conn.cursor(name="audit_export") as cursor:
            cursor.itersize = 1000
            cursor.execute(
                f"SELECT * FROM {AUDIT_TABLE} "
                f"WHERE {AUDIT_TS_COLUMN} >= %s AND {AUDIT_TS_COLUMN} < %s "
                f"ORDER BY {AUDIT_TS_COLUMN}",
                (ds, next_ds),
            )
            with gzip.GzipFile(fileobj=buffer, mode="wb", mtime=0) as gz:
                for line in _iter_audit_rows(cursor):
                    gz.write(line)
                    row_count += 1
    except Exception as exc:  # noqa: BLE001 - surface as a task failure
        raise AirflowException(f"audit export query failed for {ds}: {exc}") from exc
    finally:
        conn.close()

    buffer.seek(0)
    s3 = boto3.client(
        "s3",
        endpoint_url=MINIO_ENDPOINT,
        aws_access_key_id=MINIO_ACCESS_KEY,
        aws_secret_access_key=MINIO_SECRET_KEY,
    )
    try:
        s3.put_object(
            Bucket=AUDIT_BUCKET,
            Key=key,
            Body=buffer.getvalue(),
            ContentType="application/gzip",
            ContentEncoding="gzip",
        )
    except Exception as exc:  # noqa: BLE001
        raise AirflowException(
            f"audit export PUT to s3://{AUDIT_BUCKET}/{key} failed: {exc}"
        ) from exc

    log.info(
        "MEDFLOW_AUDIT %s",
        json.dumps(
            {
                "event": "export_done",
                "ds": ds,
                "key": f"s3://{AUDIT_BUCKET}/{key}",
                "rows": row_count,
            }
        ),
    )


with DAG(
    dag_id="audit_worm_export",
    description="Daily Postgres audit_log -> s3://audit-worm/audit/{ds}.jsonl.gz",
    schedule="0 1 * * *",
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,
    default_args=medflow_default_args(sla=timedelta(hours=2)),
    sla_miss_callback=sla_miss_callback,
    tags=["medflow", "compliance", "audit", "worm"],
    doc_md=DOC_MD,
) as dag:
    PythonOperator(
        task_id="export_audit_log",
        python_callable=export_audit_day,
    )
