"""create vitals table

Revision ID: 0001
Revises:
Create Date: 2026-06-12
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vitals",
        sa.Column("id", sa.BigInteger(), autoincrement=True, primary_key=True),
        sa.Column("patient_id", sa.String(length=64), nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("heart_rate", sa.Float(), nullable=False),
        sa.Column("spo2", sa.Float(), nullable=False),
        sa.Column("resp_rate", sa.Float(), nullable=False),
        sa.Column("temp_c", sa.Float(), nullable=False),
        sa.Column("systolic_bp", sa.Float(), nullable=False),
        sa.Column("diastolic_bp", sa.Float(), nullable=False),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("patient_id", "ts", name="uq_vitals_patient_ts"),
    )
    op.create_index("ix_vitals_patient_ts", "vitals", ["patient_id", "ts"])


def downgrade() -> None:
    op.drop_index("ix_vitals_patient_ts", table_name="vitals")
    op.drop_table("vitals")
