"""Free-text PHI detection: Presidio AnalyzerEngine + custom regex recognizers.

Custom recognizers (always active, in both modes):

- ``MRN``            — medical record numbers, ``MRN: 1234567`` style
- ``PHONE_NUMBER``   — US (NANP) and Israeli (landline/mobile, +972/0) patterns
- ``FHIR_REFERENCE`` — literal FHIR references (``Patient/abc-123``), which
                       leak resource ids into narrative text
- ``EMAIL_ADDRESS`` / ``US_SSN`` — cheap, high-precision extras

Degraded mode: Presidio (and its spaCy model) is a heavy dependency. If
``presidio_analyzer`` is not importable, this module transparently falls back
to the regex recognizers above. That keeps the unit tests runnable with the
standard library + pydantic only, and keeps the service usable in minimal
images — at the cost of NLP-based detection (PERSON, LOCATION, free-form
dates), which is documented as residual risk in the README. The active mode is
exported via the ``deid_presidio_enabled`` gauge and ``/healthz``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache

import structlog

from medflow_deid.metrics import PRESIDIO_ENABLED

log = structlog.get_logger(__name__)

try:  # pragma: no cover - environment-dependent
    from presidio_analyzer import AnalyzerEngine, Pattern, PatternRecognizer

    PRESIDIO_AVAILABLE = True
except ImportError:  # pragma: no cover - environment-dependent
    AnalyzerEngine = Pattern = PatternRecognizer = None  # type: ignore[assignment, misc]
    PRESIDIO_AVAILABLE = False

MRN_PATTERN = r"\bMRN[:\s]*\d{6,10}\b"
US_PHONE_PATTERN = r"(?<!\d)(?:\+1[-.\s]?)?(?:\(\d{3}\)\s?|\d{3}[-.\s])\d{3}[-.\s]?\d{4}(?!\d)"
IL_PHONE_PATTERN = (
    r"(?<!\d)(?:\+972[-.\s]?(?:[23489]|5\d|77)|0(?:[23489]|5\d|77))[-.\s]?\d{3}[-.\s]?\d{4}(?!\d)"
)
FHIR_REFERENCE_PATTERN = (
    r"\b(?:Patient|Practitioner|RelatedPerson|Person|Encounter|Observation"
    r"|DocumentReference|Organization|Location)/[A-Za-z0-9][A-Za-z0-9.\-]{0,63}\b"
)
EMAIL_PATTERN = r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"
SSN_PATTERN = r"\b\d{3}-\d{2}-\d{4}\b"

# entity_type -> compiled regex; used directly in degraded mode and wrapped as
# Presidio PatternRecognizers otherwise.
CUSTOM_PATTERNS: dict[str, list[str]] = {
    "MRN": [MRN_PATTERN],
    "PHONE_NUMBER": [US_PHONE_PATTERN, IL_PHONE_PATTERN],
    "FHIR_REFERENCE": [FHIR_REFERENCE_PATTERN],
    "EMAIL_ADDRESS": [EMAIL_PATTERN],
    "US_SSN": [SSN_PATTERN],
}

PRESIDIO_ENTITIES = [
    "PERSON",
    "PHONE_NUMBER",
    "EMAIL_ADDRESS",
    "US_SSN",
    "LOCATION",
    "DATE_TIME",
    "URL",
    "IP_ADDRESS",
    "MRN",
    "FHIR_REFERENCE",
]

MIN_SCORE = 0.4


@dataclass(frozen=True)
class PhiSpan:
    """One detected PHI span. Offsets index into the original text."""

    entity_type: str
    start: int
    end: int


class TextDeidentifier:
    """Detect and replace PHI spans in free text.

    Replacement is type-tagged (``[PHONE_NUMBER]``) so downstream consumers can
    see *what* was removed without ever seeing the value.
    """

    def __init__(self, use_presidio: bool | None = None) -> None:
        if use_presidio is None:
            use_presidio = PRESIDIO_AVAILABLE
        self._analyzer = self._build_presidio() if use_presidio else None
        self.presidio_active = self._analyzer is not None
        PRESIDIO_ENABLED.set(1 if self.presidio_active else 0)
        if not self.presidio_active:
            log.warning("presidio_unavailable_regex_only_mode")

    @staticmethod
    def _build_presidio() -> object | None:  # pragma: no cover - needs presidio
        if not PRESIDIO_AVAILABLE:
            return None
        try:
            analyzer = AnalyzerEngine()
            for entity_type, patterns in CUSTOM_PATTERNS.items():
                analyzer.registry.add_recognizer(
                    PatternRecognizer(
                        supported_entity=entity_type,
                        patterns=[
                            Pattern(name=f"{entity_type}_{i}", regex=pattern, score=0.85)
                            for i, pattern in enumerate(patterns)
                        ],
                    )
                )
            return analyzer
        except Exception:
            log.warning("presidio_init_failed_falling_back_to_regex", exc_info=True)
            return None

    def analyze(self, text: str) -> list[PhiSpan]:
        if self._analyzer is not None:  # pragma: no cover - needs presidio
            results = self._analyzer.analyze(
                text=text, language="en", entities=PRESIDIO_ENTITIES, score_threshold=MIN_SCORE
            )
            spans = [PhiSpan(r.entity_type, r.start, r.end) for r in results]
        else:
            spans = [
                PhiSpan(entity_type, match.start(), match.end())
                for entity_type, patterns in CUSTOM_PATTERNS.items()
                for pattern in patterns
                for match in re.finditer(pattern, text)
            ]
        return _merge_overlaps(spans)

    def scrub(self, text: str) -> tuple[str, list[str]]:
        """Return (de-identified text, sorted unique entity types removed)."""
        spans = self.analyze(text)
        out = text
        for span in sorted(spans, key=lambda s: s.start, reverse=True):
            out = out[: span.start] + f"[{span.entity_type}]" + out[span.end :]
        return out, sorted({span.entity_type for span in spans})


def _merge_overlaps(spans: list[PhiSpan]) -> list[PhiSpan]:
    """Drop spans fully or partially covered by an earlier-starting/longer span."""
    merged: list[PhiSpan] = []
    for span in sorted(spans, key=lambda s: (s.start, -(s.end - s.start))):
        if merged and span.start < merged[-1].end:
            if span.end > merged[-1].end:  # extend, keep first span's type
                merged[-1] = PhiSpan(merged[-1].entity_type, merged[-1].start, span.end)
            continue
        merged.append(span)
    return merged


@lru_cache(maxsize=1)
def get_text_engine() -> TextDeidentifier:
    return TextDeidentifier()
