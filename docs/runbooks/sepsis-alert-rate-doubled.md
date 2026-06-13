# Runbook: Sepsis alert rate doubled

> Scope: the rate of sepsis alerts on the `alerts` topic / dashboard has roughly doubled (or
> spiked) versus baseline. The job that produces them is the PyFlink sepsis path
> ([architecture.md §2.4](../architecture.md#24-stream-processing--the-sepsis-job),
> [ADR-0004](../adr/0004-streaming-vs-batch-for-sepsis.md)).
>
> **Severity:** SEV-2. Alert *fatigue* is a patient-safety problem (clinicians tune out a noisy
> feed), and a true population shift is also patient-safety-relevant. The job is **not** broken —
> it is emitting more alerts — so the work here is **triage of cause**, not restart.

The discipline of this runbook is the triage tree: **model vs data vs population vs config.**
Resist the urge to "fix" by raising the threshold before you know which of the four it is —
suppressing real alerts is the worst outcome.

## Symptoms

- Prometheus alert on `alerts` topic produce-rate (or per-unit alert count) above its baseline.
- Clinicians report a flood of sepsis warnings; worklist is mostly red.
- Possibly a rise specifically in `source=news2-fallback` alerts (a clue — points at serving, not
  the model).

## Diagnose — the triage tree

### Step 0: Quantify and split by provenance

Every alert is tagged `model` vs `news2-fallback`. That tag bisects the problem immediately.

```bash
# Sample recent alerts and count by source — model-driven vs rule fallback
docker compose exec kafka kafka-console-consumer.sh --bootstrap-server localhost:9092 \
  --topic alerts --max-messages 200 --timeout-ms 8000 \
  | python3 -c "import sys,json,collections
c=collections.Counter(json.loads(l).get('source','?') for l in sys.stdin if l.strip());print(c)"
```

- **Spike is mostly `news2-fallback`** → ml-serving is unreachable/timing out; Flink fell back to
  the NEWS2 rule for many windows. Go to **Branch B (serving/infra)**.
- **Spike is mostly `model`** → the model is scoring more windows above threshold. Continue.

### Branch A — DATA drift (the input distribution changed)

Check Evidently drift reports and the Great Expectations results on the vitals path. Drift in the
*input features* makes the model fire more without the model or the patients having "really"
changed in a clinically meaningful way.

```bash
# Evidently drift reports land in the drift-reports bucket
docker compose exec minio mc ls --recursive local/drift-reports/ 2>/dev/null | tail
docker compose exec minio mc cat local/drift-reports/sepsis/latest/summary.json 2>/dev/null \
  | python3 -m json.tool | grep -iE "drift|share|column" | head -40
# GE results on the vitals/bronze path (schema/range violations = bad upstream data)
docker compose exec airflow-scheduler \
  ls -t /opt/airflow/great_expectations/uncommitted/validations/ | head
```

Drift signatures: a unit changed (temp in °F vs °C), a device firmware update shifted a sensor
baseline, SpO₂ calibration drift, or a new device cohort with different characteristics. **This is
a data-quality problem, fix upstream** (ingester normalization, device onboarding), not a threshold
problem.

### Branch B — SERVING / INFRA (fallback storm or feature staleness)

```bash
# Is ml-serving healthy and is the sepsis model loaded?
curl -s -o /dev/null -w "ml-serving=%{http_code}\n" http://localhost:8094/docs
docker compose logs --tail=120 ml-serving | grep -iE "sepsis|timeout|error|model|feast|redis"
# Flink async-call timeouts → fallback. Check the job and Kafka lag.
docker compose logs --tail=120 flink-jobmanager flink-taskmanager 2>/dev/null \
  | grep -iE "async|timeout|sepsis|checkpoint|restart|fallback"
docker compose exec kafka kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
  --describe --group flink-sepsis | awk 'NR==1 || $5+0>0'   # any LAG?
# Feast online (Redis) stale/missing features can shift scores
docker compose exec redis redis-cli ping
```

If serving is timing out: NEWS2 fallback is louder/more conservative by design, so a serving
outage *can* raise the alert count. Fix is to **restore serving** (the platform's availability
choice), not to retune — the model alerts will return to baseline.

### Branch C — POPULATION (the patients really are sicker) — or the SIMULATOR

In a synthetic system the most common cause is the **vitals simulator config**: more patients are
deliberately trending toward sepsis than baseline.

```bash
# How many simulated patients are configured to trend septic?
docker compose exec wearables-ingester env | grep -iE "SEPSIS|TREND|SIM"   # sim ratios if set here
grep -RniE "sepsis|trend|septic|ratio" scripts/simulators/vitals_stream.py | head
# Look at the actual vitals distribution feeding the windows
docker compose exec postgres psql -U medflow -d vitals -c \
  "SELECT date_trunc('hour',ts) h, count(*) n,
          round(avg(hr)) hr, round(avg(rr)) rr, round(avg(sbp)) sbp, round(avg(spo2)) spo2
   FROM vitals_readings WHERE ts > now()-interval '6 hours' GROUP BY 1 ORDER BY 1;"
```

If the simulator was turned up (or, with real data, a genuine outbreak/heat-event/population shift),
the alerts are **true positives** and must not be suppressed.

### Branch D — CONFIG / MODEL (threshold or model version changed)

```bash
# Sepsis decision threshold env (the most likely accidental cause of a doubling)
docker compose exec ml-serving env | grep -iE "SEPSIS.*THRESH|THRESHOLD|NEWS2"
docker compose exec flink-jobmanager env 2>/dev/null | grep -iE "THRESH|DEDUPE|WINDOW"
# Was a new sepsis model promoted recently? (a regressed/miscalibrated version fires more)
curl -s http://localhost:5000/api/2.0/mlflow/registered-models/get-latest-versions \
  -H 'Content-Type: application/json' \
  -d '{"name":"sepsis-ews","stages":["Production"]}' | python3 -m json.tool
# Is 30-min dedupe actually suppressing? (a dedupe-state bug = duplicate alerts inflating the rate)
docker compose exec kafka kafka-console-consumer.sh --bootstrap-server localhost:9092 \
  --topic alerts --max-messages 200 --timeout-ms 8000 \
  | python3 -c "import sys,json,collections
c=collections.Counter(json.loads(l).get('patient_id') for l in sys.stdin if l.strip())
print('patients with >1 alert in sample:', sum(1 for v in c.values() if v>1))"
```

A lowered threshold env, a newly promoted miscalibrated model, or broken dedupe state (same patient
alerting repeatedly within 30 min) each produce a rate spike with distinct signatures above.

## Remediate

- **Data drift (B-data / Branch A):** fix upstream — correct unit normalization in the ingester,
  quarantine the misbehaving device cohort, re-run the affected bronze/silver path. Do **not** retune
  the model to paper over bad input.
- **Serving outage (Branch B):** restore ml-serving / Feast / Redis; fallback alerts subside as the
  model resumes scoring. `docker compose restart ml-serving` and confirm `/docs` 200 + model loaded.
- **Population / simulator (Branch C):** if simulator-driven, that is expected test behavior — note
  it and move on. If real population shift, alerts are valid; **inform clinical leads, do not
  suppress.**
- **Config/model (Branch D):** if a threshold env was changed in error, revert it. If a newly
  promoted model regressed, **roll back the registry stage** to the previous Production version
  (canary-by-patient-hash should have caught this — check why it didn't). If dedupe state is broken,
  restart the Flink job from its last good checkpoint to reset keyed dedupe state.

## Escalate

- **Real population shift / outbreak suspicion** → clinical leads + infection-control; this is a
  care decision, not an ops one.
- **Model regression confirmed** → ML on-call / model owner; pull the bad version, open an incident
  on why canary/Evidently didn't gate it.
- **Persistent fallback storm** → platform on-call (ml-serving/Feast availability).

## Prevent

- Keep the `source=model|news2-fallback` tag on every alert — it is the single most valuable triage
  signal and bisects the problem in one query.
- Treat the **sepsis threshold env as a guarded, reviewed config**, not a knob; changes should be
  PR-reviewed and announced.
- Canary new sepsis models by patient-hash with Evidently drift + performance gates **before**
  promotion to Production (see [ml.md](../ml.md)); a doubling should be caught in canary, not prod.
- Alert on **drift** (Evidently) and on **fallback ratio** (`news2-fallback` share) independently —
  each catches a different one of the four causes early.
- Monitor dedupe effectiveness (per-patient alert frequency) so a state bug surfaces as a metric,
  not as clinician complaints.
