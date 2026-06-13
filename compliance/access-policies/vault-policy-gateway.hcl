# Vault policy: medflow-gateway
#
# Least-privilege field-level PHI crypto for the api-gateway.
# This policy mirrors the one bootstrapped in infra/vault/bootstrap-transit.sh and is the
# authoritative reference cited by docs/compliance.md §2.2 and docs/adr/0003-vault-envelope-encryption.md.
#
# DESIGN INTENT (enforced by what is ABSENT here):
#   - The gateway may ONLY ask Vault to encrypt or decrypt PHI contact fields with phi-field-key.
#   - It may NOT read, export, rotate, delete, or list keys; it cannot reach any other mount.
#   - A compromised gateway can therefore decrypt only the fields it is already authorized to,
#     one audited Vault call at a time — never dump or exfiltrate the key (KEK never leaves Vault),
#     and never silence its own decrypt audit (Vault's audit device records every call).
#
# In Transit, encrypt/decrypt/datakey are WRITE operations, so the only capability needed is
# ["update"]. We grant nothing else — not even "read" on these paths.

# Encrypt a PHI field value (write path).
path "medflow-transit/encrypt/phi-field-key" {
  capabilities = ["update"]
}

# Decrypt a PHI field value (authorized read path; every call is audited by Vault + cross-referenced
# against our own audit.events hash chain).
path "medflow-transit/decrypt/phi-field-key" {
  capabilities = ["update"]
}

# Mint a per-record Data Encryption Key (DEK) wrapped by the KEK (phi-field-key) for envelope
# encryption — the write path described in ADR-0003. Returns plaintext DEK + wrapped DEK; the
# gateway does local AES-256-GCM and zeroizes the plaintext DEK. Required for envelope mode.
path "medflow-transit/datakey/plaintext/phi-field-key" {
  capabilities = ["update"]
}

# Rewrap existing wrapped DEKs to the newest KEK version after a key rotation, WITHOUT exposing
# field plaintext. Used only by the background rewrap job (which runs under this policy). If you
# prefer to split duties, move this single path to a dedicated medflow-gateway-rewrap policy.
path "medflow-transit/rewrap/phi-field-key" {
  capabilities = ["update"]
}

# Everything else is implicitly DENIED:
#   - NO medflow-transit/keys/*            (no key read / config / rotate / delete / export)
#   - NO medflow-transit/export/*          (key export is impossible by policy AND by key config:
#                                           exportable=false, allow_plaintext_backup=false)
#   - NO medflow-transit/encrypt|decrypt of any key other than phi-field-key
#   - NO medflow-kv/* application secrets   (gateway gets those via its own scoped mechanism, not here)
#   - NO sys/*, NO auth/*, NO other mounts
