"""Pixel preprocessing tests."""

from __future__ import annotations

import io

import numpy as np
from PIL import Image

from medflow_dicom.pipeline.preprocess import normalize_to_uint8, render_preview
from tests.conftest import make_dataset


def test_normalize_to_uint8_full_range() -> None:
    arr = np.array([[0, 2048], [4095, 1024]], dtype=np.uint16)
    out = normalize_to_uint8(arr)
    assert out.dtype == np.uint8
    assert out.min() == 0
    assert out.max() == 255


def test_normalize_constant_image_is_zero() -> None:
    arr = np.full((4, 4), 777, dtype=np.uint16)
    out = normalize_to_uint8(arr)
    assert out.max() == 0


def test_render_preview_is_224_png() -> None:
    ds = make_dataset()
    png = render_preview(ds)
    image = Image.open(io.BytesIO(png))
    assert image.format == "PNG"
    assert image.size == (224, 224)
    assert image.mode == "L"


def test_render_preview_monochrome1_inverted() -> None:
    ds = make_dataset()
    ds.PhotometricInterpretation = "MONOCHROME1"
    png_inv = render_preview(ds)
    ds.PhotometricInterpretation = "MONOCHROME2"
    png = render_preview(ds)
    assert png_inv != png
