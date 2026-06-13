"""Grad-CAM (Selvaraju et al., 2017) for DenseNet121 chest X-ray models.

The pure shape/array math (:func:`compute_cam`) is separated from the torch
hook plumbing (:class:`GradCAM`) so the math is unit-testable with plain
numpy arrays and a mocked model.

For DenseNet121 we hook ``features.denseblock4`` (the last dense block),
whose activation map is [C=1024, H=7, W=7] for a 224x224 input.
"""

from __future__ import annotations

import base64
import io
from typing import Any

import numpy as np


def compute_cam(activations: np.ndarray, gradients: np.ndarray) -> np.ndarray:
    """Core Grad-CAM math on raw arrays.

    Parameters
    ----------
    activations:
        Feature maps ``A`` of shape ``[C, H, W]`` from the target layer.
    gradients:
        ``dY_c/dA`` of identical shape ``[C, H, W]``.

    Returns
    -------
    ``[H, W]`` heat map: ReLU of the channel-weighted activation sum, where
    channel weights are the spatially global-average-pooled gradients,
    min-max normalized to [0, 1].
    """
    if activations.shape != gradients.shape:
        raise ValueError(
            f"activations {activations.shape} and gradients {gradients.shape} must match"
        )
    if activations.ndim != 3:
        raise ValueError(f"expected [C, H, W], got shape {activations.shape}")

    weights = gradients.mean(axis=(1, 2))  # [C] - global average pooling
    cam = np.tensordot(weights, activations, axes=([0], [0]))  # [H, W]
    cam = np.maximum(cam, 0.0)
    cam_range = cam.max() - cam.min()
    if cam_range > 0:
        cam = (cam - cam.min()) / cam_range
    else:
        cam = np.zeros_like(cam)
    return cam


def upsample_cam(cam: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    """Bilinear-resize the [H, W] cam to ``size`` (height, width) via PIL."""
    from PIL import Image  # noqa: PLC0415

    img = Image.fromarray((cam * 255.0).astype(np.uint8))
    resized = img.resize((size[1], size[0]), resample=Image.BILINEAR)
    return np.asarray(resized).astype(np.float32) / 255.0


def cam_to_png_base64(cam: np.ndarray, base_image: np.ndarray | None = None) -> str:
    """Render the cam (optionally blended over the grayscale input) as PNG b64."""
    from PIL import Image  # noqa: PLC0415

    heat = np.stack(
        [
            (cam * 255.0).astype(np.uint8),  # R
            np.zeros_like(cam, dtype=np.uint8),  # G
            ((1.0 - cam) * 160.0).astype(np.uint8),  # B
        ],
        axis=-1,
    )
    if base_image is not None:
        gray = np.repeat(base_image[..., None], 3, axis=-1)
        blended = (0.5 * gray * 255.0 + 0.5 * heat).clip(0, 255).astype(np.uint8)
    else:
        blended = heat
    buf = io.BytesIO()
    Image.fromarray(blended).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


class GradCAM:
    """Forward/backward hook wrapper around a torch DenseNet121.

    ``target_layer`` defaults to the last dense block. Use as::

        cam = GradCAM(model).explain(tensor_1x3x224x224, class_index)
    """

    def __init__(self, model: Any, target_layer: Any | None = None) -> None:
        self._model = model
        self._activations: Any = None
        self._gradients: Any = None
        layer = target_layer if target_layer is not None else model.features.denseblock4
        layer.register_forward_hook(self._save_activation)
        layer.register_full_backward_hook(self._save_gradient)

    def _save_activation(self, _module: Any, _inputs: Any, output: Any) -> None:
        self._activations = output.detach()

    def _save_gradient(self, _module: Any, _grad_in: Any, grad_out: Any) -> None:
        self._gradients = grad_out[0].detach()

    def explain(self, image_tensor: Any, class_index: int) -> np.ndarray:
        """Return the [H, W] cam (input resolution) for ``class_index``."""
        import torch  # noqa: PLC0415

        self._model.eval()
        self._model.zero_grad()
        logits = self._model(image_tensor)
        score = logits[0, class_index]
        score.backward()

        activations = self._activations[0].cpu().numpy()
        gradients = self._gradients[0].cpu().numpy()
        cam = compute_cam(activations, gradients)
        height, width = int(image_tensor.shape[-2]), int(image_tensor.shape[-1])
        with torch.no_grad():
            return upsample_cam(cam, (height, width))
