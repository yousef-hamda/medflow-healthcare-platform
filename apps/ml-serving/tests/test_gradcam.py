"""Grad-CAM core math on mocked activations/gradients (no torch model)."""

from __future__ import annotations

import numpy as np
import pytest

from medflow_serving.inference.gradcam import compute_cam, upsample_cam


def test_cam_shape_drops_channel_axis() -> None:
    activations = np.random.default_rng(0).random((1024, 7, 7)).astype(np.float32)
    gradients = np.random.default_rng(1).random((1024, 7, 7)).astype(np.float32)
    cam = compute_cam(activations, gradients)
    assert cam.shape == (7, 7)


def test_cam_is_normalized_to_unit_interval() -> None:
    rng = np.random.default_rng(7)
    cam = compute_cam(rng.normal(size=(8, 5, 5)), rng.normal(size=(8, 5, 5)))
    assert float(cam.min()) >= 0.0
    assert float(cam.max()) <= 1.0


def test_cam_weighted_sum_math() -> None:
    # 2 channels, 1x1 spatial: cam = relu(w0*a0 + w1*a1), weights = grad means.
    activations = np.array([[[2.0]], [[3.0]]])
    gradients = np.array([[[0.5]], [[-1.0]]])
    cam = compute_cam(activations, gradients)
    # raw = 0.5*2 + (-1)*3 = -2 -> relu -> 0 -> degenerate range -> zeros
    assert cam.shape == (1, 1)
    assert cam[0, 0] == 0.0


def test_cam_constant_map_returns_zeros_not_nan() -> None:
    activations = np.ones((4, 3, 3))
    gradients = np.ones((4, 3, 3))
    cam = compute_cam(activations, gradients)
    assert not np.isnan(cam).any()
    assert (cam == 0.0).all()


def test_shape_mismatch_raises() -> None:
    with pytest.raises(ValueError, match="must match"):
        compute_cam(np.ones((4, 7, 7)), np.ones((4, 7, 6)))


def test_non_3d_input_raises() -> None:
    with pytest.raises(ValueError, match="expected"):
        compute_cam(np.ones((7, 7)), np.ones((7, 7)))


def test_upsample_to_input_resolution() -> None:
    cam = np.random.default_rng(3).random((7, 7)).astype(np.float32)
    big = upsample_cam(cam, (224, 224))
    assert big.shape == (224, 224)
    assert float(big.min()) >= 0.0
    assert float(big.max()) <= 1.0
