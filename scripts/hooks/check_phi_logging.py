#!/usr/bin/env python3
"""Pre-commit hook: flag PHI-looking values passed to loggers.

HIPAA-aware guard: log statements must never carry patient identifiers.
This checker has two modes, chosen per file extension (or forced with
``--mode``):

* **Python (AST mode)** — walks the AST and flags any ``ast.Call`` whose
  function is a logging method (``logger.info``, ``log.error``,
  ``logging.warning``, ``self.logger.debug``, ...) when any positional or
  keyword argument references a PHI-looking identifier (``ast.Name`` /
  ``ast.Attribute`` / keyword name / f-string expression) or a PHI-looking
  string key (dict keys and subscript indexes such as ``row["ssn"]``).

* **TypeScript/JavaScript (regex mode)** — flags ``console.*`` / ``logger.*``
  / ``log.*`` call lines that mention a PHI key.

PHI keys: name, mrn, ssn, dob, birth_date, phone, email, address,
patient_name (snake_case and camelCase forms both match; e.g. ``patientName``
and ``birthDate`` are caught).

Suppression: append ``# phi-ok: <reason>`` (Python) or ``// phi-ok: <reason>``
(TS/JS) on any line of the offending statement. A reason is required — bare
``phi-ok`` does not suppress.

Usage:
    python3 scripts/hooks/check_phi_logging.py FILE [FILE...]
    python3 scripts/hooks/check_phi_logging.py --mode ts src/**/*.ts

Exit codes: 0 = clean, 1 = findings, 2 = usage/parse error.
"""
from __future__ import annotations

import argparse
import ast
import re
import sys
from typing import Iterable, List, Optional, Sequence, Tuple

PHI_KEYS = frozenset({
    "name", "mrn", "ssn", "dob", "birth_date", "phone", "email",
    "address", "patient_name",
})
# Multi-token keys checked against the joined normalized identifier.
PHI_MULTI = tuple(k for k in PHI_KEYS if "_" in k)

LOG_METHODS = frozenset({
    "debug", "info", "warning", "warn", "error", "critical",
    "exception", "fatal", "log", "trace",
})
LOGGER_BASES = frozenset({"logger", "log", "logging"})

SUPPRESS_RE = re.compile(r"(#|//)\s*phi-ok:\s*\S")
TS_LOG_LINE_RE = re.compile(r"\b(?:console|logger|log)\s*\.\s*(?:%s)\s*\(" % "|".join(LOG_METHODS))
WORD_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
CAMEL_RE = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")

Finding = Tuple[str, int, str]  # (path, lineno, message)


def normalize(identifier: str) -> List[str]:
    """patientName -> ['patient', 'name']; birth_date -> ['birth', 'date']."""
    snake = CAMEL_RE.sub("_", identifier).lower()
    return [seg for seg in snake.split("_") if seg]


def phi_match(identifier: str) -> Optional[str]:
    """Return the PHI key an identifier matches, if any."""
    segments = normalize(identifier)
    joined = "_".join(segments)
    for key in PHI_MULTI:
        if key in joined:
            return key
    for seg in segments:
        if seg in PHI_KEYS:
            return seg
    return None


# ── Python AST mode ───────────────────────────────────────────────────────────
def _dotted_parts(node: ast.AST) -> List[str]:
    """Collect name parts of a dotted expression: self.logger.info -> [self, logger, info]."""
    parts: List[str] = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
    elif isinstance(node, ast.Call):
        # logging.getLogger(__name__).info(...) — descend into the call's func.
        parts.extend(_dotted_parts(node.func))
    return list(reversed(parts))


def _is_log_call(call: ast.Call) -> bool:
    func = call.func
    if not isinstance(func, ast.Attribute) or func.attr not in LOG_METHODS:
        return False
    base_parts = [p.lower() for p in _dotted_parts(func.value)]
    return any(p in LOGGER_BASES or p == "getlogger" for p in base_parts)


def _phi_in_expr(node: ast.AST) -> Iterable[Tuple[str, str]]:
    """Yield (kind, key) for PHI references inside one argument expression."""
    for sub in ast.walk(node):
        if isinstance(sub, ast.Name):
            key = phi_match(sub.id)
            if key:
                yield (f"identifier '{sub.id}'", key)
        elif isinstance(sub, ast.Attribute):
            key = phi_match(sub.attr)
            if key:
                yield (f"attribute '.{sub.attr}'", key)
        elif isinstance(sub, ast.Dict):
            for k in sub.keys:
                if isinstance(k, ast.Constant) and isinstance(k.value, str):
                    key = phi_match(k.value)
                    if key:
                        yield (f"dict key '{k.value}'", key)
        elif isinstance(sub, ast.Subscript):
            sl = sub.slice
            # Py3.9: plain index is the expression itself (ast.Index removed).
            if isinstance(sl, ast.Constant) and isinstance(sl.value, str):
                key = phi_match(sl.value)
                if key:
                    yield (f"subscript ['{sl.value}']", key)


def _suppressed(lines: Sequence[str], node: ast.AST) -> bool:
    start = getattr(node, "lineno", 1) - 1
    end = getattr(node, "end_lineno", start + 1)
    return any(SUPPRESS_RE.search(lines[i]) for i in range(start, min(end, len(lines))))


def check_python_source(source: str, path: str) -> List[Finding]:
    try:
        tree = ast.parse(source, filename=path)
    except SyntaxError as exc:
        return [(path, exc.lineno or 0, f"could not parse file: {exc.msg}")]
    lines = source.splitlines()
    findings: List[Finding] = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and _is_log_call(node)):
            continue
        if _suppressed(lines, node):
            continue
        hits: List[Tuple[str, str]] = []
        for arg in node.args:
            hits.extend(_phi_in_expr(arg))
        for kw in node.keywords:
            if kw.arg:
                key = phi_match(kw.arg)
                if key:
                    hits.append((f"keyword '{kw.arg}='", key))
            hits.extend(_phi_in_expr(kw.value))
        for desc, key in hits:
            findings.append((
                path, node.lineno,
                f"PHI-looking {desc} (matches '{key}') passed to a log call — "
                "remove it or add `# phi-ok: <reason>`",
            ))
    return findings


# ── TypeScript / JavaScript regex mode ────────────────────────────────────────
def check_ts_source(source: str, path: str) -> List[Finding]:
    findings: List[Finding] = []
    for lineno, line in enumerate(source.splitlines(), start=1):
        if not TS_LOG_LINE_RE.search(line):
            continue
        if SUPPRESS_RE.search(line):
            continue
        # Only inspect what is passed to the call, not the method chain itself.
        call_part = line[TS_LOG_LINE_RE.search(line).end():]
        for word in WORD_RE.findall(call_part):
            key = phi_match(word)
            if key:
                findings.append((
                    path, lineno,
                    f"PHI-looking token '{word}' (matches '{key}') in a log call — "
                    "remove it or add `// phi-ok: <reason>`",
                ))
                break  # one finding per line is enough
    return findings


# ── CLI ───────────────────────────────────────────────────────────────────────
def check_file(path: str, mode: str) -> List[Finding]:
    if mode == "auto":
        mode = "ts" if path.endswith((".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs")) else "python"
    try:
        with open(path, encoding="utf-8") as fh:
            source = fh.read()
    except OSError as exc:
        return [(path, 0, f"could not read file: {exc}")]
    if mode == "ts":
        return check_ts_source(source, path)
    return check_python_source(source, path)


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Flag PHI-looking values in log calls")
    parser.add_argument("files", nargs="+", help="files to check")
    parser.add_argument("--mode", choices=("auto", "python", "ts"), default="auto",
                        help="force a mode (default: auto by extension)")
    args = parser.parse_args(argv)

    findings: List[Finding] = []
    for path in args.files:
        findings.extend(check_file(path, args.mode))

    for path, lineno, message in findings:
        print(f"{path}:{lineno}: {message}")
    if findings:
        print(f"\ncheck_phi_logging: {len(findings)} finding(s). "
              "Logs must never contain patient identifiers.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
