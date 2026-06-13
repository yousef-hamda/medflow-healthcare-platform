# @medflow/shared-types

Shared TypeScript types and Zod schemas used across MedFlow Node services.

## Contents

| Module            | Exports                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `events`          | `VitalsReading`, `KafkaAlertEvent`, `PredictionEvent`, `FeatureContribution`, `riskBandFromScore` |
| `audit`           | `AuditEvent` (+ schema), `PHI_FIELDS`, `buildPinoRedactPaths` (pino redaction helper)             |
| `smart-scopes`    | `parseSmartScope(s)`, `scopesAllow`, `hasFullFieldAccess` — SMART on FHIR v1 scope grammar        |
| `cds-hooks`       | CDS Hooks 1.1 request/response/card/feedback types and Zod schemas                                |

All Kafka payload schemas correspond to topics `alerts`, `vitals.aggregates`,
`predictions`, and `audit.events` (see `infra/docker/kafka/create-topics.sh`).

## SMART scope grammar

`(patient|user|system)/(ResourceType|*) . (read|write|*)` per the SMART App
Launch spec, plus a **MedFlow extension**: the `.full` permission means `.read`
*plus* access to minimum-necessary-masked fields (`identifier`, `telecom`,
`address`). The api-gateway masking middleware strips those fields unless the
token carries `.full` (or `.*`) for the resource type.

## Build

Dual ESM + CJS output via [tsup](https://tsup.egoist.dev):

```bash
pnpm --filter @medflow/shared-types build   # dist/index.js (ESM), dist/index.cjs, dist/index.d.ts
pnpm --filter @medflow/shared-types test    # vitest
```
