"""PyFlink 1.18 real-time sepsis early-warning job.

Topology
--------
``vitals.raw`` (Kafka, JSON, event-time) → assign watermarks (2 min bounded
out-of-orderness) → ``key_by(patient_id)`` → sliding **6 h / 15 min** event-time
window → :class:`SepsisWindowFn` aggregates each window into a feature vector
(``sepsis_logic.window_features``). The window output then flows through a keyed
:class:`SepsisScoringFn` (``RichMapFunction``) that:

1. POSTs the feature vector to ml-serving ``/predict/sepsis``; on any error or
   timeout it falls back to a **local NEWS2 score**
   (``sepsis_logic.news2_score``) so alerting degrades gracefully and never
   stalls when the model service is down;
2. applies the rising-and-threshold + keyed-state de-duplication rules
   (``sepsis_logic.dedupe_decision``) — repeats inside 30 min are suppressed
   unless the risk band escalates;
3. always emits a compact aggregate record (to ``vitals.aggregates``) and, when
   an alert fires, an alert record (to ``alerts``).

A side-output tag separates alerts from aggregates so the two Kafka sinks stay
independent. All scoring/feature/dedupe logic lives in ``sepsis_logic`` (pure,
unit-tested); this file only does the Flink/Kafka/HTTP wiring.

Checkpointing uses exactly-once mode against
``s3://lakehouse/_flink-checkpoints`` (see README.md). The Kafka source commits
offsets on checkpoint and the sinks are transactional, giving end-to-end
exactly-once for the aggregate stream and at-least-once-with-dedup semantics for
alerts (the keyed-state dedupe additionally collapses any reprocessed repeats).
"""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from typing import Iterable, Optional

from pyflink.common import Duration, Time, Types, WatermarkStrategy
from pyflink.common.serialization import SimpleStringSchema
from pyflink.common.watermark_strategy import TimestampAssigner
from pyflink.datastream import (
    OutputTag,
    RuntimeContext,
    StreamExecutionEnvironment,
)
from pyflink.datastream.checkpointing_mode import CheckpointingMode
from pyflink.datastream.connectors.kafka import (
    KafkaOffsetsInitializer,
    KafkaRecordSerializationSchema,
    KafkaSink,
    KafkaSource,
)
from pyflink.datastream.functions import KeyedProcessFunction
from pyflink.datastream.state import ValueStateDescriptor
from pyflink.datastream.window import SlidingEventTimeWindows, ProcessWindowFunction

from config import SepsisConfig, get_config
from sepsis_logic import (
    AlertState,
    VitalsReading,
    WindowFeatures,
    band_for_score,
    dedupe_decision,
    news2_from_features,
    news2_score,
    window_features,
)

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("medflow.flink.sepsis")

# Side-output for alert records; main output carries aggregates.
ALERT_TAG = OutputTag("sepsis-alerts", Types.STRING())


# ───────────────────────── parsing / watermarks ─────────────────────────
def parse_reading(raw: str) -> Optional[VitalsReading]:
    """Parse one ``vitals.raw`` JSON message into a :class:`VitalsReading`.

    Tolerant of the field-name variants used across device feeds; returns
    ``None`` for unparseable or patient-less messages (filtered downstream).
    """
    try:
        d = json.loads(raw)
    except (ValueError, TypeError):
        return None
    patient_id = d.get("patient_id") or d.get("patientId") or d.get("subject")
    if not patient_id:
        return None
    event_time_ms = (
        d.get("event_time_ms")
        or d.get("timestamp_ms")
        or d.get("ts")
        or 0
    )

    def _num(*keys: str) -> Optional[float]:
        for k in keys:
            v = d.get(k)
            if v is not None:
                try:
                    return float(v)
                except (TypeError, ValueError):
                    return None
        return None

    return VitalsReading(
        patient_id=str(patient_id),
        event_time_ms=int(event_time_ms),
        heart_rate=_num("heart_rate", "hr", "heartRate"),
        resp_rate=_num("resp_rate", "rr", "respiratoryRate"),
        spo2=_num("spo2", "SpO2", "oxygen_saturation"),
        temperature_c=_num("temperature_c", "temp", "temperature"),
        systolic_bp=_num("systolic_bp", "sbp", "systolic"),
        supplemental_o2=bool(d.get("supplemental_o2") or d.get("on_oxygen") or False),
        consciousness_avpu=str(d.get("consciousness_avpu") or d.get("avpu") or "A"),
    )


class VitalsTimestampAssigner(TimestampAssigner):
    """Event-time extractor: uses the reading's ``event_time_ms``."""

    def extract_timestamp(self, value: VitalsReading, record_timestamp: int) -> int:
        return value.event_time_ms


# ───────────────────────── windowing ─────────────────────────
class SepsisWindowFn(ProcessWindowFunction):
    """Collapse a 6h sliding window of one patient's readings into features."""

    def process(self, key, context, elements: Iterable[VitalsReading]):
        readings = list(elements)
        if not readings:
            return
        window_end_ms = context.window().end
        features = window_features(str(key), window_end_ms, readings)
        # Emit as JSON so the keyed scoring function stays serialization-simple.
        yield json.dumps(_features_to_dict(features))


def _features_to_dict(f: WindowFeatures) -> dict:
    d = {
        "patient_id": f.patient_id,
        "window_end_ms": f.window_end_ms,
        "n_readings": f.n_readings,
        "heart_rate_mean": f.heart_rate_mean,
        "heart_rate_max": f.heart_rate_max,
        "resp_rate_mean": f.resp_rate_mean,
        "resp_rate_max": f.resp_rate_max,
        "spo2_mean": f.spo2_mean,
        "spo2_min": f.spo2_min,
        "temperature_mean": f.temperature_mean,
        "temperature_max": f.temperature_max,
        "systolic_bp_mean": f.systolic_bp_mean,
        "systolic_bp_min": f.systolic_bp_min,
        "supplemental_o2_any": f.supplemental_o2_any,
        "consciousness_worst": f.consciousness_worst,
    }
    return d


def _dict_to_features(d: dict) -> WindowFeatures:
    return WindowFeatures(
        patient_id=d["patient_id"],
        window_end_ms=d["window_end_ms"],
        n_readings=d["n_readings"],
        heart_rate_mean=d.get("heart_rate_mean"),
        heart_rate_max=d.get("heart_rate_max"),
        resp_rate_mean=d.get("resp_rate_mean"),
        resp_rate_max=d.get("resp_rate_max"),
        spo2_mean=d.get("spo2_mean"),
        spo2_min=d.get("spo2_min"),
        temperature_mean=d.get("temperature_mean"),
        temperature_max=d.get("temperature_max"),
        systolic_bp_mean=d.get("systolic_bp_mean"),
        systolic_bp_min=d.get("systolic_bp_min"),
        supplemental_o2_any=bool(d.get("supplemental_o2_any", False)),
        consciousness_worst=d.get("consciousness_worst", "A"),
    )


# ───────────────────────── scoring + ml-serving + dedupe ─────────────────────────
def call_ml_serving(payload: dict, url: str, timeout: float) -> Optional[float]:
    """POST features to ml-serving ``/predict/sepsis``; return score or None.

    Returns ``None`` on *any* error (HTTP, timeout, malformed body) so the caller
    falls back to the local NEWS2 score — alerting must never depend on the model
    service being reachable.
    """
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = json.loads(response.read().decode("utf-8"))
    except Exception:  # noqa: BLE001 - degrade to fallback on any failure
        return None
    score = data.get("score", data.get("probability", data.get("sepsis_score")))
    try:
        return float(score) if score is not None else None
    except (TypeError, ValueError):
        return None


class SepsisScoringFn(KeyedProcessFunction):
    """Score each window, dedupe alerts via keyed state, emit aggregates+alerts."""

    def __init__(self, config: SepsisConfig):
        self._cfg = config
        self._alert_state = None  # AlertState (last emitted alert)
        self._prev_score_state = None  # last evaluated score (for rising check)

    def open(self, runtime_context: RuntimeContext):
        self._alert_state = runtime_context.get_state(
            ValueStateDescriptor("sepsis_alert_state", Types.STRING())
        )
        self._prev_score_state = runtime_context.get_state(
            ValueStateDescriptor("sepsis_prev_score", Types.FLOAT())
        )

    def _load_alert_state(self) -> Optional[AlertState]:
        raw = self._alert_state.value()
        if not raw:
            return None
        d = json.loads(raw)
        return AlertState(
            last_alert_time_ms=d["last_alert_time_ms"],
            last_score=d["last_score"],
            last_band=d["last_band"],
        )

    def process_element(self, value: str, ctx: "KeyedProcessFunction.Context"):
        features = _dict_to_features(json.loads(value))

        cfg = self._cfg
        model_score = call_ml_serving(
            features.to_serving_payload(), cfg.serving_url, cfg.serving_timeout_seconds
        )
        used_fallback = model_score is None
        score = news2_score(features) if used_fallback else model_score

        news = news2_from_features(features)
        band = band_for_score(score, features)
        prev_score = self._prev_score_state.value()

        # Always emit an aggregate record.
        aggregate = {
            "patient_id": features.patient_id,
            "window_end_ms": features.window_end_ms,
            "n_readings": features.n_readings,
            "score": round(score, 4),
            "score_source": "news2_fallback" if used_fallback else "ml_serving",
            "news2": news.total,
            "risk_band": band,
            "heart_rate_mean": features.heart_rate_mean,
            "resp_rate_mean": features.resp_rate_mean,
            "spo2_mean": features.spo2_mean,
            "temperature_mean": features.temperature_mean,
            "systolic_bp_mean": features.systolic_bp_mean,
        }
        yield json.dumps(aggregate)

        decision = dedupe_decision(
            score=score,
            band=band,
            event_time_ms=features.window_end_ms,
            prev_score=prev_score,
            state=self._load_alert_state(),
            threshold=cfg.alert_threshold,
            dedupe_seconds=cfg.dedupe_window_seconds,
            rising_epsilon=cfg.rising_epsilon,
        )

        self._prev_score_state.update(float(score))

        if decision.emit:
            alert = {
                "alert_type": "sepsis_early_warning",
                "patient_id": features.patient_id,
                "window_end_ms": features.window_end_ms,
                "score": round(score, 4),
                "score_source": "news2_fallback" if used_fallback else "ml_serving",
                "news2": news.total,
                "risk_band": band,
                "reason": decision.reason,
            }
            self._alert_state.update(
                json.dumps(
                    {
                        "last_alert_time_ms": features.window_end_ms,
                        "last_score": float(score),
                        "last_band": band,
                    }
                )
            )
            ctx.output(ALERT_TAG, json.dumps(alert))


# ───────────────────────── job assembly ─────────────────────────
def build_job(env: StreamExecutionEnvironment, cfg: SepsisConfig) -> None:
    source = (
        KafkaSource.builder()
        .set_bootstrap_servers(cfg.bootstrap_servers)
        .set_topics(cfg.source_topic)
        .set_group_id(cfg.consumer_group)
        .set_starting_offsets(KafkaOffsetsInitializer.committed_offsets())
        .set_value_only_deserializer(SimpleStringSchema())
        .build()
    )

    watermark = (
        WatermarkStrategy.for_bounded_out_of_orderness(
            Duration.of_millis(cfg.watermark_out_of_orderness_ms)
        ).with_timestamp_assigner(VitalsTimestampAssigner())
    )

    readings = (
        env.from_source(
            source, WatermarkStrategy.no_watermarks(), "vitals-raw-source"
        )
        .map(parse_reading, output_type=Types.PICKLED_BYTE_ARRAY())
        .filter(lambda r: r is not None)
        .assign_timestamps_and_watermarks(watermark)
    )

    windowed = (
        readings.key_by(lambda r: r.patient_id, key_type=Types.STRING())
        .window(
            SlidingEventTimeWindows.of(
                Time.milliseconds(cfg.window_size_ms),
                Time.milliseconds(cfg.window_slide_ms),
            )
        )
        .process(SepsisWindowFn(), output_type=Types.STRING())
    )

    scored = windowed.key_by(
        lambda s: json.loads(s)["patient_id"], key_type=Types.STRING()
    ).process(SepsisScoringFn(cfg), output_type=Types.STRING())

    # Aggregates → vitals.aggregates
    scored.sink_to(_kafka_sink(cfg, cfg.aggregates_topic)).name("vitals-aggregates-sink")

    # Alerts (side output) → alerts
    scored.get_side_output(ALERT_TAG).sink_to(
        _kafka_sink(cfg, cfg.alerts_topic)
    ).name("sepsis-alerts-sink")


def _kafka_sink(cfg: SepsisConfig, topic: str) -> KafkaSink:
    return (
        KafkaSink.builder()
        .set_bootstrap_servers(cfg.bootstrap_servers)
        .set_record_serializer(
            KafkaRecordSerializationSchema.builder()
            .set_topic(topic)
            .set_value_serialization_schema(SimpleStringSchema())
            .build()
        )
        .build()
    )


def configure_checkpointing(env: StreamExecutionEnvironment, cfg: SepsisConfig) -> None:
    env.enable_checkpointing(cfg.checkpoint_interval_ms, CheckpointingMode.EXACTLY_ONCE)
    checkpoint_cfg = env.get_checkpoint_config()
    checkpoint_cfg.set_checkpoint_storage_dir(cfg.checkpoint_dir)
    checkpoint_cfg.set_checkpoint_timeout(cfg.checkpoint_timeout_ms)
    checkpoint_cfg.set_min_pause_between_checkpoints(5000)
    checkpoint_cfg.set_max_concurrent_checkpoints(1)
    checkpoint_cfg.enable_unaligned_checkpoints()


def main() -> None:
    cfg = get_config()
    env = StreamExecutionEnvironment.get_execution_environment()
    env.set_parallelism(cfg.parallelism)
    configure_checkpointing(env, cfg)
    build_job(env, cfg)
    log.info(
        json.dumps(
            {
                "event": "sepsis_job_start",
                "source": cfg.source_topic,
                "alerts": cfg.alerts_topic,
                "aggregates": cfg.aggregates_topic,
                "threshold": cfg.alert_threshold,
            }
        )
    )
    env.execute("medflow-sepsis-alerting")


if __name__ == "__main__":
    main()
