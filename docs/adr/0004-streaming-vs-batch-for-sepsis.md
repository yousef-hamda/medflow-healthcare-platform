# ADR-0004: PyFlink streaming (not micro-batch or cron) for sepsis scoring

## Status

Accepted (2024-Q4). Governs the realtime clinical path described in
[architecture.md §2.4](../architecture.md#24-stream-processing--the-sepsis-job) and §3.1.
Operational triage of this path lives in
[sepsis-alert-rate-doubled runbook](../runbooks/sepsis-alert-rate-doubled.md).

## Context

The sepsis early-warning path consumes `vitals.raw` (12 partitions, keyed by patient ID for
per-patient ordering), maintains **6-hour sliding windows advancing every 15 minutes** per
patient over HR/RR/SBP/SpO₂/temp/consciousness, scores each fired window against the sepsis LSTM
in ml-serving (NEWS2 rule fallback if serving is unreachable), **dedupes** repeat alerts per
patient for 30 minutes unless severity escalates, and emits to `alerts`.

What the workload actually demands:

- **Per-patient keyed, stateful sliding windows** that persist across events and survive restarts
  — the window *is* the model's input.
- **Per-patient ordering** (already guaranteed by the Kafka key) folded into window state
  correctly.
- **30-minute keyed dedupe state** with escalation logic — stateful, per patient.
- **Restart without losing window state** (a crash must not blank every patient's 6h history).
- Latency that is **dominated by the 15-minute window slide, not by infrastructure** — clinical
  acceptability comes from the window cadence, so the engine must add negligible latency and,
  above all, must not drop or double-emit alerts.

The key insight: this is a **stateful, keyed, windowed** problem with **exactly-once** alerting
needs, not a throughput-bound or latency-bound problem. The cadence is fixed at 15 minutes by the
model design; the engineering bar is correctness of state and emission.

## Decision

Use **Apache Flink (PyFlink 1.18)** with keyed windowed state (RocksDB state backend in K8s,
heap locally), checkpointing for exactly-once, async I/O to ml-serving with a timeout that
triggers the NEWS2 fallback, and keyed state for 30-minute dedupe.

## Alternatives considered

### Spark Structured Streaming (micro-batch)

The strongest alternative; we already run Spark for the batch lakehouse, so reuse is appealing.
Rejected for the *streaming sepsis* path:

- **Micro-batch latency floor:** Structured Streaming processes in micro-batches; even with
  small trigger intervals there is a batch-boundary tax. Here latency is dominated by the window
  slide so this is not disqualifying on its own — but it buys nothing either.
- **Sliding-window + per-key state ergonomics:** Flink's keyed sliding windows + `ProcessFunction`
  with keyed state and timers express "6h/15min per patient + 30-min dedupe with escalation"
  more directly than Structured Streaming's window/watermark/`flatMapGroupsWithState` model,
  whose arbitrary stateful operations and timer semantics are more constrained.
- **Async external calls:** Flink's Async I/O operator is purpose-built for the bounded-capacity,
  timeout-to-fallback call into ml-serving. Doing the same inside a Spark micro-batch
  `mapPartitions` is clunkier and couples external-call latency to batch progress.
- **Exactly-once with side effects:** both can do exactly-once into sinks; Flink's checkpoint +
  keyed-state model maps more cleanly onto "rebuild every patient's window from state on restart,
  suppress ≤1 slide of duplicates with dedupe state."

We still use **Spark for the batch backstop** (`vitals_to_bronze` re-derives bronze from
`vitals.raw`) — right tool, right layer. Streaming and batch are not either/or here; they are the
two halves of a lambda-ish design where Flink owns low-latency alerting and Spark owns the
durable re-derivable copy.

### Cron polling (scheduled query over Postgres `vitals` / a Spark batch job every N minutes)

The simplest possible thing. Rejected:

- **Recomputes 6h of window for every patient every run** — wasteful and worsens as patient
  count grows; streaming folds each reading in incrementally.
- **No real exactly-once / dedupe:** a cron job must reimplement "have I already alerted this
  patient in the last 30 min?" against the DB on every run, racing with itself and with late data.
- **Latency is the poll interval**, and shortening it multiplies the recompute cost.
- **Backpressure is invisible:** under load a cron job silently runs long and overlaps;
  Flink/Kafka make lag an explicit, alertable signal (`records-lag-max`).
- It would, however, be perfectly fine for a **non-realtime** sepsis surveillance report — which
  is exactly why the batch path exists for analytics and this one does not.

## Consequences

**Positive**

- **Correct stateful windows that survive restart:** Flink restarts from the last checkpoint and
  rebuilds each patient's 6h windows from state; at most ~1 slide of duplicate alerts, suppressed
  by the 30-minute dedupe (see failure table,
  [architecture.md §6](../architecture.md#6-failure-modes-by-layer)).
- **Exactly-once alerting** end to end, so a clinician is not spammed by replays or robbed of an
  alert by a crash.
- **Async-I/O fallback** degrades *quality* (model → NEWS2), never *availability* — the alert
  still fires, tagged `news2-fallback` so dashboards and audit can tell them apart.
- **Lag is the backpressure signal:** `vitals.raw` consumer lag is observable and alertable long
  before the 7-day retention window is at risk.
- Parallelism scales to the 12 `vitals.raw` partitions; keyed state rescales via savepoints.

**Negative / costs (honest)**

- **Operational heft:** Flink (JobManager/TaskManager, checkpoint storage, savepoint lifecycle,
  RocksDB tuning, state-backend sizing) is a second stateful compute system to run and reason
  about, distinct from Spark. This is the single biggest cost of the decision.
- **A separate skill set / codebase** (PyFlink) from the Spark/dbt batch world — two paradigms in
  one repo.
- **Stateful upgrades are non-trivial:** changing window logic or state schema requires
  savepoint-compatible migrations, not just a redeploy.
- **Hot-patient skew:** per-patient keying means a very high-frequency device caps per-slot
  throughput; mitigated by partition count and acknowledged in the scaling story.
- **Local fidelity gap:** locally the state backend is heap and Kafka is single-broker plaintext;
  the exactly-once story is only fully real in the mesh-encrypted, RocksDB-checkpointed K8s
  deployment. We call this out rather than pretend laptop == prod.
