"""Superset configuration for the MedFlow local stack.

Loaded via PYTHONPATH (/app/pythonpath). Dev-only defaults; production uses
Vault-injected secrets and an external metadata database.
"""

import os

# ── Metadata database ────────────────────────────────────────────────────────
DATABASE_USER = os.environ.get("DATABASE_USER", "medflow")
DATABASE_PASSWORD = os.environ.get("DATABASE_PASSWORD", "medflow_dev_password")
DATABASE_HOST = os.environ.get("DATABASE_HOST", "postgres")
DATABASE_PORT = os.environ.get("DATABASE_PORT", "5432")
DATABASE_DB = os.environ.get("DATABASE_DB", "superset")

SQLALCHEMY_DATABASE_URI = os.environ.get(
    "SQLALCHEMY_DATABASE_URI",
    f"postgresql+psycopg2://{DATABASE_USER}:{DATABASE_PASSWORD}"
    f"@{DATABASE_HOST}:{DATABASE_PORT}/{DATABASE_DB}",
)

SECRET_KEY = os.environ.get("SUPERSET_SECRET_KEY", "medflow-dev-superset-secret")

# ── Caching (Redis when available, falls back to in-memory) ─────────────────
REDIS_URL = os.environ.get("REDIS_URL")
if REDIS_URL:
    CACHE_CONFIG = {
        "CACHE_TYPE": "RedisCache",
        "CACHE_DEFAULT_TIMEOUT": 300,
        "CACHE_KEY_PREFIX": "superset_",
        "CACHE_REDIS_URL": REDIS_URL,
    }
    DATA_CACHE_CONFIG = {**CACHE_CONFIG, "CACHE_KEY_PREFIX": "superset_data_"}

# ── Feature flags ────────────────────────────────────────────────────────────
FEATURE_FLAGS = {
    "DASHBOARD_NATIVE_FILTERS": True,
    "DASHBOARD_CROSS_FILTERS": True,
    "ENABLE_TEMPLATE_PROCESSING": True,
    "DRILL_TO_DETAIL": True,
    "DRILL_BY": True,
    "EMBEDDED_SUPERSET": False,
    "ALERT_REPORTS": False,
}

# ── Limits / behaviour ───────────────────────────────────────────────────────
ROW_LIMIT = 5000
SQL_MAX_ROW = 100000
SUPERSET_WEBSERVER_TIMEOUT = 120
WTF_CSRF_ENABLED = True
WTF_CSRF_EXEMPT_LIST = []
TALISMAN_ENABLED = False  # local HTTP only; enable behind TLS in production

# OMOP analytics run against Trino, never the operational FHIR database.
PREFERRED_DATABASES = ["Trino", "PostgreSQL"]
