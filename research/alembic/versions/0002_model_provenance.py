"""Model provenance: which model made each board and in which arithmetic; which model each register
row quotes; which implementation graded.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-12

`preseason_projections` gains `model_version` and `arithmetic` (NULL only on a legacy board nothing
has rebuilt). `register_freeze_rows` gains `model_version`, and `register_grade_rows` gains
`implementation` and `model_version`, both required. Rows already in the schema (the loader's copy)
are backfilled from `research.db.provenance`, which names how each fact is known; a register row
whose board it does not name fails the upgrade rather than landing without a model.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from research.db.provenance import board_model_sql

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA = "research"


def upgrade() -> None:
    op.add_column("preseason_projections", sa.Column("model_version", sa.Text(), nullable=True), schema=_SCHEMA)
    op.add_column("preseason_projections", sa.Column("arithmetic", sa.Text(), nullable=True), schema=_SCHEMA)
    op.execute(
        f"UPDATE {_SCHEMA}.preseason_projections SET model_version = {board_model_sql('source', 'as_of', 'model_version')}, "
        f"arithmetic = {board_model_sql('source', 'as_of', 'arithmetic')}"
    )
    op.add_column("register_freeze_rows", sa.Column("model_version", sa.Text(), nullable=True), schema=_SCHEMA)
    op.execute(
        f"UPDATE {_SCHEMA}.register_freeze_rows SET model_version = {board_model_sql('board_source', 'board_as_of', 'model_version')}"
    )
    op.alter_column("register_freeze_rows", "model_version", nullable=False, schema=_SCHEMA)
    op.add_column("register_grade_rows", sa.Column("implementation", sa.Text(), nullable=True), schema=_SCHEMA)
    op.add_column("register_grade_rows", sa.Column("model_version", sa.Text(), nullable=True), schema=_SCHEMA)
    op.execute(
        f"UPDATE {_SCHEMA}.register_grade_rows AS g SET implementation = 'typescript', model_version = ("
        f"SELECT f.model_version FROM {_SCHEMA}.register_freeze_rows AS f WHERE f.season = g.season AND f.week = g.week "
        "AND f.frozen_at = g.frozen_at AND f.board_source = g.board_source AND f.player_id = g.player_id)"
    )
    op.alter_column("register_grade_rows", "implementation", nullable=False, schema=_SCHEMA)
    op.alter_column("register_grade_rows", "model_version", nullable=False, schema=_SCHEMA)
    op.create_check_constraint(
        "register_grade_rows_implementation_ck",
        "register_grade_rows",
        "implementation IN ('typescript', 'python')",
        schema=_SCHEMA,
    )


def downgrade() -> None:
    op.drop_constraint("register_grade_rows_implementation_ck", "register_grade_rows", schema=_SCHEMA)
    for table, column in (
        ("register_grade_rows", "model_version"),
        ("register_grade_rows", "implementation"),
        ("register_freeze_rows", "model_version"),
        ("preseason_projections", "arithmetic"),
        ("preseason_projections", "model_version"),
    ):
        op.drop_column(table, column, schema=_SCHEMA)
