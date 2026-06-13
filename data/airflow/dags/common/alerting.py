"""Slack-free alerting for MedFlow DAGs.

On task failure (or SLA miss) we:

1. emit a structured JSON log line containing only pipeline *metadata*
   (dag id, task id, logical date, try number) — never row contents, so no
   PHI can leak into logs, and
2. optionally push a counter to a Prometheus pushgateway
   (env ``MEDFLOW_PUSHGATEWAY_URL``, e.g. ``http://pushgateway:9091``); the
   existing Grafana/Alertmanager stack then handles routing. If the env var
   is unset or the push fails, the callback degrades to log-only — alerting
   must never mask the original task failure.

Uses only the standard library (urllib) so it works in the stock Airflow image.
"""
from __future__ import annotations

import json
import logging
import os
import urllib.request
from datetime import timedelta
from typing import Any, Dict, Mapping, Optional

log = logging.getLogger("medflow.alerting")

_PUSHGATEWAY_ENV = "MEDFLOW_PUSHGATEWAY_URL"
_PUSH_TIMEOUT_SECONDS = 5


def push_metric(
    metric: str,
    value: float,
    labels: Mapping[str, str],
    help_text: str = "MedFlow Airflow pipeline metric",
) -> bool:
    """Push a single gauge sample to the pushgateway. Returns True on success.

    Label *values* are pipeline identifiers only (dag/task ids) — no data values.
    """
    base = os.environ.get(_PUSHGATEWAY_ENV)
    if not base:
        return False
    grouping = "".join(
        f"/{k}/{v}" for k, v in sorted(labels.items()) if k in ("dag_id", "task_id")
    )
    url = f"{base.rstrip('/')}/metrics/job/medflow_airflow{grouping}"
    label_str = ",".join(f'{k}="{v}"' for k, v in sorted(labels.items()))
    body = (
        f"# HELP {metric} {help_text}\n"
        f"# TYPE {metric} gauge\n"
        f"{metric}{{{label_str}}} {value}\n"
    ).encode("utf-8")
    request = urllib.request.Request(url, data=body, method="PUT")
    request.add_header("Content-Type", "text/plain; version=0.0.4")
    try:
        with urllib.request.urlopen(request, timeout=_PUSH_TIMEOUT_SECONDS):
            return True
    except Exception as exc:  # noqa: BLE001 - alerting must never fail the task further
        log.warning("pushgateway unreachable, alert logged only: %s", exc)
        return False


def _alert_payload(context: Mapping[str, Any], event: str) -> Dict[str, Any]:
    task_instance = context.get("task_instance")
    return {
        "event": event,
        "dag_id": getattr(context.get("dag"), "dag_id", None),
        "task_id": getattr(task_instance, "task_id", None),
        "logical_date": str(context.get("logical_date") or context.get("execution_date")),
        "try_number": getattr(task_instance, "try_number", None),
        "log_url": getattr(task_instance, "log_url", None),
    }


def task_failure_callback(context: Mapping[str, Any]) -> None:
    """``on_failure_callback`` — structured log + pushgateway counter."""
    payload = _alert_payload(context, "task_failed")
    log.error("MEDFLOW_ALERT %s", json.dumps(payload, default=str))
    push_metric(
        "medflow_airflow_task_failed",
        1.0,
        {
            "dag_id": str(payload["dag_id"]),
            "task_id": str(payload["task_id"]),
        },
        help_text="1 when a MedFlow Airflow task instance fails",
    )


def sla_miss_callback(dag: Any, task_list: Any, blocking_task_list: Any, slas: Any, blocking_tis: Any) -> None:
    """``sla_miss_callback`` for DAGs — same structured-log + metric pattern."""
    payload = {
        "event": "sla_missed",
        "dag_id": getattr(dag, "dag_id", None),
        "slas": [str(s) for s in (slas or [])],
    }
    log.error("MEDFLOW_ALERT %s", json.dumps(payload, default=str))
    push_metric(
        "medflow_airflow_sla_missed",
        1.0,
        {"dag_id": str(payload["dag_id"]), "task_id": "_dag"},
        help_text="1 when a MedFlow DAG misses its SLA",
    )


def medflow_default_args(sla: Optional[timedelta] = timedelta(hours=1)) -> Dict[str, Any]:
    """Standard ``default_args`` for every MedFlow DAG.

    Retries use exponential backoff (1m → 2m → 4m, capped at 30m).
    """
    args: Dict[str, Any] = {
        "owner": "medflow-data",
        "depends_on_past": False,
        "retries": 3,
        "retry_delay": timedelta(minutes=1),
        "retry_exponential_backoff": True,
        "max_retry_delay": timedelta(minutes=30),
        "on_failure_callback": task_failure_callback,
    }
    if sla is not None:
        args["sla"] = sla
    return args
