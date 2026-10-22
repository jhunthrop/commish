"""The play table's kick columns.

Revision ID: 0020
Revises: 0019
Create Date: 2026-10-23

Lane 156 (Amendment 7 item 3b of the round 4 preregistration, the weekly kicker and team-defense
sub-round): `nflverse_pbp_plays` gains each kick's distance and result, the two-point try's result, the
kicker, the club a touchdown went to, and the punt-block, return-touchdown, returning-club and safety
flags, every one as nflverse names it and stamped per game as the play table is. Nullable and declared
last, so a reader that predates them is unchanged; the plays stored before this revision hold NULL until
the next ingest of their season fills them (`pipeline/nflverse/pbp_plays.py`, `record_plays`). The three
result columns carry their vocabularies as check constraints.
"""

from collections.abc import Sequence
from typing import Final

import sqlalchemy as sa
from alembic import op

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA: Final = "research"
_TABLE: Final = "nflverse_pbp_plays"
_COLUMNS: Final = (
    ("kick_distance", sa.Integer()),
    ("field_goal_result", sa.Text()),
    ("extra_point_result", sa.Text()),
    ("two_point_conv_result", sa.Text()),
    ("kicker_player_id", sa.Text()),
    ("td_team", sa.Text()),
    ("punt_blocked", sa.Boolean()),
    ("return_touchdown", sa.Boolean()),
    ("return_team", sa.Text()),
    ("safety", sa.Boolean()),
)
_CHECKS: Final = (
    ("nflverse_pbp_plays_field_goal_result_ck", "field_goal_result IN ('made', 'missed', 'blocked')"),
    (
        "nflverse_pbp_plays_extra_point_result_ck",
        "extra_point_result IN ('good', 'failed', 'blocked', 'aborted', 'safety')",
    ),
    (
        "nflverse_pbp_plays_two_point_conv_result_ck",
        "two_point_conv_result IN ('success', 'failure', 'return', 'safety')",
    ),
)


def upgrade() -> None:
    for name, kind in _COLUMNS:
        op.add_column(_TABLE, sa.Column(name, kind, nullable=True), schema=_SCHEMA)
    for name, condition in _CHECKS:
        op.create_check_constraint(name, _TABLE, condition, schema=_SCHEMA)


def downgrade() -> None:
    for name, _ in _CHECKS:
        op.drop_constraint(name, _TABLE, schema=_SCHEMA, type_="check")
    for name, _ in reversed(_COLUMNS):
        op.drop_column(_TABLE, name, schema=_SCHEMA)
