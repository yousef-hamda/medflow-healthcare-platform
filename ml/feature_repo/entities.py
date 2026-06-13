"""Feast entity definitions for MedFlow (synthetic data only).

The single join key across all feature views is ``patient_id`` (a Synthea
person id; never a real MRN). Point-in-time joins are performed on this entity
plus the feature event timestamp.
"""

from __future__ import annotations

from feast import Entity, ValueType

patient = Entity(
    name="patient",
    join_keys=["patient_id"],
    value_type=ValueType.STRING,
    description="A synthetic patient (Synthea person id). Join key for all views.",
)
