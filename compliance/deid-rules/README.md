# De-identification rules — recognizers & redaction

The deid-service (:8093) implements **HIPAA Safe Harbor** (§164.514(b)(2)) over both structured
FHIR and free clinical text, using **Microsoft Presidio** for entity recognition plus
MedFlow-specific transforms. This file is the recognizer/redaction catalog; the per-identifier
coverage matrix is in [`safe-harbor-checklist.md`](safe-harbor-checklist.md). Posture context:
[docs/compliance.md §5](../../docs/compliance.md#5-de-identification).

> **Two secrets are the security of this whole subsystem** — the per-patient HMAC `DATE_SHIFT_SECRET`
> and the pseudonymization `DEID_HMAC_KEY`. They are the single points of re-identification, held in
> Vault, readable only by deid-service ([`vault-policy-deid.hcl`](../access-policies/vault-policy-deid.hcl)),
> never exposed to analysts or the lakehouse. Every de-id job is itself audited (`action ILIKE 'DEID%'`).

## Design principles

- **Structured first, then text.** FHIR fields with known semantics (dates, addresses, names,
  identifiers) are transformed by typed rules — deterministic and complete. Presidio NER is used for
  the residual risk in **free text** (notes, `DocumentReference`), where identifiers hide in prose.
- **Transform, don't just delete, where utility matters.** Dates are *shifted* (interval-preserving),
  not dropped; ZIP is *truncated* to ZIP3, not zeroed; ages are *banded* at 90+. This keeps research
  utility (length-of-stay, time-to-event, coarse geography, age structure) while satisfying Safe
  Harbor.
- **Clinical allow-lists.** Recognizers run with allow-lists so drug names, anatomy, and procedure
  terms are not destroyed as false-positive "names/identifiers" (e.g. "Mr. Frank" the patient vs
  "frank pus" the finding).
- **Fail-safe = redact.** On recognizer ambiguity the default is to redact (favor privacy over
  utility); this trades recall for precision in the safe direction.

## Recognizers & redaction rules

| Recognizer (Presidio / custom) | Detects | Redaction rule | Rationale |
|---|---|---|---|
| `PERSON` (Presidio NER, spaCy) | Patient/relative/provider names in text | Replace with `[NAME]` (or a stable surrogate token per pseudonymized patient) | Safe Harbor #A (names). Surrogate keeps coreference (“the patient … she …”) without revealing identity. Allow-list of clinical eponyms (e.g. “Bell’s palsy”, “Cushing”) prevents destroying medical terms. |
| `LOCATION` / custom address parser | Street address, city, precise geography | Drop street/city; **ZIP → first 3 digits**, with restricted-ZIP3 prefixes → `000` | Safe Harbor #B. ZIP3 retains coarse geography for research; restricted (≤20,000-pop) prefixes are zeroed per the published list. State retained only as allowed. |
| `DATE_TIME` (Presidio) + structured FHIR date fields | All dates more specific than year (DOB, admit/discharge, service dates) | **HMAC per-patient shift, uniform ±1–365 days**, keyed by `DATE_SHIFT_SECRET`; **year retained** | Safe Harbor #C. Shift is *constant per patient* so intervals (LOS, time-to-event) survive while absolute dates do not. Ages ≥ 90 → `90+` band (see `AGE` rule). |
| `AGE` (custom) | Age statements / DOB-derived age | Ages **≥ 90 aggregated to `90+`**; under-90 retained | Safe Harbor #C. The 90+ band is the named identifier for elderly outliers; banding prevents singling them out. |
| `PHONE_NUMBER` (Presidio) | Phone/fax numbers in text | Replace with `[PHONE]` | Safe Harbor #D/#E. (In structured data, phone/email are additionally Vault-envelope-encrypted at the gateway — see [ADR-0003](../../docs/adr/0003-vault-envelope-encryption.md).) |
| `EMAIL_ADDRESS` (Presidio) | Email addresses | Replace with `[EMAIL]` | Safe Harbor #F. |
| `US_SSN` (Presidio) | Social Security numbers | Replace with `[SSN]` | Safe Harbor #G. Should never appear in clinical data; flagged loudly if seen. |
| `MEDICAL_RECORD_NUMBER` (custom pattern + context) | MRN / account numbers | **HMAC pseudonymization** to a stable surrogate key (or `[MRN]` in text) | Safe Harbor #H/#I. Surrogate preserves linkage across records for the same (now pseudonymous) patient; the HMAC key is the only re-identification path. |
| `US_DRIVER_LICENSE` (Presidio) | Driver’s license / certificate numbers | Replace with `[LICENSE]` | Safe Harbor #J. |
| `US_LICENSE_PLATE` / VIN (custom) | Vehicle identifiers | Replace with `[VEHICLE_ID]` | Safe Harbor #K. |
| `DEVICE_ID` (custom: serial-number patterns + wearable device ids) | Device serial numbers / wearable ids | **HMAC pseudonymization** of device id; raw serials → `[DEVICE]` | Safe Harbor #L. Wearable device ids are pseudonymized so device-linked vitals stay joinable without exposing the serial. |
| `URL` (Presidio) | Web URLs | Replace with `[URL]` | Safe Harbor #M. |
| `IP_ADDRESS` (Presidio) | IPv4/IPv6 | Replace with `[IP]` | Safe Harbor #N. |
| `CRYPTO` / biometric markers (custom, limited) | Obvious biometric identifiers in text | Replace with `[BIOMETRIC]` | Safe Harbor #O/#P (best-effort in text; true biometrics live in images — see residual risk). |
| DICOM header scrubber (custom, structured) | PatientName/PatientID/other PHI tags in DICOM | Strip/replace identifying tags; pseudonymize PatientID | Safe Harbor #A/#H for imaging metadata. **Pixel/burned-in text is NOT handled — see residual risk and [compliance gap #9](../../docs/compliance.md#11-gaps--roadmap-the-honest-table).** |
| `ANY_OTHER_UNIQUE_ID` (catch-all custom) | Long unique alphanumerics not matched above | Replace with `[ID]` (logged for rule tuning) | Safe Harbor #R catch-all; the “anything else uniquely identifying” backstop. |

## Pipeline (text path)

1. **Pre-pass:** clinical allow-list tagging so protected medical terms are masked from the NER.
2. **Presidio analyze:** run the recognizers above; collect spans with confidence scores.
3. **Structured overrides:** typed FHIR-field rules (dates, ZIP, MRN) take precedence over NER for
   fields with known semantics.
4. **Anonymize:** apply the redaction rules (replace / shift / truncate / band / pseudonymize).
5. **Post-check:** a secondary regex sweep for high-risk leftovers (SSN, long digit runs); a hit
   re-redacts and raises the job’s risk flag.
6. **Audit:** emit a `DEID_*` audit event (no PHI in the event — counts and resource refs only).

## Residual risk (honest — mirrors compliance.md §5)

Safe Harbor is mechanical and auditable but **not a guarantee of non-re-identifiability**:

- **Free-text recall < 100%.** Presidio will miss some identifiers in messy clinical prose; the
  post-check and fail-safe-redact reduce but do not eliminate this.
- **Quasi-identifier combinations.** Rare diagnosis + ZIP3 + retained year can single out an
  individual even with every direct identifier removed.
- **DICOM burned-in pixel text** is not OCR-scrubbed; header tags are stripped but pixel-embedded PHI
  remains (named gap #9).
- **Waveform/vitals fingerprinting** is a theoretical re-identification vector we do not defend.
- **Key custody is the linchpin:** whoever holds `DATE_SHIFT_SECRET` + `DEID_HMAC_KEY` can re-identify;
  these are Vault-held and access-controlled accordingly.

Synthetic data makes all of this moot today; with real data, the **expert-determination** alternative
(§164.514(b)(1)) would be the path to a higher-utility *and* defensible dataset — the rules are
config-driven so an expert-determined profile can ship as an alternate ruleset without code changes
(see [compliance.md §5](../../docs/compliance.md#5-de-identification) and gap #7).
