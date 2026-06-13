"""Safe Harbor ZIP code generalisation.

Safe Harbor permits keeping the initial three digits of a ZIP code only when
the geographic unit formed by all ZIPs sharing those digits contains more than
20,000 people. The 17 three-digit prefixes below fail that test (per the
HHS/Census list) and must be reported as ``000``.
"""

from __future__ import annotations

import re

RESTRICTED_ZIP3: frozenset[str] = frozenset(
    {
        "036",
        "059",
        "063",
        "102",
        "203",
        "556",
        "692",
        "790",
        "821",
        "823",
        "830",
        "831",
        "878",
        "879",
        "884",
        "890",
        "893",
    }
)


def zip3(zip_code: str) -> str:
    """Truncate a ZIP (5-digit or ZIP+4) to 3 digits, mapping restricted prefixes to 000.

    Anything that does not contain at least five digits is treated as
    unparseable and conservatively returned as ``"000"``.
    """
    digits = re.sub(r"\D", "", zip_code or "")
    if len(digits) < 5:
        return "000"
    prefix = digits[:3]
    return "000" if prefix in RESTRICTED_ZIP3 else prefix
