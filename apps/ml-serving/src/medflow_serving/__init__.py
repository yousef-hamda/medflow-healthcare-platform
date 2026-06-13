"""MedFlow ML serving layer.

Multi-model FastAPI service for clinical risk prediction. All models are
trained exclusively on synthetic data (Synthea, NIH ChestX-ray14); this
service never handles real PHI in development.
"""

from __future__ import annotations

__version__ = "0.1.0"
