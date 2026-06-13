"""Runnable batch jobs (``python -m medflow_ml.jobs.<name>``).

* ``train_sepsis`` - LSTM early-warning score, registers ``sepsis-ews``.
* ``train_readmission`` - calibrated XGBoost, registers ``readmission-30d``.
* ``train_xray`` - DenseNet121 14-label, registers ``chest-xray-14``.
* ``backfill_features`` - rolling-vitals / encounter / lab features to the
  offline store + Feast materialize.
* ``build_cohorts`` - OMOP cohort materialization to gold/cohorts.
* ``drift_report`` - Evidently data-drift HTML to s3://drift-reports.
"""

from __future__ import annotations
