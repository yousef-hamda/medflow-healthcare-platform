"""Clinical note NLP via medspaCy: target rules + ConText negation.

PHI policy: the raw note text is never logged or persisted. The API returns
only the matched lexicon term (``text_span_redacted``) - i.e. the clinical
concept that fired the rule, never surrounding free text - plus the label,
optional concept code, and ConText negation status.

If medspaCy/spaCy are unavailable (slim dev image), a deterministic
rule-based fallback using the same lexicon and a simple negation-trigger
window is served, with model_version "nlp-fallback-rules-v1".
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from medflow_serving.logging_utils import get_logger

log = get_logger(__name__)

MEDSPACY_VERSION = "medspacy-context-v1"
FALLBACK_VERSION = "nlp-fallback-rules-v1"

# (phrase, label, concept_code) - codes are illustrative SNOMED-CT / RxNorm.
TARGET_LEXICON: tuple[tuple[str, str, str | None], ...] = (
    ("sepsis", "PROBLEM", "91302008"),
    ("septic shock", "PROBLEM", "76571007"),
    ("pneumonia", "PROBLEM", "233604007"),
    ("heart failure", "PROBLEM", "84114007"),
    ("chf", "PROBLEM", "84114007"),
    ("copd", "PROBLEM", "13645005"),
    ("diabetes", "PROBLEM", "73211009"),
    ("hypertension", "PROBLEM", "38341003"),
    ("atrial fibrillation", "PROBLEM", "49436004"),
    ("chronic kidney disease", "PROBLEM", "709044004"),
    ("uti", "PROBLEM", "68566005"),
    ("urinary tract infection", "PROBLEM", "68566005"),
    ("metformin", "MEDICATION", "6809"),
    ("lisinopril", "MEDICATION", "29046"),
    ("furosemide", "MEDICATION", "4603"),
    ("warfarin", "MEDICATION", "11289"),
    ("insulin", "MEDICATION", "5856"),
    ("vancomycin", "MEDICATION", "11124"),
    ("piperacillin-tazobactam", "MEDICATION", "74170"),
    ("ceftriaxone", "MEDICATION", "2193"),
    ("aspirin", "MEDICATION", "1191"),
    ("penicillin", "ALLERGY", "7980"),
    ("sulfa", "ALLERGY", "10831"),
    ("latex", "ALLERGY", "111088007"),
    ("peanut", "ALLERGY", "256349002"),
)

_NEGATION_TRIGGERS = (
    "no",
    "denies",
    "denied",
    "without",
    "negative for",
    "no evidence of",
    "ruled out",
    "not",
    "free of",
)


@dataclass(frozen=True)
class ExtractedEntity:
    text_span_redacted: str
    label: str
    concept_code: str | None
    negated: bool


class NotesNlpEngine:
    """Lazily builds the medspaCy pipeline once; falls back to pure rules."""

    def __init__(self) -> None:
        self._nlp: Any | None = None
        self._load_failed = False

    @property
    def model_version(self) -> str:
        return FALLBACK_VERSION if self._load_failed or self._nlp is None else MEDSPACY_VERSION

    def extract(self, text: str) -> list[ExtractedEntity]:
        nlp = self._pipeline()
        if nlp is None:
            return fallback_extract(text)
        doc = nlp(text)
        entities: list[ExtractedEntity] = []
        for ent in doc.ents:
            entities.append(
                ExtractedEntity(
                    # Redaction: only the lexicon term that matched, lowercased,
                    # never surrounding note text.
                    text_span_redacted=ent.text.lower(),
                    label=str(ent.label_),
                    concept_code=getattr(ent._, "concept_code", None),
                    negated=bool(getattr(ent._, "is_negated", False)),
                )
            )
        return entities

    def _pipeline(self) -> Any | None:
        if self._nlp is not None or self._load_failed:
            return self._nlp
        try:
            self._nlp = build_medspacy_pipeline()
        except Exception as exc:
            self._load_failed = True
            log.warning("medspacy_unavailable_using_rule_fallback", error=str(exc))
        return self._nlp


def build_medspacy_pipeline() -> Any:
    """medspaCy pipeline: tokenizer + TargetMatcher rules + ConText negation."""
    import medspacy  # noqa: PLC0415
    from medspacy.ner import TargetRule  # noqa: PLC0415
    from spacy.tokens import Span  # noqa: PLC0415

    if not Span.has_extension("concept_code"):
        Span.set_extension("concept_code", default=None)

    nlp = medspacy.load(enable=["medspacy_tokenizer", "medspacy_target_matcher", "medspacy_context"])
    matcher = nlp.get_pipe("medspacy_target_matcher")
    rules = [
        TargetRule(
            literal=phrase,
            category=label,
            attributes={"concept_code": code},
        )
        for phrase, label, code in TARGET_LEXICON
    ]
    matcher.add(rules)
    return nlp


def fallback_extract(text: str) -> list[ExtractedEntity]:
    """Pure-python lexicon matcher with a 5-token negation-trigger window.

    Deterministic and dependency-free; used in tests and slim images.
    """
    lowered = text.lower()
    entities: list[ExtractedEntity] = []
    for phrase, label, code in TARGET_LEXICON:
        for match in re.finditer(rf"\b{re.escape(phrase)}\b", lowered):
            window_start = max(0, match.start() - 60)
            preceding = lowered[window_start : match.start()]
            preceding_tokens = preceding.split()[-5:]
            window_text = " ".join(preceding_tokens)
            negated = any(
                re.search(rf"\b{re.escape(trigger)}\b", window_text)
                for trigger in _NEGATION_TRIGGERS
            )
            entities.append(
                ExtractedEntity(
                    text_span_redacted=phrase,
                    label=label,
                    concept_code=code,
                    negated=negated,
                )
            )
    entities.sort(key=lambda e: (e.label, e.text_span_redacted))
    return entities
