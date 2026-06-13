"""Chest X-ray inference: DenseNet121 14-label sigmoid head + Grad-CAM.

Accepts DICOM (``application/dicom`` / ``*.dcm``) or PNG/JPEG uploads.
Research use only - see model card ml/model_cards/chest_xray_14.md.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

import numpy as np

from medflow_serving.api.schemas import XrayFinding
from medflow_serving.fallback.cold_start import NIH_LABELS, xray_rule_findings
from medflow_serving.inference.gradcam import GradCAM, cam_to_png_base64
from medflow_serving.registry.loader import LoadedModel

IMAGE_SIZE = 224
_IMAGENET_MEAN = (0.485, 0.456, 0.406)
_IMAGENET_STD = (0.229, 0.224, 0.225)


def decode_upload(payload: bytes, filename: str | None, content_type: str | None) -> np.ndarray:
    """Decode a DICOM or PNG/JPEG upload to a float32 [H, W] grayscale in [0,1]."""
    is_dicom = (content_type == "application/dicom") or (
        filename is not None and filename.lower().endswith(".dcm")
    )
    if is_dicom or _looks_like_dicom(payload):
        return _decode_dicom(payload)
    return _decode_image(payload)


def _looks_like_dicom(payload: bytes) -> bool:
    return len(payload) > 132 and payload[128:132] == b"DICM"


def _decode_dicom(payload: bytes) -> np.ndarray:
    import pydicom  # noqa: PLC0415

    dataset = pydicom.dcmread(io.BytesIO(payload))
    pixels = dataset.pixel_array.astype(np.float32)
    lo, hi = float(pixels.min()), float(pixels.max())
    if hi > lo:
        pixels = (pixels - lo) / (hi - lo)
    if getattr(dataset, "PhotometricInterpretation", "") == "MONOCHROME1":
        pixels = 1.0 - pixels
    return pixels


def _decode_image(payload: bytes) -> np.ndarray:
    from PIL import Image  # noqa: PLC0415

    img = Image.open(io.BytesIO(payload)).convert("L")
    return np.asarray(img).astype(np.float32) / 255.0


def to_model_tensor(gray: np.ndarray) -> object:
    """Resize to 224x224, replicate to 3 channels, ImageNet-normalize."""
    import torch  # noqa: PLC0415
    from PIL import Image  # noqa: PLC0415

    img = Image.fromarray((gray * 255.0).astype(np.uint8)).resize(
        (IMAGE_SIZE, IMAGE_SIZE), resample=Image.BILINEAR
    )
    arr = np.asarray(img).astype(np.float32) / 255.0
    stacked = np.stack(
        [(arr - m) / s for m, s in zip(_IMAGENET_MEAN, _IMAGENET_STD, strict=True)], axis=0
    )
    return torch.tensor(stacked[None, ...], dtype=torch.float32)


@dataclass(frozen=True)
class XrayResult:
    findings: list[XrayFinding]
    gradcam_png_base64: str
    model_version: str


class XrayEngine:
    def predict(self, payload: bytes, filename: str | None, content_type: str | None, loaded: LoadedModel) -> XrayResult:
        gray = decode_upload(payload, filename, content_type)

        if loaded.model is None:
            findings = [XrayFinding(label=lb, probability=p) for lb, p in xray_rule_findings()]
            # Cold start: a uniform (uninformative) cam over the input image.
            flat_cam = np.zeros((IMAGE_SIZE, IMAGE_SIZE), dtype=np.float32)
            resized = _resize_gray(gray)
            png = cam_to_png_base64(flat_cam, base_image=resized)
            return XrayResult(findings=findings, gradcam_png_base64=png, model_version=loaded.version)

        import torch  # noqa: PLC0415

        tensor = to_model_tensor(gray)
        model = loaded.model
        model.eval()
        with torch.no_grad():
            probs = torch.sigmoid(model(tensor)).reshape(-1).tolist()
        findings = [
            XrayFinding(label=label, probability=float(p))
            for label, p in zip(NIH_LABELS, probs, strict=True)
        ]
        top_index = int(np.argmax(probs))
        cam = GradCAM(model).explain(tensor, top_index)
        png = cam_to_png_base64(cam, base_image=_resize_gray(gray))
        return XrayResult(findings=findings, gradcam_png_base64=png, model_version=loaded.version)


def _resize_gray(gray: np.ndarray) -> np.ndarray:
    from PIL import Image  # noqa: PLC0415

    img = Image.fromarray((gray * 255.0).astype(np.uint8)).resize(
        (IMAGE_SIZE, IMAGE_SIZE), resample=Image.BILINEAR
    )
    return np.asarray(img).astype(np.float32) / 255.0
