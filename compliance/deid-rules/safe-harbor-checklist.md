# HIPAA Safe Harbor checklist — all 18 identifiers

Per **§164.514(b)(2)(i)(A–R)**: the Safe Harbor method requires removing all 18 listed identifier
types of the individual *and* of relatives, employers, and household members, and that the covered
entity has no actual knowledge the residual data could re-identify. This table maps every identifier
to its **MedFlow implementation status** and **residual risk**. Recognizer/redaction detail is in
[`README.md`](README.md); posture context in [docs/compliance.md §5](../../docs/compliance.md#5-de-identification).

**Status legend:** ✅ implemented · ⚠️ implemented with caveat · ❌ gap (roadmapped).

| # | §164.514(b)(2)(i) identifier | Implementation | Status | Residual risk |
|---|---|---|---|---|
| A | **Names** | Presidio `PERSON` NER + surrogate tokens; clinical eponym allow-list; FHIR `name` fields cleared/pseudonymized; DICOM `PatientName` stripped | ✅ | NER recall < 100% on messy free text; misspelled/abbreviated names can slip. Fail-safe is redact. |
| B | **Geographic subdivisions smaller than a state** (street, city, county, precinct, **ZIP** — keep only ZIP3 if area > 20,000) | `LOCATION` NER + address parser drop street/city; **ZIP → first 3 digits**; restricted ZIP3 prefixes (≤20k pop) → `000`; state retained as allowed | ✅ | ZIP3 + rare attributes can still narrow to a small group; restricted-prefix list must be kept current. |
| C | **Dates** (all elements smaller than year: birth, admission, discharge, death; ages > 89 / dates indicating such age) | **HMAC per-patient date shift ±1–365d**, year retained, **intervals preserved**; **ages ≥ 90 → `90+`** band | ✅ | Interval preservation is *intended* utility but is itself a (weak) quasi-identifier across linked datasets; shift secret is the re-id key. |
| D | **Telephone numbers** | `PHONE_NUMBER` NER → `[PHONE]` in text; structured phone additionally Vault-envelope-encrypted at the gateway | ✅ | Non-standard formats in prose may evade NER; post-check digit-run sweep backstops. |
| E | **Fax numbers** | Same `PHONE_NUMBER` recognizer/redaction (fax ≡ phone format) | ✅ | As D. |
| F | **Email addresses** | `EMAIL_ADDRESS` NER → `[EMAIL]`; structured email Vault-envelope-encrypted | ✅ | Obfuscated emails (“name at domain dot com”) may evade; low likelihood in clinical data. |
| G | **Social Security numbers** | `US_SSN` NER → `[SSN]`; post-check regex; SSN presence raises job risk flag (should never occur) | ✅ | Should not appear in clinical data at all; loud-flagged if seen. |
| H | **Medical record numbers** | Custom MRN recognizer (pattern + context) → **HMAC pseudonymized** surrogate (preserves linkage); `[MRN]` in text | ✅ | Surrogate is re-identifiable only via the HMAC key (Vault). Unusual MRN formats need recognizer tuning. |
| I | **Health plan beneficiary numbers** | Treated as account/identifier class: custom identifier recognizer → `[ID]` / pseudonymized | ⚠️ | Plan-number formats vary by payer; coverage is pattern-based, not exhaustive. Tune recognizers as payer formats appear. |
| J | **Account numbers** | Identifier recognizer + FHIR `Account`/`identifier` fields → `[ID]` / pseudonymized | ✅ | As I — format-dependent. |
| K | **Certificate / license numbers** | `US_DRIVER_LICENSE` NER + custom license patterns → `[LICENSE]` | ✅ | Uncommon license formats may evade NER. |
| L | **Vehicle identifiers and serial numbers** (incl. plates) | Custom VIN/plate recognizer → `[VEHICLE_ID]` | ⚠️ | Rare in clinical data; recognizer is best-effort, not exhaustive. |
| M | **Device identifiers and serial numbers** | Custom `DEVICE_ID` recognizer; **wearable device ids HMAC-pseudonymized** (keeps vitals joinable); serials → `[DEVICE]` | ✅ | Novel device-id formats need recognizer updates; pseudonym is re-id-able via key. |
| N | **Web URLs** | `URL` NER → `[URL]` | ✅ | Low risk; standard recognizer. |
| O | **IP addresses** | `IP_ADDRESS` NER → `[IP]` | ✅ | Low risk; standard recognizer. |
| P | **Biometric identifiers** (finger/voice prints) | Best-effort text recognizer → `[BIOMETRIC]`; true biometrics are not present as structured fields | ⚠️ | Genuine biometric data isn’t collected; *image-embedded* biometrics (see Q) are the real exposure. |
| Q | **Full-face photographs and comparable images** | DICOM is chest X-ray (not facial); header PHI tags stripped | ⚠️ → ❌ for pixels | **Burned-in pixel annotations are NOT OCR-scrubbed** — header scrubbing misses pixel-embedded PHI. Named [gap #9](../../docs/compliance.md#11-gaps--roadmap-the-honest-table). |
| R | **Any other unique identifying number, characteristic, or code** | Catch-all `ANY_OTHER_UNIQUE_ID` recognizer (long unique alphanumerics) → `[ID]`, logged for tuning | ⚠️ | The hardest, open-ended category by nature. Quasi-identifier *combinations* (rare dx + ZIP3 + year) are the residual risk Safe Harbor cannot fully close. |

## "No actual knowledge" clause (§164.514(b)(2)(ii))

Safe Harbor also requires no actual knowledge that the residual information could be used alone or in
combination to re-identify. MedFlow’s honest position:

- We **document** the known residual vectors above rather than assert zero risk — quasi-identifier
  combinations, free-text recall gaps, burned-in pixel PHI, and the existence of a key-holder who can
  re-identify.
- The data is **synthetic**, so the clause is satisfied trivially today.
- For real data, the residual vectors (esp. items Q-pixels and R-combinations) would be tracked on the
  risk register, and the **expert-determination** path (§164.514(b)(1)) is the standard answer for a
  higher-utility, defensible dataset — the deid-service rules are config-driven specifically so an
  expert-determined profile can ship as an alternate ruleset without code changes (gap #7).

## Coverage summary

| Status | Count | Identifiers |
|---|---|---|
| ✅ implemented | 11 | A, B, C, D, E, F, G, H, J, K, M, N, O *(N+O counted in)* |
| ⚠️ implemented with caveat | 6 | I, L, P, Q (headers), R, and format-dependent identifiers |
| ❌ gap (roadmapped) | — pixel layer of Q | DICOM burned-in pixel text (OCR redaction) — [gap #9] |

The defensible claim: **all 18 identifier classes have a named rule**; the honest caveats are the
format-dependent recognizers (I, L), the pixel layer of Q, and the irreducible quasi-identifier
residual of R — each enumerated, not hidden, and each with a stated remediation path.
