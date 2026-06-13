# Vault policy: medflow-deid
#
# Least-privilege secret access for the de-identification service (deid-service, :8093).
# Cited by docs/compliance.md §5 and compliance/deid-rules/README.md.
#
# The deid-service performs Safe Harbor de-identification: per-patient HMAC date-shifting,
# ZIP3 truncation, 90+ aggregation, and HMAC pseudonymization of the patient key. Its security
# hinges on TWO long-lived secrets that are the single points of re-identification:
#   - DATE_SHIFT_SECRET  : HMAC key for the per-patient, interval-preserving date shift.
#   - DEID_HMAC_KEY       : HMAC key for the pseudonymized (surrogate) patient key.
# These must NEVER be exposed to analysts, the lakehouse, or any other service. They live in
# Vault and are read by deid-service alone.
#
# DESIGN INTENT (enforced by what is ABSENT here):
#   - deid-service may READ exactly its two de-id secrets from kv-v2 — nothing else.
#   - It may NOT write/delete those secrets, list the mount, or reach any other path.
#   - It does NOT share the gateway's phi-field-key crypto capabilities (different job, different
#     blast radius). If a deid workflow ever needs field crypto, grant it explicitly and narrowly.

# Read the de-identification HMAC secrets (kv-v2 => data is under the /data/ sub-path).
path "medflow-kv/data/deid/date-shift-secret" {
  capabilities = ["read"]
}

path "medflow-kv/data/deid/pseudonymization-key" {
  capabilities = ["read"]
}

# Read metadata (version info) for those two secrets only — needed for rotation awareness.
path "medflow-kv/metadata/deid/date-shift-secret" {
  capabilities = ["read"]
}

path "medflow-kv/metadata/deid/pseudonymization-key" {
  capabilities = ["read"]
}

# Everything else is implicitly DENIED:
#   - NO create/update/delete on its own secrets   (rotation is an operator action, not the app's)
#   - NO list on medflow-kv/*                       (cannot enumerate other apps' secrets)
#   - NO medflow-transit/*                          (no field crypto; different role than the gateway)
#   - NO sys/*, NO auth/*, NO other mounts
