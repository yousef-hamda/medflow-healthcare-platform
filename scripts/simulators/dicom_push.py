#!/usr/bin/env python3
"""Push synthetic chest-X-ray-like DICOMs to the MedFlow dicom-receiver.

Verifies connectivity with a C-ECHO, then C-STOREs ``--count`` programmatically
generated Secondary Capture images (224x224, 8-bit MONOCHROME2). Pixel data is
a radial gradient (bright mediastinum, darker lung fields) plus per-pixel
noise. The stdlib ``random`` module is used by default so the script has no
hard numpy dependency; if numpy is importable it is used instead because
generating 50k pixels vectorised is ~100x faster. Both paths produce the same
kind of image — numpy is purely an optimisation.

Requires: pydicom + pynetdicom (already in apps/dicom-receiver's environment):
    pip install pydicom pynetdicom

Usage:
    python3 scripts/simulators/dicom_push.py --host localhost --port 11112
    python3 scripts/simulators/dicom_push.py --count 10

The receiver's AE title is MEDFLOW (see docker-compose.yml). PatientIDs are
Synthea-style UUIDs so they line up with seed_patients.sh conventions.

All data is synthetic. No real PHI is ever used.
"""
from __future__ import annotations

import argparse
import math
import random
import sys
import uuid
from datetime import datetime
from typing import List, Tuple

try:
    from pydicom.dataset import Dataset, FileMetaDataset
    from pydicom.uid import ExplicitVRLittleEndian, SecondaryCaptureImageStorage, generate_uid
    from pynetdicom import AE, debug_logger  # noqa: F401  (debug_logger kept for --debug)
    from pynetdicom.sop_class import Verification
except ImportError as exc:  # pragma: no cover - import guard
    print(f"error: missing dependency ({exc}).\n"
          "Install with: pip install pydicom pynetdicom", file=sys.stderr)
    sys.exit(1)

ROWS = COLS = 224

# Synthetic patient roster: (family, given, sex, birth date).
SYNTH_PATIENTS: List[Tuple[str, str, str, str]] = [
    ("Zieme", "Kareem", "M", "19581103"),
    ("Schamberger", "Lucile", "F", "19720619"),
    ("Okuneva", "Dario", "M", "19450227"),
]


def make_pixels(seed: int) -> bytes:
    """224x224 uint8 chest-X-ray-ish image: radial gradient + noise.

    Bright central column (mediastinum/spine), darker lateral lung fields,
    bright bottom edge (diaphragm), gaussian-ish noise everywhere.
    """
    rng = random.Random(seed)
    try:
        import numpy as np  # optional fast path — same visual result

        y, x = np.mgrid[0:ROWS, 0:COLS].astype("float32")
        cx = (x - COLS / 2) / (COLS / 2)
        base = 150.0 - 90.0 * np.abs(cx)              # bright centre, dark lungs
        base += 60.0 * (y / ROWS) ** 3                # diaphragm brightening
        noise = np.random.default_rng(seed).normal(0.0, 12.0, size=(ROWS, COLS))
        img = np.clip(base + noise, 0, 255).astype("uint8")
        return img.tobytes()
    except ImportError:
        buf = bytearray(ROWS * COLS)
        for r in range(ROWS):
            row_term = 60.0 * (r / ROWS) ** 3
            for c in range(COLS):
                cx = (c - COLS / 2) / (COLS / 2)
                base = 150.0 - 90.0 * abs(cx) + row_term
                # Box-Muller-free cheap noise: sum of uniforms approximates gaussian.
                noise = (rng.random() + rng.random() + rng.random() - 1.5) * 24.0
                buf[r * COLS + c] = max(0, min(255, int(base + noise)))
        return bytes(buf)


def build_dataset(index: int) -> Dataset:
    """Build one Secondary Capture dataset with a fresh study/series."""
    family, given, sex, birth = SYNTH_PATIENTS[index % len(SYNTH_PATIENTS)]
    now = datetime.now()

    ds = Dataset()
    ds.SOPClassUID = SecondaryCaptureImageStorage
    ds.SOPInstanceUID = generate_uid()
    ds.StudyInstanceUID = generate_uid()
    ds.SeriesInstanceUID = generate_uid()
    ds.Modality = "OT"  # Secondary Capture of a CR-like image
    ds.ConversionType = "SYN"  # synthetic
    ds.StudyDescription = "Synthetic chest X-ray (MedFlow simulator)"
    ds.SeriesDescription = "AP view, programmatically generated"
    ds.StudyDate = now.strftime("%Y%m%d")
    ds.StudyTime = now.strftime("%H%M%S")
    ds.AccessionNumber = f"SYN{now.strftime('%Y%m%d')}{index:04d}"

    # Synthea-style patient identity (UUID PatientID, numbered display name).
    ds.PatientID = f"synthea-{uuid.uuid4()}"
    ds.PatientName = f"{family}{random.randint(100, 999)}^{given}{random.randint(100, 999)}"
    ds.PatientSex = sex
    ds.PatientBirthDate = birth

    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.Rows = ROWS
    ds.Columns = COLS
    ds.BitsAllocated = 8
    ds.BitsStored = 8
    ds.HighBit = 7
    ds.PixelRepresentation = 0
    ds.PixelData = make_pixels(seed=index)

    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = ds.SOPClassUID
    meta.MediaStorageSOPInstanceUID = ds.SOPInstanceUID
    meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds.file_meta = meta
    ds.is_little_endian = True
    ds.is_implicit_VR = False
    return ds


def main() -> int:
    parser = argparse.ArgumentParser(description="C-STORE synthetic chest X-rays to MedFlow")
    parser.add_argument("--host", default="localhost", help="DICOM SCP host (default: localhost)")
    parser.add_argument("--port", type=int, default=11112, help="DICOM SCP port (default: 11112)")
    parser.add_argument("--count", type=int, default=3, help="number of images to send (default: 3)")
    parser.add_argument("--called-aet", default="MEDFLOW", help="called AE title (default: MEDFLOW)")
    parser.add_argument("--calling-aet", default="MEDFLOW_SIM", help="calling AE title")
    parser.add_argument("--debug", action="store_true", help="enable pynetdicom wire logging")
    args = parser.parse_args()

    if args.debug:
        debug_logger()

    ae = AE(ae_title=args.calling_aet)
    ae.add_requested_context(Verification)
    ae.add_requested_context(SecondaryCaptureImageStorage)

    # ── 1. C-ECHO ────────────────────────────────────────────────────────────
    print(f"==> C-ECHO {args.host}:{args.port} (AE {args.called_aet})")
    assoc = ae.associate(args.host, args.port, ae_title=args.called_aet)
    if not assoc.is_established:
        print("error: association rejected/failed — is dicom-receiver up? (make dev)",
              file=sys.stderr)
        return 1
    status = assoc.send_c_echo()
    assoc.release()
    if not status or status.Status != 0x0000:
        print(f"error: C-ECHO failed (status={getattr(status, 'Status', None)})", file=sys.stderr)
        return 1
    print("    C-ECHO OK")

    # ── 2. C-STORE ───────────────────────────────────────────────────────────
    print(f"==> C-STORE {args.count} synthetic Secondary Capture image(s)")
    assoc = ae.associate(args.host, args.port, ae_title=args.called_aet)
    if not assoc.is_established:
        print("error: store association failed", file=sys.stderr)
        return 1

    sent = failed = 0
    try:
        for i in range(args.count):
            ds = build_dataset(i)
            status = assoc.send_c_store(ds)
            ok = bool(status) and status.Status == 0x0000
            sent += int(ok)
            failed += int(not ok)
            print(f"  [{i + 1:>2}/{args.count}] PatientID={ds.PatientID} "
                  f"SOPInstanceUID=...{str(ds.SOPInstanceUID)[-12:]} "
                  f"{'STORED' if ok else f'FAILED (0x{status.Status:04x})' if status else 'NO RESPONSE'}")
    finally:
        assoc.release()

    print(f"\nDone: {sent} stored, {failed} failed "
          f"({math.floor(sent / max(1, args.count) * 100)}% success).")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
