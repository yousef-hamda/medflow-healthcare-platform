# @medflow/proto

Protobuf definitions for MedFlow's Kafka event contracts:

- `medflow.v1.VitalsReading` — topics `vitals.raw`, `vitals.aggregates`
- `medflow.v1.SepsisAlert` — topic `alerts`
- `medflow.v1.PredictionLogged` — topic `predictions`

These are the cross-language source of truth (Flink/Java, Python ML services).
The Node services use the matching JSON/Zod schemas in `@medflow/shared-types`;
field names and semantics are kept in lock-step.

## Layout

```
proto/medflow/v1/events.proto   # schemas
buf.yaml                        # buf v2 module + lint/breaking rules
buf.gen.yaml                    # TS / Python / Java generation (pinned plugin versions)
gen/                            # CI output only — not committed (see gen/README.md)
```

## Usage

```bash
pnpm --filter @medflow/proto lint    # buf lint
pnpm --filter @medflow/proto build   # buf generate → gen/{ts,python,java}
```

Breaking-change detection (`buf breaking --against '.git#branch=main'`) runs in CI.
