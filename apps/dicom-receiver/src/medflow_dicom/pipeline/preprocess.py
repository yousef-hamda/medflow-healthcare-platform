"""Pixel preprocessing: load with pydicom, resize to 224x224, min-max
normalise, encode as PNG.

Only natively-decodable (uncompressed) transfer syntaxes are supported, which
matches the transfer syntaxes the SCP negotiates. Multi-frame inputs use the
first frame; RGB inputs are converted to greyscale.
"""

from __future__ import annotations

import io
from typing import Any

import numpy as np
from PIL import Image

TARGET_SIZE = (224, 224)


def normalize_to_uint8(arr: "np.ndarray[Any, Any]") -> "np.ndarray[Any, Any]":
    """Min-max normalise an arbitrary numeric array into [0, 255] uint8."""
    data = arr.astype(np.float32)
    lo = float(data.min())
    hi = float(data.max())
    if hi <= lo:
        return np.zeros(data.shape, dtype=np.uint8)
    scaled = (data - lo) / (hi - lo) * 255.0
    return scaled.astype(np.uint8)


def render_preview(ds: Any, size: tuple[int, int] = TARGET_SIZE) -> bytes:
    """Produce PNG bytes (size x size, greyscale) from a pydicom Dataset."""
    arr = np.asarray(ds.pixel_array)
    if arr.ndim == 4:  # multi-frame colour: first frame
        arr = arr[0]
    if arr.ndim == 3 and arr.shape[-1] not in (3, 4):  # multi-frame greyscale
        arr = arr[0]

    # MONOCHROME1 means "min is white"; invert so previews look natural.
    if str(getattr(ds, "PhotometricInterpretation", "")) == "MONOCHROME1":
        arr = arr.max() - arr

    pixels = normalize_to_uint8(arr)
    image = Image.fromarray(pixels)
    if image.mode != "L":
        image = image.convert("L")
    image = image.resize(size, Image.Resampling.LANCZOS)

    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()
