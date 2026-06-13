# MedFlow — Real-time Sepsis Alerting (PyFlink 1.18)

Streaming early-warning job that scores patients for sepsis in real time off the
`vitals.raw` Kafka topic and publishes alerts to `alerts` and rolling features
to `vitals.aggregates`.

```
vitals.raw ──▶ parse + event-time watermark (2 min) ──▶ key_by(patient_id)
            ──▶ sliding 6h / 15min event-time window ──▶ window features
            ──▶ ml-serving /predict/sepsis  (NEWS2 local fallback if down)
            ──▶ rising + threshold + keyed-state dedupe
            ├──▶ alerts             (side output, alert records)
            └──▶ vitals.aggregates  (every window, rolling features)
```

## Files

| File | Purpose |
| --- | --- |
| `sepsis_alerting.py` | PyFlink job: Kafka/windowing/state/HTTP wiring only. |
| `sepsis_logic.py` | **Pure** logic: `window_features`, NEWS2 scoring, `dedupe_decision`. Flink-free, unit-tested. |
| `config.py` | Env-driven config (Kafka, ml-serving, thresholds, checkpointing). |
| `tests/test_sepsis_logic.py` | Cluster-free unit tests for `sepsis_logic`. |
| `requirements.txt` | `apache-flink==1.18.1` + test deps. |

## Scoring

For each 6-hour sliding window (advanced every 15 min) the most adverse value
per vital is fed to **ml-serving** `POST http://ml-serving:8094/predict/sepsis`.
If ml-serving is unreachable / times out / returns a bad body, the job falls
back to a **local NEWS2 score** so alerting never stalls on a model outage. The
fallback computes proper NEWS2 sub-scores for respiratory rate, SpO₂ (Scale 1),
supplemental O₂, temperature, systolic BP, heart rate and consciousness (AVPU),
and maps the 0–21 aggregate to a 0–1 score (`total / 21`). NEWS2 ≥ 7 (the
clinical "urgent response" trigger) already clears the `0.6` alert threshold.

## Alerting & de-duplication

An alert is emitted only when **all** hold:

1. `score ≥ SEPSIS_ALERT_THRESHOLD` (`0.6`, env `MEDFLOW_SEPSIS_ALERT_THRESHOLD`);
2. the score is **rising** versus the previous window evaluation
   (deterioration, not a steady-state high reading);
3. de-dup keyed state allows it: repeats within **30 min** are suppressed
   *unless the risk band escalates* (low → medium → high), so a worsening
   patient is never silenced.

Risk band blends the model score with NEWS2 red flags — a single NEWS2 `3`
parameter can only raise the band.

## Exactly-once & checkpointing

- `env.enable_checkpointing(30s, EXACTLY_ONCE)`.
- Checkpoint storage: **`s3://lakehouse/_flink-checkpoints/sepsis`** (MinIO via
  the cluster's S3 filesystem plugin; override with
  `MEDFLOW_FLINK_CHECKPOINT_DIR`). Unaligned checkpoints are enabled for low
  backpressure latency; one concurrent checkpoint, 5 s min pause.
- The **KafkaSource** stores its offsets in Flink state and commits them on
  checkpoint (offsets are *not* relied upon from the broker for correctness).
- The **KafkaSinks** are transactional, giving end-to-end exactly-once for the
  `vitals.aggregates` stream.

### Failure & recovery

- On a TaskManager/JobManager failure the job restarts from the last completed
  checkpoint: the source rewinds to the checkpointed offsets and all keyed state
  (per-patient last-alert time/score/band, last evaluated score) is restored, so
  in-flight windows are recomputed deterministically.
- Because alert delivery is at-least-once under replay, the **keyed-state dedupe
  is the idempotency guard**: any window reprocessed after recovery produces the
  same dedupe decision and does not double-fire an alert that was already sent
  within its suppression window.
- A planned restart should use a **savepoint**
  (`flink stop --savepoint s3://lakehouse/_flink-checkpoints/sepsis/savepoints …`)
  so per-patient state survives upgrades.

## Run

```bash
# Submit to the session cluster (Kafka connector jar on the classpath):
flink run -py sepsis_alerting.py \
  --jarfile flink-sql-connector-kafka-3.1.0-1.18.jar

# Unit tests (no Flink required):
cd data/flink && python -m pytest tests/ -q
```

Configuration is entirely env-driven (see `config.py`); defaults target the
local `docker-compose` stack (`kafka:9092`, `ml-serving:8094`, MinIO checkpoints).
