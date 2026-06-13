# MedFlow API Gateway

A NestJS 10 service that fronts the MedFlow platform: an OAuth2/OIDC + SMART-on-FHIR
authorization server, a masking FHIR R4 proxy, ML inference passthrough, OMOP
analytics, and clinical-workflow APIs (users, care teams, messaging, appointments,
sharing). **All data in MedFlow is synthetic — no real PHI.**

- Runtime: Node 20, NestJS 10, TypeORM 0.3 (PostgreSQL), ioredis, Apollo GraphQL.
- Strict TypeScript (`no-explicit-any` enforced), pinned dependency versions.
- Tests: Vitest (`pnpm test`). Lint: ESLint (`pnpm lint`). Typecheck: `pnpm typecheck`.
- API docs: Swagger UI at **`/docs`**; GraphQL playground at **`/graphql`** (dev).

## Quick start

```bash
pnpm install                 # from the monorepo root
cp apps/api-gateway/.env.example apps/api-gateway/.env
pnpm --filter @medflow/api-gateway migration:run   # apply schema
pnpm --filter @medflow/api-gateway start:dev       # hot reload on :4000
```

Docker:

```bash
docker build --target dev  -t medflow/api-gateway:dev .   # hot reload
docker build --target prod -t medflow/api-gateway .        # slim runtime
```

## Module map

| Module          | Path                          | Responsibility |
|-----------------|-------------------------------|----------------|
| `auth`          | `src/modules/auth`            | OAuth2 authorization-code + PKCE, refresh, password & client-credentials grants; OIDC discovery / JWKS; `JwtAuthGuard`, `ScopesGuard`, pluggable `TokenSigner` (HS256 dev, RS256 prod swap). |
| `vault`         | `src/modules/vault`           | `VaultCryptoService` — Vault Transit envelope encryption with a circuit breaker. |
| `users`         | `src/modules/users`           | `User`/`Clinician`/`PatientLink`/`CareTeam`/`CareTeamMembership` entities + migrations; envelope-encrypted contact fields; care-team lookups; `GET /users/me`, `GET /users/me/care-team`. |
| `abac`          | `src/modules/abac`            | `PolicyEngine` (deny-overrides) + built-in policies; `AbacGuard` / `@RequirePolicy`; break-glass (`POST /abac/break-glass`). |
| `fhir-proxy`    | `src/modules/fhir-proxy`      | `/fhir/*` proxy with patient-context narrowing, minimum-necessary masking, OperationOutcome error mapping. |
| `ml`            | `src/modules/ml`              | `POST /ml/sepsis`, `/ml/readmission`, `/ml/chest-xray` (multipart passthrough) → ML serving; `X-Model-Track` / `X-Model-Version` headers. |
| `analytics`     | `src/modules/analytics`       | `POST /analytics/cohort` (parameterized Trino SQL over OMOP gold), `GET /analytics/audit`, `GET /worklist`, `GET /admin/models`. |
| `messaging`     | `src/modules/messaging`       | Care-team-restricted threads/messages; bodies never logged. |
| `appointments`  | `src/modules/appointments`    | Appointment CRUD + availability stub. |
| `share`         | `src/modules/share`           | `POST/GET/DELETE /share/tokens` — mini client-credentials grants with Redis revocation. |
| `audit`         | `src/modules/audit`           | Global `AuditInterceptor` → bounded queue → async batch POST to audit-service. |
| `rate-limit`    | `src/modules/rate-limit`      | `@nestjs/throttler` with Redis storage, keyed per OAuth client; shared Redis provider. |
| `health`        | `src/modules/health`          | `GET /healthz`, `GET /metrics` (prom-client). |
| `graphql`       | `src/modules/graphql`         | Read-only code-first `Patient`/`Observation`/`RiskScore` aggregation resolvers. |

## OAuth2 / SMART scopes

The gateway is its own OIDC issuer (`OIDC_ISSUER`) and exposes:

- `GET /.well-known/openid-configuration`, `GET /.well-known/jwks.json`
- `GET /oauth/authorize` (Authorization Code + **PKCE S256 required**)
- `POST /oauth/token` — `authorization_code`, `refresh_token`, `password`,
  `client_credentials` grants.

Scopes follow the **SMART on FHIR v1** grammar
`( patient | user | system )/( ResourceType | * ).( read | write | * | full )`
plus the special scopes (`openid`, `fhirUser`, `launch/patient`,
`offline_access`, …). Parsing/enforcement lives in `@medflow/shared-types`
(`parseSmartScopes`, `scopesAllow`). `ScopesGuard` + `@RequiredScopes(...)`
gate resource routes.

**MedFlow `.full` extension:** `.full` = `.read` *plus* the otherwise-masked
contact/identifier fields. It is the documented signal the FHIR-proxy masking
layer uses to decide whether to unmask `identifier` / `telecom` / `address`.

`launch/patient` tokens carry a `patient` claim; the FHIR proxy uses it to
**narrow** every request to that patient compartment (see below).

## ABAC (attribute-based access control)

Beyond coarse OAuth scopes, fine-grained authorization runs through a small,
pure `PolicyEngine` (`src/modules/abac`). A `Policy` is
`{ effect, actions[], resourceType, condition(subjectAttrs, resourceAttrs) }`.
Evaluation is **deny-overrides** with a **default deny**.

Built-in policies:

- **clinician-care-team-overlap** — a clinician may read a resource when they
  share a care team with the resource's patient.
- **patient-self-access** — a patient may read resources for their own linked
  FHIR Patient id.
- **admin-audit-read** — an admin may read `AuditEvent` records.
- **break-glass-override** — an active emergency grant allows reads regardless
  of care-team membership.

Attach `@RequirePolicy({ action, resourceType, patientIdFrom })` to a route and
`AbacGuard` assembles subject attributes (care-team patient ids, linked patient,
active break-glass grants) and evaluates. The decision is `{ decision, reason }`.

### Break-glass

`POST /abac/break-glass { patientId, justification }` (justification ≥ 20 chars)
grants a **1-hour** override stored in Redis and records a **CRITICAL** audit
event carrying the justification. The policy engine consults active grants on
every subsequent evaluation; when the Redis key expires the override is gone and
access reverts to the standard policies.

## FHIR proxy: narrowing + minimum-necessary masking

`/fhir/*` forwards to `FHIR_BASE_URL` with two safeguards:

1. **Patient-context narrowing** (`patient-context.ts`) — for `launch/patient`
   tokens, compartment searches get `?patient=<contextId>` injected (spoofed
   values are overwritten/rejected), Patient reads are pinned to the context
   patient, and cross-patient instance reads return **403**.
2. **Minimum-necessary masking** (`minimum-necessary.ts`) — `identifier`,
   `telecom`, and `address` are stripped from every resource (including Bundle
   entries) unless the caller holds a `.full`/wildcard or explicit `phi`/`contact`
   read scope for that resource type.

Upstream non-2xx responses are mapped to FHIR `OperationOutcome` resources.

## Vault envelope encryption

PHI contact fields (`users.email`, `users.phone`) are never stored in plaintext.
`VaultCryptoService` calls **HashiCorp Vault Transit** (mount `medflow-transit`,
key `phi-field-key`) to encrypt each value; the database stores the returned
`vault:v1:…` ciphertext envelope. The data key never leaves Vault — the gateway
only ever sees ciphertext and, for authorized reads, the decrypted plaintext in
memory. This is *envelope* encryption: Transit holds the key-encryption key and
performs crypto operations server-side, so key rotation re-wraps ciphertext
without touching application data.

A **circuit breaker** opens after repeated Vault failures: reads degrade to a
masked placeholder, but **writes fail closed** — the service refuses to persist
plaintext as a fallback, preserving data integrity.

## Observability & limits

- **Audit** — a global interceptor records `{ actorId, actorRole, action,
  resourceType, resourceId, ip, userAgent, justification? }` (no request/response
  bodies → no PHI) onto a bounded queue that batch-POSTs to `AUDIT_SERVICE_URL`.
  On overflow it drops the oldest event and warns; it never blocks or fails a
  request.
- **Rate limiting** — `@nestjs/throttler` backed by Redis, keyed per OAuth
  client: a 10 req/s burst window and a 100 req/min sustained window, enforced
  consistently across replicas.
- **Health/metrics** — `GET /healthz` (DB readiness) and `GET /metrics`
  (Prometheus via `prom-client`).
- **Tracing** — OpenTelemetry auto-instrumentation (see `src/telemetry.ts`).

## Environment

See `.env.example`. Key variables: `DATABASE_URL`, `FHIR_BASE_URL`,
`ML_SERVING_URL`, `TRINO_URL`, `AUDIT_SERVICE_URL`, `DEID_SERVICE_URL`,
`REDIS_URL`, `VAULT_ADDR`/`VAULT_TOKEN`, `JWT_SIGNING_KEY`, `OIDC_ISSUER`,
`MLFLOW_URL`.
