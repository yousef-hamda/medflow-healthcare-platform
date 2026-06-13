# MedFlow contract tests (Pact)

Consumer-driven contract (CDC) tests for the MedFlow service mesh. All data here
is **synthetic** — no real PHI is ever used.

These tests pin the request/response shapes that flow between MedFlow services
so a provider can't break a consumer silently. They are **consumer** tests: each
spec spins up a Pact mock server, asserts the consumer can talk to it, and emits
a pact file in [`pacts/`](./pacts). Providers then verify those pacts in their
own pipelines.

## Contracts in this package

| Consumer             | Provider      | Spec file                          | Interactions |
| -------------------- | ------------- | ---------------------------------- | ------------ |
| clinician-dashboard  | api-gateway   | `src/dashboard-gateway.pact.test.ts`  | `GET /worklist`, `GET /fhir/Patient/{id}`, `POST /analytics/cohort` |
| api-gateway          | ml-serving    | `src/gateway-mlserving.pact.test.ts`  | `POST /predict/sepsis`, `POST /predict/readmission` |

## Layout

```
tests/contract/
├── package.json            @medflow/contract-tests (pact ^12, vitest, typescript)
├── tsconfig.json
├── vitest.config.ts        runs src/**/*.pact.test.ts, serial (mock-server ports)
├── pacts/                  generated pact JSON (output dir; git-ignored artifact)
└── src/
    ├── dashboard-gateway.pact.test.ts
    └── gateway-mlserving.pact.test.ts
```

## Running locally

```bash
pnpm --filter @medflow/contract-tests install   # or: cd tests/contract && pnpm install
pnpm --filter @medflow/contract-tests test
```

Generated pacts land in `tests/contract/pacts/<consumer>-<provider>.json`.

## Consumer → pact → provider verification wiring

1. **Consumer side (this package).** `vitest run` executes each `*.pact.test.ts`.
   Pact starts a mock provider, the consumer code hits it, and on success Pact
   writes/updates the contract in `pacts/`.
2. **Publish (optional Pact Broker).** In CI the pacts are published with the
   commit SHA as the consumer version:
   ```bash
   GIT_SHA=$GITHUB_SHA pnpm --filter @medflow/contract-tests pact:publish
   ```
   Without a broker, the `pacts/` JSON files are uploaded as a CI artifact and
   consumed directly by the provider job.
3. **Provider side.** Each provider verifies the pact against a real (or
   in-process) instance using its native Pact verifier:
   - **api-gateway** (`@pact-foundation/pact` `Verifier`) replays the
     dashboard→gateway pact against a booted NestJS app, using provider states
     (`given(...)`) to seed fixtures.
   - **ml-serving** (`pact-python` `Verifier`) replays the gateway→ml-serving
     pact against the FastAPI/BentoML app with mocked models.
4. **Gate.** A provider that fails verification fails its own CI job, which
   blocks the merge — the contract is the source of truth for both sides.

## How CI verifies

The root `.github/workflows/ci.yml` runs this package as part of the **node**
job (`pnpm -r test`, since it's a workspace member) so the consumer pacts are
regenerated and validated on every PR that touches node code. The pacts are then
either published to the broker (if `PACT_BROKER_BASE_URL` is configured) or
uploaded as an artifact for the provider verification jobs to download. Provider
verification is wired into each provider service's own test step (`mvn verify` /
`pytest` / NestJS `Verifier`), so a contract change must pass on both consumer
and provider before it can merge.
