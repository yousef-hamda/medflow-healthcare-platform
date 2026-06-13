# Access policies

Least-privilege policy artifacts that back the access-control claims in
[docs/compliance.md §3](../../docs/compliance.md#3-access-control) and the elevation/supply-chain
boundaries in [compliance/threat-model.md](../threat-model.md). Every file here is intended to be
**boring on purpose**: each grant is the minimum a principal needs, and the security property is as
much in what is *absent* as in what is present.

| File | Principal | Grants (only) | Notably denies |
|---|---|---|---|
| [`vault-policy-gateway.hcl`](vault-policy-gateway.hcl) | api-gateway | `update` on `encrypt`/`decrypt`/`datakey`/`rewrap` of **`phi-field-key`** | key read/export/rotate/delete, any other key, any other mount |
| [`vault-policy-deid.hcl`](vault-policy-deid.hcl) | deid-service | `read` on its two de-id HMAC secrets in kv-v2 (+ their metadata) | secret writes, mount list, all transit/field crypto |
| [`k8s-rbac.yaml`](k8s-rbac.yaml) | deployer / operator / auditor | per-persona ClusterRoles + bindings (see below) | Secrets, `pods/exec`, RBAC writes (except deployer's workload writes) |

## Vault policies

The KEK `phi-field-key` lives in the `medflow-transit` mount (bootstrapped by
`infra/vault/bootstrap-transit.sh`, configured `exportable=false`,
`allow_plaintext_backup=false`, `deletion_allowed=false`). In Vault's Transit engine, `encrypt`,
`decrypt`, `datakey`, and `rewrap` are **write operations**, so the only capability they require is
`["update"]` — which is why the gateway policy grants `update` and nothing else. The KEK never
leaves Vault; every decrypt is recorded by Vault's audit device and cross-referenced with our own
`audit.events` hash chain (an unmatched decrypt is itself an anomaly — see the
[audit-chain-broken runbook](../../docs/runbooks/audit-chain-broken.md)). Rationale and the
DEK/KEK envelope mechanics are in [ADR-0003](../../docs/adr/0003-vault-envelope-encryption.md).

The deid policy is even narrower — read-only on exactly the two HMAC secrets
(`DATE_SHIFT_SECRET`, pseudonymization key) that are the single points of re-identification. It
deliberately does **not** share the gateway's field-crypto capability: different job, different
blast radius.

**Apply (production Vault):**

```bash
vault policy write medflow-gateway compliance/access-policies/vault-policy-gateway.hcl
vault policy write medflow-deid    compliance/access-policies/vault-policy-deid.hcl
# bind to each service's auth role (e.g. Kubernetes auth):
vault write auth/kubernetes/role/api-gateway  bound_service_account_names=api-gateway \
  bound_service_account_namespaces=medflow-app token_policies=medflow-gateway ttl=1h
vault write auth/kubernetes/role/deid-service bound_service_account_names=deid-service \
  bound_service_account_namespaces=medflow-app token_policies=medflow-deid ttl=1h
```

> Local dev uses Vault in **dev mode** (root token, in-memory) — a toy. Hardened production Vault
> (auto-unseal via KMS, HA, audit-device shipping, no root token) is a named gap
> ([compliance.md gap #13](../../docs/compliance.md#11-gaps--roadmap-the-honest-table)). These
> policies are written for the hardened deployment.

## Kubernetes RBAC — separation of duties

Three personas, bound to IdP group claims (or the CD service account), each minimum-privilege:

- **deployer** — GitOps/CD (ArgoCD): may reconcile workloads/config; **cannot** read Secrets, exec
  into pods, or change RBAC.
- **operator** — SRE on-call: may observe (pods/logs/metrics) and restart workloads via rollout;
  **cannot** read Secrets or get an interactive shell (exec is break-glass-only, Falco-watched).
- **auditor** — compliance/security: **read-only** across compliance-relevant objects *including
  RBAC and Istio policy* (so they can evidence "who can do what" and that mTLS is STRICT);
  **no writes anywhere**, no Secrets, no exec.

No persona is granted `kubectl exec` into prod namespaces — that is a separate, audited, paged
break-glass procedure, not a standing grant. The split ensures no one identity can simultaneously
operate the platform, read its compliance evidence, and alter what is deployed.

**Apply:**

```bash
kubectl apply -f compliance/access-policies/k8s-rbac.yaml
# verify the least-privilege intent holds (these should all print "no"):
kubectl auth can-i get secrets        --as=system:serviceaccount:argocd:argocd-application-controller
kubectl auth can-i create pods/exec   --as-group=medflow:operators --as=on-call@medflow
kubectl auth can-i update deployments --as-group=medflow:auditors  --as=auditor@medflow
```

## How these map to the threat model

| Boundary | Threat | Policy that meets it |
|---|---|---|
| TB3 (gateway→FHIR/ML/audit) | compromised gateway dumps all contact fields | `vault-policy-gateway.hcl` — decrypt only, per-call, audited; no export |
| TB5 (batch→lake) | analyst escalates to re-identification keys | `vault-policy-deid.hcl` — only deid-service reads the HMAC secrets |
| TB6 (admin/break-glass) | operator self-grants cluster-admin / silences audit | `k8s-rbac.yaml` — no Secrets/exec/RBAC-write for operator; auditor read-only |

See [compliance/threat-model.md](../threat-model.md) for the full STRIDE-per-boundary analysis.
