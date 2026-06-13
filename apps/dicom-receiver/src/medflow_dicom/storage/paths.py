"""Object-key construction with strict path-segment sanitisation.

PatientID / UIDs come straight off the wire from a modality, so they must be
treated as untrusted input: no path traversal, no separators, no empty
segments.
"""

from __future__ import annotations

import re

_UNSAFE = re.compile(r"[^A-Za-z0-9._-]")
_MAX_SEGMENT = 128
FALLBACK_SEGMENT = "UNKNOWN"


def sanitize_segment(value: str) -> str:
    """Make an arbitrary string safe to use as a single object-key segment.

    - keeps only ``[A-Za-z0-9._-]``, replacing everything else with ``_``
    - strips leading/trailing dots (prevents ``..`` traversal and hidden files)
    - caps length at 128 chars
    - falls back to ``UNKNOWN`` when nothing usable remains
    """
    cleaned = _UNSAFE.sub("_", value.strip())[:_MAX_SEGMENT].strip(".")
    if not cleaned or not set(cleaned) - {"_", ".", "-"}:
        return FALLBACK_SEGMENT
    return cleaned


def instance_key(patient_id: str, study_uid: str, instance_uid: str) -> str:
    """Key inside the ``imaging`` bucket for the raw DICOM file."""
    return (
        f"{sanitize_segment(patient_id)}/"
        f"{sanitize_segment(study_uid)}/"
        f"{sanitize_segment(instance_uid)}.dcm"
    )


def preview_key(patient_id: str, study_uid: str, instance_uid: str) -> str:
    """Key inside the ``imaging`` bucket for the 224x224 PNG preview."""
    return (
        f"{sanitize_segment(patient_id)}/"
        f"{sanitize_segment(study_uid)}/"
        f"{sanitize_segment(instance_uid)}.preview.png"
    )
