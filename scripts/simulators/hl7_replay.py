#!/usr/bin/env python3
"""Replay HL7v2 messages over MLLP against the MedFlow hl7v2-ingester.

Reads a CSV (columns: offset_seconds, message_type, hl7) where embedded
carriage returns (HL7 segment separators) are escaped as the two-character
literal ``\\r``. Each message is wrapped in MLLP framing
(<VT>message<FS><CR> i.e. \\x0b ... \\x1c\\x0d), sent over TCP, and the ACK
is parsed (MSA-1) to tally AA / AE / AR responses.

Stdlib only (socket, csv, time, argparse) — runs on any Python 3.9+.

Usage:
    python3 scripts/simulators/hl7_replay.py --host localhost --port 2575 \
        --file scripts/simulators/data/hl7_messages.csv --rate 5

Pacing: ``--rate N`` sends N messages/second. ``--rate 0`` honours the
``offset_seconds`` column instead (real-time replay of the recorded timeline).

All data is synthetic. No real PHI is ever used.
"""
from __future__ import annotations

import argparse
import csv
import socket
import sys
import time
from typing import List, Optional, Tuple

MLLP_START = b"\x0b"
MLLP_END = b"\x1c\x0d"
ACK_TIMEOUT_S = 10.0
RECV_CHUNK = 4096


def load_messages(path: str) -> List[Tuple[float, str, str]]:
    """Load (offset_seconds, message_type, hl7) rows; '#' lines are comments."""
    rows: List[Tuple[float, str, str]] = []
    with open(path, newline="", encoding="utf-8") as fh:
        # Filter comment lines before handing to csv so the header comment row
        # documented in the data file does not break parsing.
        reader = csv.DictReader(line for line in fh if not line.startswith("#"))
        for lineno, row in enumerate(reader, start=2):
            try:
                offset = float(row["offset_seconds"])
                msg_type = row["message_type"].strip()
                # Unescape the documented convention: literal "\r" -> CR.
                hl7 = row["hl7"].replace("\\r", "\r").rstrip("\r") + "\r"
            except (KeyError, TypeError, ValueError) as exc:
                print(f"warning: skipping malformed row {lineno}: {exc}", file=sys.stderr)
                continue
            rows.append((offset, msg_type, hl7))
    rows.sort(key=lambda r: r[0])
    return rows


def recv_mllp(sock: socket.socket) -> Optional[bytes]:
    """Read one MLLP-framed message; returns payload without framing."""
    buf = b""
    sock.settimeout(ACK_TIMEOUT_S)
    try:
        while MLLP_END not in buf:
            chunk = sock.recv(RECV_CHUNK)
            if not chunk:
                return None
            buf += chunk
    except socket.timeout:
        return None
    payload = buf.split(MLLP_END, 1)[0]
    return payload.lstrip(MLLP_START.decode().encode())


def parse_ack_code(ack: bytes) -> str:
    """Extract MSA-1 (AA/AE/AR/CA/CE/CR) from an ACK message."""
    try:
        text = ack.decode("utf-8", errors="replace")
        for segment in text.split("\r"):
            if segment.startswith("MSA"):
                fields = segment.split("|")
                if len(fields) > 1 and fields[1]:
                    return fields[1].strip()
    except Exception:  # noqa: BLE001 - any parse failure is just "unknown"
        pass
    return "??"


def control_id(hl7: str) -> str:
    msh = hl7.split("\r", 1)[0].split("|")
    return msh[9] if len(msh) > 9 else "?"


def replay(args: argparse.Namespace) -> int:
    messages = load_messages(args.file)
    if not messages:
        print(f"error: no messages loaded from {args.file}", file=sys.stderr)
        return 1
    print(f"Loaded {len(messages)} HL7 messages from {args.file}")
    print(f"Target {args.host}:{args.port}  rate="
          f"{'offset-driven' if args.rate <= 0 else f'{args.rate} msg/s'}  loop={args.loop}")

    counts = {"AA": 0, "AE": 0, "AR": 0, "other": 0, "no_ack": 0, "send_error": 0}
    pass_num = 0
    try:
        while True:
            pass_num += 1
            start = time.monotonic()
            prev_offset = messages[0][0]
            for idx, (offset, msg_type, hl7) in enumerate(messages, start=1):
                if args.rate > 0:
                    if idx > 1:
                        time.sleep(1.0 / args.rate)
                else:
                    delay = offset - prev_offset
                    prev_offset = offset
                    if delay > 0:
                        time.sleep(delay)
                try:
                    with socket.create_connection((args.host, args.port), timeout=10) as sock:
                        sock.sendall(MLLP_START + hl7.encode("utf-8") + MLLP_END)
                        ack = recv_mllp(sock)
                except OSError as exc:
                    counts["send_error"] += 1
                    print(f"  [{idx:>3}] {msg_type:<8} SEND ERROR: {exc}", file=sys.stderr)
                    continue
                if ack is None:
                    counts["no_ack"] += 1
                    print(f"  [{idx:>3}] {msg_type:<8} ctl={control_id(hl7):<12} NO ACK")
                    continue
                code = parse_ack_code(ack)
                counts[code if code in ("AA", "AE", "AR") else "other"] += 1
                print(f"  [{idx:>3}] {msg_type:<8} ctl={control_id(hl7):<12} ACK={code}")
            elapsed = time.monotonic() - start
            print(f"Pass {pass_num} complete in {elapsed:.1f}s")
            if not args.loop:
                break
    except KeyboardInterrupt:
        print("\nInterrupted.")

    total = sum(counts.values())
    print("\n── ACK summary ────────────────────────────")
    print(f"  sent attempts : {total}")
    for key in ("AA", "AE", "AR", "other", "no_ack", "send_error"):
        print(f"  {key:<13}: {counts[key]}")
    return 0 if counts["AE"] == counts["AR"] == counts["send_error"] == 0 else 2


def main() -> int:
    parser = argparse.ArgumentParser(description="Replay HL7v2 messages over MLLP")
    parser.add_argument("--host", default="localhost", help="MLLP host (default: localhost)")
    parser.add_argument("--port", type=int, default=2575, help="MLLP port (default: 2575)")
    parser.add_argument("--file", default="scripts/simulators/data/hl7_messages.csv",
                        help="CSV file of messages")
    parser.add_argument("--rate", type=float, default=5.0,
                        help="messages/second; 0 = honour offset_seconds column")
    parser.add_argument("--loop", action="store_true", help="replay forever")
    return replay(parser.parse_args())


if __name__ == "__main__":
    raise SystemExit(main())
