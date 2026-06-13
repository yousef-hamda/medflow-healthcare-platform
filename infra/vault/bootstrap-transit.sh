#!/bin/sh
# Bootstraps Vault for MedFlow (dev mode). Idempotent: every step tolerates
# already-existing mounts/keys so the init container can be re-run safely.
#
# - transit engine at medflow-transit with key phi-field-key for field-level
#   PHI encryption (api-gateway / deid-service)
# - least-privilege policy medflow-gateway: encrypt/decrypt ONLY on that key
# - kv-v2 at medflow-kv for application secrets

set -u

VAULT_ADDR="${VAULT_ADDR:-http://vault:8200}"
export VAULT_ADDR

echo "[vault-init] enabling transit engine at medflow-transit"
vault secrets enable -path=medflow-transit transit || true

echo "[vault-init] creating transit key phi-field-key"
vault write -f medflow-transit/keys/phi-field-key || true

# Key hygiene: allow rotation, forbid export/plaintext backup of the key.
vault write medflow-transit/keys/phi-field-key/config \
  deletion_allowed=false exportable=false allow_plaintext_backup=false || true

echo "[vault-init] writing least-privilege policy medflow-gateway"
vault policy write medflow-gateway - <<'EOF' || true
# medflow-gateway: field-level PHI crypto only.
# No key management, no export, no other paths.
path "medflow-transit/encrypt/phi-field-key" {
  capabilities = ["update"]
}

path "medflow-transit/decrypt/phi-field-key" {
  capabilities = ["update"]
}
EOF

echo "[vault-init] enabling kv-v2 at medflow-kv"
vault secrets enable -path=medflow-kv -version=2 kv || true

echo "[vault-init] done"
