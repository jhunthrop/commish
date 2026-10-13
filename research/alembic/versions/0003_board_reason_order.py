"""A board's reasons keep the order the board stated them in.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-13

`preseason_board_reasons.ordinal`: each reason's place among its player's reasons in one board
generation, as the board emitted them. The order is a fact the readers depend on: a capsule's
evidence lists the facts in the board's order, groups laws in the order they first appear and sums
each group's effect in that order. The legacy table never stored it; its readers took the heap's
physical order, which is the writer's insertion order only until a page fills and a row lands in
free space elsewhere (two of 683 players on the 2026 PPR board, measured on the dev copy, came back
rotated in the research copy). Rows already here are numbered in the order they lie on disk, the
order every reader has seen so far; the loader carries the legacy table's own physical order
(`research.db.legacy`), and the board writer records the emission index.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA = "research"


def upgrade() -> None:
    op.add_column("preseason_board_reasons", sa.Column("ordinal", sa.Integer(), nullable=True), schema=_SCHEMA)
    op.execute(
        f"UPDATE {_SCHEMA}.preseason_board_reasons AS r SET ordinal = n.ordinal FROM ("
        "SELECT ctid AS row_ctid, row_number() OVER (PARTITION BY season, source, as_of, player_id ORDER BY ctid) - 1 AS ordinal "
        f"FROM {_SCHEMA}.preseason_board_reasons) AS n WHERE r.ctid = n.row_ctid"
    )
    op.alter_column("preseason_board_reasons", "ordinal", nullable=False, schema=_SCHEMA)
    op.create_check_constraint(
        "preseason_board_reasons_ordinal_ck", "preseason_board_reasons", "ordinal >= 0", schema=_SCHEMA
    )


def downgrade() -> None:
    op.drop_constraint("preseason_board_reasons_ordinal_ck", "preseason_board_reasons", schema=_SCHEMA)
    op.drop_column("preseason_board_reasons", "ordinal", schema=_SCHEMA)
