# MedFlow Deployment

> Three tiers, one codebase: **local compose** (development, synthetic data, deliberately
> insecure defaults), **kind/minikube + Helm + Istio + ArgoCD** (integration parity with the
> production shape), and **AWS via Terraform** (the production design). The security posture
> differences between tiers are not accidental drift — they are enumerated here and in
> [compliance.md](compliance.md), which repeatedly points at this document for the
> per-environment secrets story.

## 1. Tier overview

| | Tier 1 — compose | Tier 2 — kind + Helm | Tier 3 — AWS |
|---|---|---|---|
| Entry point | `make dev` (`docker-compose.yml` + `docker-compose.dev.yml`) | `make k8s-up` (`infra/helm/medflow`, `values-local.yaml`) | `terraform apply` in `infra/terraform/` + ArgoCD |
| Purpose | fast inner loop, hot reload | mesh/mTLS/NetworkPolicy/admission testing, GitOps rehearsal | production design |
| Data | synthetic only | synthetic only | designed for real PHI (never loaded with it in this project) |
| In-cluster TLS | none (plaintext, incl. Kafka) | Istio `PeerAuthentication` STRICT | Istio STRICT + KMS-encrypted storage |
| Ingress | host ports | Istio ingress gateway | ALB + WAF → Istio ingress |
| State | Docker volumes | PVCs in kind | RDS Postgres, MSK-style Kafka on EBS, S3 (+ Object Lock for `audit-worm`), ElastiCache |
| Deploy mechanism | compose up | `helm upgrade --install` | **ArgoCD** syncs Helm from git; no kubectl-apply humans |
| Image admission | none | Kyverno/policy-controller `verify-before-deploy` (Cosign) | same, enforced cluster-wide |
| Runtime security | none | Falco DaemonSet | Falco + CloudTrail/GuardDuty |

### Tier 1 — local compose

`make dev` brings up all ~40 services; init containers (`kafka-init`, `minio-init`,
`vault-init`, `airflow-init`) create topics, buckets (incl. object-locked `audit-worm`),
the Vault Transit key, and Airflow metadata. Then `make seed-patients N=500`, and optionally
the simulators (`make sim-hl7`, `sim-dicom`, `sim-vitals`) and `make flink` for the sepsis job.
Key endpoints are printed by `make dev` (dashboard :3000, gateway :4000, FHIR :8090, Airflow
:8080, MLflow :5000, Grafana :3002, …) — full port table in
[architecture.md](architecture.md#4-ports-and-endpoints).

Known-insecure by design (synthetic data only): plaintext Kafka listeners, Vault **dev mode**
with root token, shared MinIO root credentials (`minio_admin/minio_dev_password`),
`admin/admin` UIs (Airflow, Grafana, Superset), self-issued OIDC. Each has a hardened
counterpart in tiers 2–3.

### Tier 2 — kind/minikube + Helm + Istio + ArgoCD

The same images, deployed as a Helm chart with the production-shaped controls turned on:

- **Istio** with `PeerAuthentication` mode STRICT mesh-wide — every hop mTLS with SPIFFE
  identities ([compliance.md](compliance.md#21-in-transit)); `AuthorizationPolicy` allows only
  the call graph in [architecture.md](architecture.md) (e.g. only Flink and cds-hooks may call
  ml-serving; only audit-service writes to the audit DB).
- **NetworkPolicies** default-deny per namespace.
- **ArgoCD** watches the chart path in git; environment differences are values files, not
  manual edits. Rollback = git revert + sync.
- **Kyverno/policy-controller** admission: unsigned or unattested images are rejected (§3).
- **Vault** runs non-dev (file/raft storage in-cluster for this tier), services authenticate
  via Kubernetes auth method (service-account JWT → Vault role), policies from
  [`compliance/access-policies/`](../compliance/access-policies/README.md).
- RBAC: the deployer/operator/auditor ClusterRoles in
  [`compliance/access-policies/k8s-rbac.yaml`](../compliance/access-policies/k8s-rbac.yaml).

`make k8s-up` / `make k8s-down` wrap `helm upgrade --install` / `helm uninstall` for the local
cluster; ArgoCD is the mechanism rehearsed on top once the chart is installed.

### Tier 3 — AWS (Terraform)

`infra/terraform/` provisions: **EKS** (the mesh + workloads), **RDS Postgres** (KMS-encrypted,
automated backups + 15-min log shipping for PITR — the RPO/RTO basis in
[compliance.md](compliance.md#9-backup--disaster-recovery--164308a7-164310d2iv)), **S3**
(lakehouse, imaging, mlflow-artifacts, drift-reports, synthea-raw; `audit-worm` with **Object
Lock compliance mode, 6-year retention**, cross-region replication), **KMS** CMKs per
environment, **WAF** in front of the ALB → Istio ingress. Kafka/OpenSearch/Redis run on
KMS-encrypted EBS in-cluster (a managed-service swap — MSK/OpenSearch
Service/ElastiCache — is a values-level change, deliberately kept open).

ArgoCD remains the only deploy path; Terraform owns infrastructure, git owns workloads.

## 2. Secrets per tier

The progression: **checked-in dev defaults → Vault as runtime authority → AWS Secrets Manager
as cloud source of truth, synced into the cluster by external-secrets.**

| Secret | Tier 1 (compose) | Tier 2 (kind) | Tier 3 (AWS) |
|---|---|---|---|
| Postgres credentials | env defaults in compose | K8s Secret from Helm values (local-only values file) | AWS SM → **external-secrets** → K8s Secret; RDS master cred rotated by SM rotation lambda |
| `phi-field-key` (KEK) | Vault dev mode, root token, key created by `vault-init` (`infra/vault/bootstrap-transit.sh`) | Vault (raft), K8s auth, gateway bound to [`vault-policy-gateway.hcl`](../compliance/access-policies/vault-policy-gateway.hcl) | Vault on EKS, **auto-unseal via KMS**, HA raft, audit device shipped to Loki + S3 |
| `DATE_SHIFT_SECRET` / deid HMAC keys | compose env default | Vault KV, deid-service policy ([`vault-policy-deid.hcl`](../compliance/access-policies/vault-policy-deid.hcl)) | same, sourced via Vault (never in AWS SM — single authority for re-identification secrets) |
| OIDC signing keys | self-issued, generated at boot | Vault KV | enterprise IdP federation; gateway holds only client credentials from AWS SM |
| MinIO/S3 credentials | root creds shared by all services | per-service MinIO users from Helm-generated Secrets | **IRSA** (IAM roles for service accounts) — no static S3 keys at all |
| Kafka | PLAINTEXT, no auth | mTLS via mesh; SASL/ACLs are the known gap ([compliance gap #10](compliance.md#11-gaps--roadmap--the-honest-table)) | mTLS + per-service principals |
| Grafana/Airflow/Superset admin | `admin/admin` | random Helm-generated Secrets | AWS SM + SSO where supported |
| Cosign | n/a | keyless (OIDC) in CI | keyless; verification key material is the Fulcio/Rekor trust root pinned in cluster policy |

Rules that hold across tiers 2–3: secrets never in git (Helm values reference Secret *names*);
Vault is the **only** holder of re-identification-capable material (KEK, date-shift,
pseudonym HMAC); every Vault decrypt is audited twice (Vault audit device + `audit.events`,
per [compliance.md](compliance.md#22-field-level-encryption-vault-transit-envelope-design)).

## 3. Image build → sign → verify flow

CI on every service image, in order — each step gates the next:

```
build (pinned-digest base images)
  → make scan   : Trivy — fails on HIGH/CRITICAL CVEs
  → make sbom   : Syft — SPDX SBOM attached to the image as an OCI artifact
  → cosign sign : keyless (CI OIDC identity), signature + SBOM attestation to the registry/Rekor
  → push
deploy (tiers 2–3):
  → Kyverno/policy-controller admission verifies, before any pod is scheduled:
      (1) Cosign signature by the expected CI identity,
      (2) SBOM attestation present,
      (3) image referenced by digest
  → unsigned/unattested images are rejected at admission — verify-before-deploy
post-deploy:
  → weekly Grype re-scan of *deployed* SBOMs (catches CVEs published after build, no rebuild needed)
```

Scripts: `scripts/scan.sh`, `scripts/sbom.sh`; controls table in
[compliance.md](compliance.md#7-vulnerability-management--164308a1iib-164308a8). The
supply-chain trust boundary is analyzed in
[`compliance/threat-model.md`](../compliance/threat-model.md).

## 4. Make targets

From the repository `Makefile` (run `make help` for the live list):

| Target | Tier | What it does |
|---|---|---|
| `make dev` | 1 | full stack with hot reload (`docker-compose.dev.yml` overlay) |
| `make dev-build` / `down` / `logs S=svc` / `ps` | 1 | rebuild images / stop (keep volumes) / tail logs / status |
| `make clean` | 1 | stop and **destroy volumes** |
| `make seed-patients N=500` | 1 | generate + load Synthea patients into FHIR |
| `make sim-hl7 [RATE=5]` / `sim-dicom` / `sim-vitals` | 1 | HL7v2 MLLP replay / DICOM C-STORE push / MQTT vitals (incl. sepsis-trending patients) |
| `make airflow` / `spark` / `trino` / `superset` / `lineage` | 1 | bring up analytics components selectively |
| `make flink` | 1 | bring up Flink and submit the sepsis job (`scripts/submit_flink_job.sh`) |
| `make train-sepsis` / `train-readmission` / `train-xray` | 1 | training jobs via `ml-batch`, logging to MLflow |
| `make download-chestxray` | 1 | NIH ChestX-ray14 slice (research-use-only license) |
| `make compliance-report` | 1–3 | posture report: encryption status, **audit chain verification**, scan status (`scripts/compliance_report.sh`) |
| `make audit-query` | 1–3 | run the example audit-review queries (`scripts/audit_query.sh`, see [`compliance/audit-queries/`](../compliance/audit-queries/README.md)) |
| `make k8s-up` / `k8s-down` | 2 | install/remove the Helm release (`infra/helm/medflow`, `values-local.yaml`) |
| `make scan` / `sbom` | CI | Trivy gate / Syft SBOMs (§3) |
| `make lint` / `test` / `fmt` / `e2e` | CI/dev | TS + Python lint, unit tests, formatting, Playwright E2E (stack must be up + seeded) |

## 5. Environment differences that bite

- **Vault dev mode (tier 1) loses all keys on restart** — re-run of `vault-init` recreates
  `phi-field-key`, which means previously encrypted dev rows become undecryptable. Harmless
  with synthetic data; the reason tier 2+ uses raft storage and KMS auto-unseal.
- **Flink state** is heap-backed locally, RocksDB + durable checkpoints in K8s — local job
  restarts lose window state (≤ one 6h window rebuild), K8s restarts don't
  ([architecture.md](architecture.md#31-a-vitals-readings-journey-to-a-sepsis-alert)).
- **Canary routing** is `CANARY_ENABLED=false` in tier 1; exercised in tiers 2–3
  ([ml.md](ml.md#5-canary-mechanics)).
- **MLLP/DICOM TLS:** in-cluster these legacy protocols ride the mesh; *cross-site* senders
  require stunnel/IPsec or DICOM TLS — a deployment requirement, not optional
  ([compliance.md](compliance.md#21-in-transit)).
- **Object Lock** on `audit-worm` exists in all tiers (MinIO supports it), so the WORM export
  path is testable locally — one of the few security controls with full local parity.

Runbooks for the operational failure modes live in [runbooks/](runbooks/); restore procedures
(PITR + versioned-bucket restore, RPO 15min/RTO 4h verification) in
[runbooks/restore-drill.md](runbooks/restore-drill.md).
