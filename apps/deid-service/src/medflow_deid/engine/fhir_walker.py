"""HIPAA Safe Harbor walker for FHIR Patient / Observation / DocumentReference.

Transformations (input is never mutated; a de-identified deep copy is built):

- ``name``, ``telecom``, ``photo``, ``contact``  → removed
- ``address``        → state kept, postalCode truncated to ZIP3 (restricted
                       prefixes → ``000``); street/city/district/text dropped
- ``birthDate``      → year only; ages >= 90 at the reference date are
                       aggregated to the single value ``"1930"`` (Safe Harbor
                       requires one 90+ bucket; a fixed floor year also caps
                       the implied age)
- ``identifier``     → replaced by a salted-HMAC pseudonym under
                       ``urn:medflow:pseudonym`` (deterministic: same input id
                       → same pseudonym, so longitudinal linkage survives)
- ``id`` / ``reference`` strings → resource ids pseudonymised the same way
- narrative ``text.div`` and free-text fields → run through the text engine
- every other date/dateTime field → shifted by the per-patient offset
  (see ``date_shift`` — intervals preserved, calendar linkage broken)

The per-patient offset is keyed on the ORIGINAL patient id (Patient.id, or the
subject reference for Observation/DocumentReference) before pseudonymisation.
"""

from __future__ import annotations

import copy
import hashlib
import hmac
import re
from datetime import date
from typing import Any

from medflow_deid.engine.analyzer import TextDeidentifier, get_text_engine
from medflow_deid.engine.date_shift import FHIR_DATE_RE, patient_offset_days, shift_fhir_date
from medflow_deid.engine.zip3 import zip3

SUPPORTED_RESOURCE_TYPES: frozenset[str] = frozenset(
    {"Patient", "Observation", "DocumentReference"}
)

AGE_AGGREGATION_THRESHOLD = 90
AGE_AGGREGATION_YEAR = "1930"

_PSEUDONYM_DOMAIN = b"medflow-pseudonym:"
_REFERENCE_RE = re.compile(r"^([A-Za-z]+)/([A-Za-z0-9][A-Za-z0-9.\-]{0,63})$")

# Keys whose partial-date string values (YYYY / YYYY-MM) are still shifted;
# full dates and datetimes are shifted wherever they appear.
_DATEISH_KEYS = frozenset(
    {"start", "end", "issued", "authoredon", "created", "recorded", "timestamp"}
)

_FREE_TEXT_KEYS = frozenset({"div", "description", "title", "comment", "note"})


def pseudonymize(secret: str, value: str) -> str:
    """Deterministic keyed pseudonym (domain-separated from the date-shift HMAC)."""
    mac = hmac.new(secret.encode("utf-8"), _PSEUDONYM_DOMAIN + value.encode("utf-8"), hashlib.sha256)
    return mac.hexdigest()[:16]


def deidentify_resource(
    resource: dict[str, Any],
    secret: str,
    reference_date: date | None = None,
    text_engine: TextDeidentifier | None = None,
) -> tuple[dict[str, Any], list[str]]:
    """Return (de-identified copy, sorted entity types removed/transformed)."""
    resource_type = resource.get("resourceType")
    if resource_type not in SUPPORTED_RESOURCE_TYPES:
        raise ValueError(f"unsupported resourceType: {resource_type!r}")
    reference_date = reference_date or date.today()
    text_engine = text_engine or get_text_engine()

    out: dict[str, Any] = copy.deepcopy(resource)
    removed: set[str] = set()

    patient_id = _source_patient_id(out)
    offset_days = patient_offset_days(secret, patient_id)

    if resource_type == "Patient":
        _deidentify_patient(out, removed, reference_date)

    if out.get("identifier"):
        out["identifier"] = [
            {
                "system": "urn:medflow:pseudonym",
                "value": pseudonymize(secret, str(ident.get("value", ""))),
            }
            for ident in out["identifier"]
            if isinstance(ident, dict)
        ]
        removed.add("IDENTIFIER")

    if isinstance(out.get("id"), str):
        out["id"] = pseudonymize(secret, out["id"])
        removed.add("IDENTIFIER")

    _walk(out, removed, offset_days, secret, text_engine)

    return out, sorted(removed)


def _source_patient_id(resource: dict[str, Any]) -> str:
    """Original patient id used to key the date-shift offset."""
    if resource.get("resourceType") == "Patient":
        return str(resource.get("id") or "unknown")
    subject = resource.get("subject")
    if isinstance(subject, dict):
        match = _REFERENCE_RE.match(str(subject.get("reference", "")))
        if match:
            return match.group(2)
    return str(resource.get("id") or "unknown")


def _deidentify_patient(out: dict[str, Any], removed: set[str], reference_date: date) -> None:
    if out.pop("name", None) is not None:
        removed.add("NAME")
    if out.pop("telecom", None) is not None:
        removed.add("CONTACT")
    if out.pop("photo", None) is not None:
        removed.add("PHOTO")
    if out.pop("contact", None) is not None:
        removed.add("CONTACT")

    addresses = out.get("address")
    if isinstance(addresses, list) and addresses:
        out["address"] = [_generalise_address(addr) for addr in addresses if isinstance(addr, dict)]
        removed.add("ADDRESS")

    birth_date = out.get("birthDate")
    if isinstance(birth_date, str) and len(birth_date) >= 4 and birth_date[:4].isdigit():
        out["birthDate"] = _generalise_birth_date(birth_date, reference_date)
        removed.add("BIRTHDATE")

    if out.pop("deceasedDateTime", None) is not None:
        # Death date is a Safe Harbor date element; year-of-death generalisation
        # is out of scope here, so keep only the boolean fact.
        out["deceasedBoolean"] = True
        removed.add("DECEASED_DATE")


def _generalise_address(addr: dict[str, Any]) -> dict[str, Any]:
    kept: dict[str, Any] = {}
    if isinstance(addr.get("state"), str):
        kept["state"] = addr["state"]
    if isinstance(addr.get("country"), str):
        kept["country"] = addr["country"]
    if isinstance(addr.get("postalCode"), str):
        kept["postalCode"] = zip3(addr["postalCode"])
    return kept


def _generalise_birth_date(birth_date: str, reference_date: date) -> str:
    birth_year = int(birth_date[:4])
    age = reference_date.year - birth_year
    try:  # refine with month/day when present: not yet had birthday this year
        if len(birth_date) >= 10:
            born = date.fromisoformat(birth_date[:10])
            if (reference_date.month, reference_date.day) < (born.month, born.day):
                age -= 1
    except ValueError:
        pass
    if age >= AGE_AGGREGATION_THRESHOLD:
        return AGE_AGGREGATION_YEAR
    return str(birth_year)


def _walk(
    node: Any,
    removed: set[str],
    offset_days: int,
    secret: str,
    text_engine: TextDeidentifier,
) -> None:
    """Recursively shift dates, pseudonymise references and scrub free text in place."""
    if isinstance(node, list):
        for item in node:
            _walk(item, removed, offset_days, secret, text_engine)
        return
    if not isinstance(node, dict):
        return

    for key, value in list(node.items()):
        if isinstance(value, (dict, list)):
            _walk(value, removed, offset_days, secret, text_engine)
            continue
        if not isinstance(value, str):
            continue

        if key == "reference":
            match = _REFERENCE_RE.match(value)
            if match:
                node[key] = f"{match.group(1)}/{pseudonymize(secret, match.group(2))}"
                removed.add("FHIR_REFERENCE")
            continue
        if key == "display":  # human names ride along on references
            del node[key]
            removed.add("NAME")
            continue
        if key in _FREE_TEXT_KEYS:
            scrubbed, types = text_engine.scrub(value)
            node[key] = scrubbed
            removed.update(types)
            continue
        if key == "birthDate":  # already generalised for Patient; never shift
            continue
        if FHIR_DATE_RE.match(value) and (len(value) >= 10 or key.lower() in _DATEISH_KEYS):
            node[key] = shift_fhir_date(value, offset_days)
            removed.add("DATE")
