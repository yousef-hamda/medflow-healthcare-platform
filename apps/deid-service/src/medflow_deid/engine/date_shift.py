"""Deterministic per-patient date shifting.

Design
------
Safe Harbor requires removing all date elements more specific than the year,
but research pipelines need *temporal relationships* (time between admission
and discharge, dosing intervals, trend curves). The standard compromise is a
**consistent random shift per patient**:

- offset = ``HMAC-SHA256(DATE_SHIFT_SECRET, patient_id)`` mapped into
  ``±[1, 365]`` days (never 0 — every date moves);
- the *same* offset is applied to *every* date belonging to that patient, so
  all intra-patient intervals are preserved exactly;
- different patients get statistically independent offsets, so cross-patient
  date alignment is destroyed.

Properties:

- **Deterministic**: re-processing the same patient (today or next year, on
  any replica) yields identical shifted dates — joins across de-identified
  datasets keep working.
- **Keyed**: without ``DATE_SHIFT_SECRET`` the offset is not recoverable from
  the output; HMAC (not a bare hash) prevents offset recovery by brute-forcing
  patient_id values.
- **Bounded**: |offset| <= 365 days keeps ages/era of treatment roughly
  truthful for research while breaking linkage to real calendar dates.

Precision handling for FHIR partial dates (``shift_fhir_date``): the shift is
applied at day granularity to the *earliest instant* of the partial date, then
re-truncated to the original precision (``YYYY``, ``YYYY-MM``, ``YYYY-MM-DD``,
or full datetime with the time-of-day and UTC offset preserved). At year
precision a ±365-day shift can change the year by at most one.
"""

from __future__ import annotations

import hashlib
import hmac
import re
from datetime import date, datetime, timedelta

MAX_SHIFT_DAYS = 365

_YEAR_RE = re.compile(r"^\d{4}$")
_YEAR_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_DATETIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$")

FHIR_DATE_RE = re.compile(
    r"^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?)?)?$"
)


def patient_offset_days(secret: str, patient_id: str) -> int:
    """Deterministic offset in ``±[1, 365]`` days for *patient_id* under *secret*."""
    digest = hmac.new(secret.encode("utf-8"), patient_id.encode("utf-8"), hashlib.sha256).digest()
    magnitude = (int.from_bytes(digest[:8], "big") % MAX_SHIFT_DAYS) + 1
    sign = 1 if digest[8] & 1 == 0 else -1
    return sign * magnitude


def shift_fhir_date(value: str, offset_days: int) -> str:
    """Shift a FHIR date/dateTime string by *offset_days*, preserving precision.

    Unparseable values are returned unchanged (callers gate on FHIR_DATE_RE).
    """
    delta = timedelta(days=offset_days)
    if _YEAR_RE.match(value):
        return str((date(int(value), 1, 1) + delta).year)
    if _YEAR_MONTH_RE.match(value):
        shifted = date(int(value[:4]), int(value[5:7]), 1) + delta
        return f"{shifted.year:04d}-{shifted.month:02d}"
    if _DATE_RE.match(value):
        return (date.fromisoformat(value) + delta).isoformat()
    if _DATETIME_RE.match(value):
        had_zulu = value.endswith("Z")
        parsed = datetime.fromisoformat(value[:-1] + "+00:00" if had_zulu else value)
        shifted_dt = parsed + delta
        out = shifted_dt.isoformat()
        if had_zulu and out.endswith("+00:00"):
            out = out[:-6] + "Z"
        return out
    return value
