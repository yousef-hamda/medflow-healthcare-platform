#!/usr/bin/env python3
"""Stream synthetic wearable vitals for 10 patients into MedFlow.

Transport: MQTT (topic ``vitals/{patient_id}``) when paho-mqtt is importable,
otherwise an HTTP fallback that POSTs the same JSON to the wearables-ingester
at ``POST /v1/vitals`` using only stdlib urllib — both paths are implemented
so the simulator works with zero pip installs.

Payload contract (apps/wearables-ingester):
    {patient_id, ts, heart_rate, spo2, resp_rate, temp_c,
     systolic_bp, diastolic_bp}

Cohort: 10 synthetic patients. Eight are stable; two (SEPSIS-01, SEPSIS-02)
follow a deteriorating sepsis trajectory over ~30 minutes — HR 80→130,
RR 14→28, temp 37.0→39.2 °C, SpO2 97→89 — with gaussian noise, which should
trip the Flink sepsis_alerting job's qSOFA-style rules.

Usage:
    python3 scripts/simulators/vitals_stream.py --broker localhost --port 1883
    python3 scripts/simulators/vitals_stream.py --cadence 2 --duration 600
    python3 scripts/simulators/vitals_stream.py --transport http

Ctrl-C at any time prints a per-patient summary and exits cleanly.

All data is synthetic. No real PHI is ever used.
"""
from __future__ import annotations

import argparse
import json
import random
import signal
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional

SEPSIS_RAMP_S = 30 * 60  # trajectory completes over ~30 minutes


class Patient:
    """One synthetic patient with baseline vitals and an optional trajectory."""

    def __init__(self, patient_id: str, label: str, septic: bool) -> None:
        self.patient_id = patient_id
        self.label = label
        self.septic = septic
        self.rng = random.Random(patient_id)
        self.sent = 0
        self.failed = 0
        self.last: Dict[str, float] = {}

    def _ramp(self, start: float, end: float, elapsed: float) -> float:
        """Linear interpolation from start to end across SEPSIS_RAMP_S."""
        frac = min(1.0, max(0.0, elapsed / SEPSIS_RAMP_S))
        return start + (end - start) * frac

    def sample(self, elapsed: float) -> Dict[str, object]:
        g = self.rng.gauss
        if self.septic:
            hr = self._ramp(80, 130, elapsed) + g(0, 3)
            rr = self._ramp(14, 28, elapsed) + g(0, 1.2)
            temp = self._ramp(37.0, 39.2, elapsed) + g(0, 0.1)
            spo2 = self._ramp(97, 89, elapsed) + g(0, 0.7)
            sbp = self._ramp(118, 92, elapsed) + g(0, 4)   # septic hypotension
            dbp = self._ramp(76, 58, elapsed) + g(0, 3)
        else:
            hr = 72 + g(0, 4)
            rr = 14 + g(0, 1)
            temp = 36.8 + g(0, 0.15)
            spo2 = 97.5 + g(0, 0.6)
            sbp = 120 + g(0, 5)
            dbp = 78 + g(0, 4)

        self.last = {"hr": hr, "rr": rr, "temp": temp, "spo2": spo2}
        return {
            "patient_id": self.patient_id,
            "ts": datetime.now(timezone.utc).isoformat(),
            "heart_rate": round(max(30.0, hr), 1),
            "spo2": round(min(100.0, max(70.0, spo2)), 1),
            "resp_rate": round(max(6.0, rr), 1),
            "temp_c": round(temp, 2),
            "systolic_bp": round(max(60.0, sbp), 1),
            "diastolic_bp": round(max(35.0, dbp), 1),
        }


def build_cohort() -> List[Patient]:
    patients = [
        Patient(f"synthea-{uuid.uuid5(uuid.NAMESPACE_URL, f'medflow-vitals-{i}')}",
                f"STABLE-{i:02d}", septic=False)
        for i in range(1, 9)
    ]
    patients += [
        Patient(f"synthea-{uuid.uuid5(uuid.NAMESPACE_URL, 'medflow-vitals-sepsis-1')}",
                "SEPSIS-01", septic=True),
        Patient(f"synthea-{uuid.uuid5(uuid.NAMESPACE_URL, 'medflow-vitals-sepsis-2')}",
                "SEPSIS-02", septic=True),
    ]
    return patients


# ── Transports ────────────────────────────────────────────────────────────────
class MqttTransport:
    name = "mqtt"

    def __init__(self, broker: str, port: int) -> None:
        import paho.mqtt.client as mqtt  # noqa: PLC0415 - optional dependency

        try:
            self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                                      client_id="medflow-vitals-sim")
        except AttributeError:  # paho-mqtt < 2.0
            self.client = mqtt.Client(client_id="medflow-vitals-sim")
        self.client.connect(broker, port, keepalive=30)
        self.client.loop_start()

    def send(self, payload: Dict[str, object]) -> bool:
        topic = f"vitals/{payload['patient_id']}"
        info = self.client.publish(topic, json.dumps(payload), qos=1)
        return info.rc == 0

    def close(self) -> None:
        self.client.loop_stop()
        self.client.disconnect()


class HttpTransport:
    name = "http"

    def __init__(self, url: str) -> None:
        self.url = url

    def send(self, payload: Dict[str, object]) -> bool:
        req = urllib.request.Request(
            self.url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return 200 <= resp.status < 300
        except (urllib.error.URLError, OSError):
            return False

    def close(self) -> None:
        pass


def pick_transport(args: argparse.Namespace):
    if args.transport in ("auto", "mqtt"):
        try:
            transport = MqttTransport(args.broker, args.port)
            print(f"Transport: MQTT {args.broker}:{args.port} (topic vitals/<patient_id>)")
            return transport
        except ImportError:
            if args.transport == "mqtt":
                print("error: paho-mqtt not importable; pip install paho-mqtt "
                      "or use --transport http", file=sys.stderr)
                raise SystemExit(1)
            print("paho-mqtt not importable — falling back to HTTP.", file=sys.stderr)
        except OSError as exc:
            if args.transport == "mqtt":
                print(f"error: MQTT connect failed: {exc}", file=sys.stderr)
                raise SystemExit(1)
            print(f"MQTT connect failed ({exc}) — falling back to HTTP.", file=sys.stderr)
    print(f"Transport: HTTP POST {args.http_url}")
    return HttpTransport(args.http_url)


def main() -> int:
    parser = argparse.ArgumentParser(description="Stream synthetic vitals into MedFlow")
    parser.add_argument("--broker", default="localhost", help="MQTT broker host (default: localhost)")
    parser.add_argument("--port", type=int, default=1883, help="MQTT broker port (default: 1883)")
    parser.add_argument("--cadence", type=float, default=5.0,
                        help="seconds between samples per patient (default: 5)")
    parser.add_argument("--duration", type=float, default=SEPSIS_RAMP_S,
                        help="total run time in seconds (default: 1800 = full sepsis ramp)")
    parser.add_argument("--transport", choices=("auto", "mqtt", "http"), default="auto",
                        help="auto = MQTT if paho-mqtt importable, else HTTP (default: auto)")
    parser.add_argument("--http-url", default="http://localhost:8092/v1/vitals",
                        help="wearables-ingester endpoint for the HTTP fallback")
    args = parser.parse_args()

    patients = build_cohort()
    transport = pick_transport(args)

    print(f"Streaming vitals for {len(patients)} patients "
          f"(2 on a ~{SEPSIS_RAMP_S // 60}min sepsis trajectory), "
          f"cadence={args.cadence}s, duration={args.duration:.0f}s. Ctrl-C to stop.\n")

    interrupted = False

    def handle_sigint(_sig: int, _frame: Optional[object]) -> None:
        nonlocal interrupted
        interrupted = True

    signal.signal(signal.SIGINT, handle_sigint)

    start = time.monotonic()
    ticks = 0
    try:
        while not interrupted:
            elapsed = time.monotonic() - start
            if elapsed >= args.duration:
                break
            for p in patients:
                payload = p.sample(elapsed)
                if transport.send(payload):
                    p.sent += 1
                else:
                    p.failed += 1
            ticks += 1
            if ticks % 12 == 0:  # periodic heartbeat line
                septic = [p for p in patients if p.septic]
                print(f"  t+{elapsed:6.0f}s  sepsis cohort: " + "  ".join(
                    f"{p.label} HR={p.last['hr']:.0f} RR={p.last['rr']:.0f} "
                    f"T={p.last['temp']:.1f} SpO2={p.last['spo2']:.0f}" for p in septic))
            # Sleep in small slices so Ctrl-C is responsive.
            deadline = time.monotonic() + args.cadence
            while not interrupted and time.monotonic() < deadline:
                time.sleep(0.2)
    finally:
        transport.close()

    total_sent = sum(p.sent for p in patients)
    total_failed = sum(p.failed for p in patients)
    print("\n── Vitals stream summary ─────────────────────────────")
    print(f"  transport     : {transport.name}")
    print(f"  elapsed       : {time.monotonic() - start:.0f}s   samples sent: {total_sent}"
          f"   failed: {total_failed}")
    for p in patients:
        tag = "SEPSIS" if p.septic else "stable"
        print(f"  {p.label:<10} [{tag}]  id={p.patient_id}  sent={p.sent} failed={p.failed}")
    return 0 if total_failed == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
