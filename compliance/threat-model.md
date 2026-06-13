# MedFlow Threat Model — STRIDE per Trust Boundary

> **Scope.** Synthetic data only; MedFlow is not a covered entity. This model treats the platform
> *as if* it handled real PHI. It is an **input to** a formal risk analysis, not a substitute for one
> (a named gap — [compliance.md gap #1](../docs/compliance.md#11-gaps--roadmap-the-honest-table)).
> Companion docs: [compliance.md](../docs/compliance.md), [architecture.md](../docs/architecture.md),
> [access-policies/](access-policies/README.md), [audit-queries/](audit-queries/README.md),
> [deid-rules/](deid-rules/README.md).
>
> **Method.** For each trust boundary (a place where data crosses a privilege/identity edge) we apply
> **STRIDE** — Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation
> of privilege — and for every threat name either the **actual mitigating component** or an **honest
> gap**. Gaps are marked **GAP** and cross-referenced to the compliance roadmap where applicable.

## Trust boundary map

```
[Internet] ──TB1──> [Frontends] ──TB2──> [api-gateway/realtime] ──TB3──> [FHIR / ml-serving / audit]
                                                  │                              ▲
                                                  └──TB4──> [Kafka] ──TB5──> [batch → lakehouse]
[Admin / break-glass operator] ──TB6──> [cluster / data planes]
[Build & deploy pipeline] ──TB7──> [running images]   (supply chain)
```

Cross-cutting controls assumed at every in-cluster hop: **Istio STRICT mTLS** (SPIFFE workload
identity, 24h cert rotation), OTel tracing, Falco runtime rules, and the audit hash-chain.

---

## TB1 — Internet → Frontends (clinician dashboard, patient portal, mobile)

| STRIDE | Threat | Mitigation / **GAP** |
|---|---|---|
| **S** | Attacker impersonates a user (credential stuffing, stolen token, phished login) | OAuth2/OIDC at the edge; short-lived JWTs verified by the gateway; MFA expected at the IdP (production). **GAP:** MFA enforcement + brute-force lockout are IdP-config, not in-repo — call out in IdP hardening. |
| **T** | Tampering with requests/responses in transit; clickjacking; XSS injecting into the SPA | TLS 1.3/1.2 at AWS ALB/WAF (TLS 1.3 preferred); WAF managed rules; SPA CSP / frame-ancestors and output encoding. **GAP:** CSP/security-header policy is a frontend hardening item to verify per app. |
| **R** | User denies an action they took from the browser | Every gateway request is audited (actor, action, resource, IP, UA) into the hash-chained `audit_log`; patient self-view disclosures recorded. |
| **I** | PHI leaked to an unauthorized browser session; data cached in shared device | Auth required for every route; patient portal compartment-restricted to own record; field masking by scope; short token TTL. **GAP:** no-store cache headers + device/session policy are deployment hardening. |
| **D** | DDoS / volumetric flood against the public edge | AWS WAF rate-based rules + ALB; per-client gateway throttling behind it. **GAP:** no contracted upstream DDoS scrubbing beyond AWS-native — acceptable for scope. |
| **E** | A patient/clinician escalates to data outside their compartment via crafted requests | Compartment restriction (`patient/*.read`), RBAC + ABAC at the gateway; researcher tokens cannot reach the proxy at all. (See TB2/TB3 for the enforcement detail.) |

---

## TB2 — Frontends → api-gateway / realtime-gateway

| STRIDE | Threat | Mitigation / **GAP** |
|---|---|---|
| **S** | Forged/replayed JWT; a frontend impersonates another client | Gateway verifies JWT signature/issuer/audience/expiry; realtime-gateway authenticates the same JWTs before any room join. |
| **T** | Tampered scope/role claims to widen access | Claims are signed by the IdP and verified; the gateway never trusts client-asserted scope beyond the token; **scope narrowing** strips downstream calls to route-minimum. |
| **R** | Client denies issuing a privileged call (e.g. a write, a break-glass open) | Audit interceptor records every request incl. `BREAK_GLASS_OPEN/CLOSE` with `justification`; reviewable via [break-glass-review.sql](audit-queries/break-glass-review.sql). |
| **I** | Over-broad data returned (full demographics where not needed); telecom leakage | FHIR proxy **field-level masking by scope** (strips `Patient.telecom` without `phi:contact`); minimum-necessary defaults on dashboards; Socket.IO rooms ABAC-filtered so an alert reaches only authorized sockets. |
| **D** | A noisy/compromised client exhausts the gateway | Per-client Redis-backed throttling; circuit-breaker + 503 toward backends; gateway fails **open** on rate-limit (with alert) but **closed** on sessions. |
| **E** | Horizontal access: a clinician reads a non-care-team patient using a valid `user/*.read` token | **ABAC after scopes**: care-team membership / unit / purpose-of-use required; **break-glass** is the only override (1h, patient-scoped, justified, audited). This is the core enforcement and the most-tested path ([ADR-0005](../docs/adr/0005-smart-on-fhir-vs-custom-oauth.md)). |

---

## TB3 — api-gateway → FHIR server / ml-serving / audit-service

| STRIDE | Threat | Mitigation / **GAP** |
|---|---|---|
| **S** | A rogue pod impersonates the gateway to the FHIR/audit services | Istio STRICT mTLS with SPIFFE identities — backends authenticate the *caller workload*, not a shared secret; plaintext from inside the mesh is refused. |
| **T** | Tampering with audit records to hide an access; altering predictions | `audit_log` append-only Postgres triggers (no UPDATE/DELETE/TRUNCATE for any role) + sha256 hash chain + daily object-locked WORM anchor; predictions are write-once to the `predictions` store/topic with model version + canary arm. |
| **R** | Service denies it performed a decrypt / a privileged read | Vault Transit audit device logs every decrypt; cross-referenced with `audit.events` (a decrypt absent from our chain is itself an anomaly — see [audit-chain-broken](../docs/runbooks/audit-chain-broken.md)). |
| **I** | Backend returns more than the narrowed scope; ml-serving leaks features | Scope narrowing means the proxy call carries route-minimum scope; ml-serving runs under its own service account, returns scores/refs not raw cross-patient data; SHAP/Grad-CAM artifacts treated as sensitive (PHI inventory). |
| **D** | FHIR server (the bottleneck) overwhelmed → care impact | Reads offloaded to the lakehouse by design (`fhir.changes`); proxy bounds FHIR search; circuit breaker; [fhir-server-5xx runbook](../docs/runbooks/fhir-server-5xx.md). audit-service is an async Kafka consumer so the chain serializes *off* the request path. |
| **E** | Compromised gateway uses its Vault access to dump all contact fields | Gateway Vault policy grants `update` on **only** `encrypt`/`decrypt` of `phi-field-key` ([vault-policy-gateway.hcl](access-policies/vault-policy-gateway.hcl)) — no key export, no other paths; every decrypt is audited; sealing Vault / changing policy revokes instantly. **Residual:** a fully-compromised gateway can still decrypt fields it is authorized to, one Vault call at a time — bounded and fully audited, not silent. |

---

## TB4 — Services → Kafka

| STRIDE | Threat | Mitigation / **GAP** |
|---|---|---|
| **S** | Unauthorized producer/consumer joins the bus and injects or siphons events | Production: brokers inside the mesh, mTLS, SASL + per-topic ACLs intended. **GAP (largest in-cluster):** local Kafka is **PLAINTEXT, no SASL/ACLs** — dev-only, synthetic data; full TLS/SASL/ACL parity is [compliance gap #10](../docs/compliance.md#11-gaps--roadmap-the-honest-table). |
| **T** | Forged/altered events (fake alerts, poisoned vitals) | mTLS authenticity in-mesh; raw-before-map means `hl7.raw` is the verbatim archive; alerts carry `source` provenance so a fabricated "model" alert is distinguishable on review. **GAP:** no per-message signing/schema-registry-enforced contracts locally. |
| **R** | A producer denies emitting an event | Producer workload identity (mTLS/SPIFFE) + audit envelope on `audit.events`; OpenLineage records which job wrote which dataset. |
| **I** | Cleartext PHI readable to anyone on the bus | **GAP:** topics carry **cleartext PHI for ≤7 days** (retention). In AWS: encrypted EBS + in-mesh mTLS; locally plaintext. The single largest dev/prod divergence; acceptable only because data is synthetic. |
| **D** | A producer floods a topic; a slow consumer backs up the system | Kafka is the shock absorber (bounded producer buffers block rather than drop); consumer **lag is the alertable backpressure signal**; partition sizing (`vitals.raw` 12p) for the hot path. |
| **E** | A consumer reads topics beyond its need (e.g. realtime-gateway reading `audit.events`) | Production per-topic ACLs scope each consumer group. **GAP:** not enforced locally (no ACLs) — same root gap as TB4-S. |

---

## TB5 — Batch / Airflow → Lakehouse (MinIO/S3, Delta, OMOP)

| STRIDE | Threat | Mitigation / **GAP** |
|---|---|---|
| **S** | A rogue job writes to the lake or reads gold it shouldn't | Production: IAM/IRSA-scoped bucket access per workload, mTLS. **GAP:** local MinIO uses **shared root credentials** — dev-only; production uses scoped policies. |
| **T** | A bad job corrupts a table / poisons silver/gold | Delta ACID (atomic commits, no partial writes) + Great Expectations gates fail-closed (bad data never propagates); OpenLineage→Marquez localizes the offending partition; Delta **time travel** reverts logical corruption ([airflow-dag-failure runbook](../docs/runbooks/airflow-dag-failure.md)). |
| **R** | No record of which run produced a dataset | OpenLineage events per task to Marquez give run-level + column-level lineage from topic→bronze→silver→OMOP→dashboard. |
| **I** | Analysts re-identify patients from gold; raw PHI leaks into the analytical plane | **Two analytical identities**: silver/gold use an HMAC-pseudonymized key; Safe Harbor de-id (date-shift, ZIP3, 90+) applied before analyst-visible layers; researchers reach **only** de-identified Trino/OMOP, never the FHIR proxy. **Residual:** Safe Harbor ≠ non-re-identifiable (rare dx + ZIP3 + year, recognizer misses) — documented in [compliance.md §5](../docs/compliance.md#5-de-identification) and [safe-harbor-checklist](deid-rules/safe-harbor-checklist.md). |
| **D** | MinIO/S3 unavailable stalls the lake | Delta writes fail atomically (no partial commits); DAGs skip downstream; operational systems unaffected; batch is re-runnable/idempotent. |
| **E** | A low-priv analyst escalates to the de-id mapping (re-identification keys) | The HMAC pseudonymization key and `DATE_SHIFT_SECRET` live only in the de-id service's domain (Vault), no analyst access; they are the single points of re-identification and are managed as such. |

---

## TB6 — Admin / break-glass operator → cluster & data planes

| STRIDE | Threat | Mitigation / **GAP** |
|---|---|---|
| **S** | Stolen admin/operator credentials | IdP auth + (expected) MFA; service-to-service is mTLS not shared secrets; K8s RBAC ClusterRoles least-priv ([k8s-rbac.yaml](access-policies/k8s-rbac.yaml)). |
| **T** | Admin silences audit by dropping the append-only triggers | Triggers block UPDATE/DELETE/TRUNCATE for **all** roles incl. owner; silencing them needs DDL, which Falco flags (`DROP TRIGGER`/`ALTER TABLE` on `audit` DB) and which **breaks the chain anyway** vs the WORM anchor → detected within ≤24h. |
| **R** | Admin performs an unaudited PHI read | **Admin PHI access still flows through the gateway and is audited like everyone else's** — admins have no unaudited PHI path by design; `kubectl exec` into prod namespaces is a Falco rule that pages. |
| **I** | Break-glass over-broad or never reviewed; admin browses PHI | Break-glass is **1h, patient-scoped, requires free-text justification**, distinct audit action; mandatory human review ≤7 days ([break-glass-review.sql](audit-queries/break-glass-review.sql)); unreviewed events alarm. After-hours and bulk-read anomaly queries catch snooping. |
| **D** | Operator misconfig takes down a service | GitOps (ArgoCD) with reviewed/declarative changes; Helm + Istio; rollbacks are a synced-revision revert. |
| **E** | Operator self-grants cluster-admin or reaches the WORM bucket / KEK | Least-priv ClusterRoles separate **deployer / operator / auditor**; WORM export uses **separate write-once-no-delete** credentials (object-lock compliance mode resists even root); Vault KEK is non-exportable with narrow per-consumer policies. **Residual:** a true cluster-admin compromise is catastrophic — mitigated by least-priv split, Falco, and the external WORM anchor, not eliminated. |

---

## TB7 — Build & deploy pipeline → running images (supply chain)

| STRIDE | Threat | Mitigation / **GAP** |
|---|---|---|
| **S** | A malicious/forged image is deployed in place of a real one | **Cosign keyless signing** in CI + **Kyverno/policy-controller `verify-before-deploy`** admission rejects unsigned/unattested images. |
| **T** | Tampering with an image or dependency between build and deploy | Signature + attestation verified at admission; **digest-pinned** base images; lockfiles (pnpm, uv/pip pins). |
| **R** | No provenance for what's running | **Syft SPDX SBOMs** per image attached as OCI artifacts; signatures/attestations tie image→build. |
| **I** | A vulnerable/backdoored dependency exfiltrates data at runtime | **Trivy** gate fails CI on HIGH/CRITICAL; weekly **Grype** re-scan of deployed SBOMs catches post-build CVEs; Falco egress rule on **ml-serving** (pickle/torch-load RCE→exfil vector) restricts outbound to MLflow/Redis/Postgres/OTel only. |
| **D** | A poisoned dependency degrades/crashes services | Same scan/SBOM/signing gates; staged rollout via ArgoCD; resource limits + probes contain blast radius. |
| **E** | Build pipeline compromise injects code with elevated runtime rights | Keyless signing ties artifacts to the CI identity; read-only root filesystems + Falco write-anomaly rules limit what a compromised image can do at runtime. **GAP:** no external pen test / red-team of the pipeline yet ([compliance gap #6](../docs/compliance.md#11-gaps--roadmap-the-honest-table)). |

---

## Summary of honest gaps (collected)

| # | Gap | Boundary | Cross-ref |
|---|---|---|---|
| G1 | Local Kafka is **plaintext, no SASL/ACLs**; topics hold cleartext PHI ≤7d | TB4 | compliance gap #10 |
| G2 | Local MinIO **shared root creds** (prod uses scoped IAM/IRSA) | TB5 | deployment.md secrets story |
| G3 | **MFA / brute-force lockout** are IdP-config, not in-repo | TB1/TB6 | IdP hardening |
| G4 | **CSP / security headers / no-store caching** are per-frontend hardening to verify | TB1 | frontend hardening |
| G5 | Safe Harbor de-id is **not a non-re-identifiability guarantee** (residual vectors) | TB5 | compliance §5, safe-harbor-checklist |
| G6 | No **external pen test / red-team** of app logic or pipeline | TB2/TB7 | compliance gap #6 |
| G7 | Dev-mode **Vault** (root token, in-memory) — design assumes hardened Vault | TB3/TB6 | compliance gap #13 |
| G8 | This model **feeds**, but is not, a formal asset-by-asset risk analysis | all | compliance gap #1 |

The defensible claim: the **technical safeguards** are implemented or designed-and-costed, each
threat is met by a *named component* or an *acknowledged gap*, and the gaps are enumerated rather
than hidden — consistent with the posture stated in [compliance.md §11](../docs/compliance.md#11-gaps--roadmap-the-honest-table).
