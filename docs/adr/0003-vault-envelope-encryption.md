# ADR-0003: Vault Transit envelope encryption for PHI contact fields

## Status

Accepted (2024-Q4). Referenced by [compliance.md §2.2](../compliance.md#22-field-level-encryption-vault-transit-envelope-design)
and [architecture.md §2.7](../architecture.md#27-application-layer). Depends on a hardened
production Vault (dev-mode Vault is a named gap, see
[compliance.md gap #13](../compliance.md#11-gaps--roadmap-the-honest-table)).

## Context

`Patient.telecom` data — **phone and email** — is high-sensitivity, low-query-need PHI held in
gateway-owned Postgres contact tables (separate from, and in addition to, the cleartext copy
inside FHIR `Patient.telecom`, which the FHIR proxy masks by scope). We want these specific
columns protected against a threat the storage-level KMS encryption does **not** cover: an
attacker (or over-broad role) with **read access to the database itself** — a leaked replica, a
backup restored in the wrong place, a SQL-injection read, an over-privileged BI connection.

Requirements:

- Protection that survives **DB read access**, not just disk theft.
- **Per-use auditability** of every decrypt (who unmasked a contact field, when).
- **Key rotation** without a painful full re-encrypt of the table.
- **Revocability** — the ability to make all protected fields un-decryptable quickly.
- The encryption key must **not** live where the data lives.
- Failure mode must be "contact fields unavailable/masked", never "system down" — consistent
  with the failure table in [architecture.md §6](../architecture.md#6-failure-modes-by-layer).

## Decision

Encrypt `phone`/`email` with **envelope encryption** using HashiCorp **Vault's Transit engine**.
The mount is `medflow-transit`, the key is `phi-field-key`
(bootstrapped by `infra/vault/bootstrap-transit.sh`, configured non-exportable, no plaintext
backup, deletion disallowed).

**Envelope mechanics (DEK/KEK):**

1. **KEK (Key Encryption Key)** = `phi-field-key`. It lives only inside Vault and **never
   leaves it** (`exportable=false`, `allow_plaintext_backup=false`).
2. On **write**, the gateway requests a **DEK (Data Encryption Key)** from Transit:
   `POST medflow-transit/datakey/plaintext/phi-field-key`, which returns a one-time plaintext
   DEK **and** that DEK already wrapped (encrypted) by the current KEK version.
3. The gateway AES-256-GCM-encrypts the field value with the plaintext DEK, then **zeroizes the
   plaintext DEK in memory**. It stores `ciphertext_field || wrapped_DEK || key_version` in
   Postgres. The plaintext DEK is never persisted.
4. On **read** (authorized roles only), the gateway sends the wrapped DEK to
   `POST medflow-transit/decrypt/phi-field-key`, Vault returns the plaintext DEK (proving the
   caller is allowed to use the KEK), the gateway decrypts the field and zeroizes the DEK again.

**Why envelope (DEK/KEK) rather than calling Transit `encrypt`/`decrypt` on the field directly:**
direct Transit encrypt/decrypt also works and keeps the KEK in Vault, but envelope encryption
keeps the **bulk crypto local** (one Vault round-trip per record to mint/unwrap a DEK, then
local AES-GCM), bounds payload size limits, and is the pattern that generalizes to larger blobs.
For single short fields the difference is small; we standardize on envelope so the same pattern
covers future larger protected payloads.

**Rotation:** `vault write -f medflow-transit/keys/phi-field-key/rotate` creates a new KEK
version cheaply, because only **DEK wrappers** reference the KEK version — not the field
plaintext. A background rewrap job calls `medflow-transit/rewrap` to migrate existing rows'
wrapped DEKs to the newest KEK version with **no field plaintext ever touched**. After rewrap
completes, `min_decryption_version` is raised to retire old KEK versions.

**Least privilege:** the gateway's Vault policy
([`vault-policy-gateway.hcl`](../../compliance/access-policies/vault-policy-gateway.hcl))
grants `update` on exactly `medflow-transit/encrypt/phi-field-key` and
`medflow-transit/decrypt/phi-field-key` (plus the `datakey` path) — **no key management, no
export, no other paths**. The deid-service has its own equally narrow policy.

## Alternatives considered

### pgcrypto (`pgp_sym_encrypt` / `encrypt()` in SQL)

Rejected — it defeats the threat we actually care about:

- The key is passed **in SQL text** and lives in DB memory/`pg_stat_activity`/query logs. A DB
  read compromise — the exact thing we're defending against — leaks the key alongside the data.
- DB backups become **self-decrypting** for anyone who also obtains the key from the same blast
  radius (the DB).
- No per-use audit, no clean rotation, no revocation independent of the DB.

### Application-layer static AES-256-GCM (key in env/config/secret)

Rejected:

- The key sits in **every replica's environment**, multiplying its exposure and showing up in
  process inspection, crash dumps, and misconfigured logging.
- **Rotation is a painful full re-encrypt** of the table and a coordinated key swap across
  replicas; in practice keys never rotate.
- No per-use audit; revocation means redeploying every replica.

### Storage/disk encryption only (KMS on RDS/EBS, S3 SSE-KMS)

We use this **as well** — it is mandatory — but it is **not sufficient** for these fields:

- It protects against **stolen disks/snapshots**, transparently decrypting for anyone with a
  legitimate DB connection. It does **nothing** against a DB read compromise, an over-broad
  role, or a restored-in-the-wrong-place backup.
- No field-level granularity, no per-field decrypt audit.

Field-level envelope encryption is **defense in depth on top of** storage encryption, aimed at a
different attacker (database read access vs disk theft).

## Consequences

**Positive**

- Phone/email survive a **DB-level read compromise**: the rows hold only ciphertext + a wrapped
  DEK that is useless without Vault deciding to unwrap it.
- **Per-decrypt audit** twice over: Vault's own audit device records every unwrap, and the
  gateway emits an `audit.events` record (`phi:contact` unmask) — cross-referenceable
  (see [audit-queries](../../compliance/audit-queries/README.md)).
- **Cheap rotation** via key versioning + `rewrap`, with `min_decryption_version` retiring old
  versions — no field plaintext ever re-touched.
- **Fast revocation:** seal Vault or change the policy and every protected field becomes
  un-decryptable immediately.
- Blast radius is contained: the KEK is in one place with one narrow policy per consumer.

**Negative / costs (honest)**

- **Vault becomes a hard runtime dependency** for these fields. Mitigated, not eliminated: the
  designed failure mode is masked/unavailable contact fields and fail-closed on writes that
  require encryption — never a system outage (see failure table).
- **Latency:** a Vault round-trip per record on write (datakey) and per decrypt on read. Fine
  for low-volume contact fields; we deliberately did **not** envelope-encrypt high-query-rate
  columns for this reason.
- **Operational burden of a *real* Vault:** auto-unseal via KMS, HA, audit-device shipping, no
  root token. Dev-mode Vault (root token, in-memory) is a **toy** and an explicit production gap
  (compliance gap #13). This ADR assumes the hardened version.
- **Key/Vault loss = data loss for these fields, by design.** Losing the KEK means phone/email
  are permanently unrecoverable. That is the correct, accepted trade for fields whose loss is
  survivable; it is documented in the DR table
  ([compliance.md §9](../compliance.md#9-backup--disaster-recovery)) as "KEK loss = contact-field
  loss only".
- **Searching encrypted fields** is impossible without leaking (no `LIKE` on phone). Accepted:
  these fields have low query need by selection; lookups go through application logic, not
  ad-hoc SQL.
