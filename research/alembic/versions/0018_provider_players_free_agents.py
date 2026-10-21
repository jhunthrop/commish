"""A free agent has no club: `provider_players.team` may be NULL.

Revision ID: 0018
Revises: 0017
Create Date: 2026-10-21

Lane 123 (B101): the daily player list's read (`research/pipeline/tank01/player_clubs.py`) writes NULL for
a player it lists as a free agent, so no reader names a club he has left. The column keeps its name and
type; only its NOT NULL goes. Every reader that predates this revision reads a club for every row it
read before, until the first list read or the `player-clubs` backfill clears one.
"""

from collections.abc import Sequence
from typing import Final

import sqlalchemy as sa
from alembic import op

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA: Final = "research"


def upgrade() -> None:
    op.alter_column("provider_players", "team", existing_type=sa.Text(), nullable=True, schema=_SCHEMA)


def downgrade() -> None:
    # A free agent's NULL has no club to go back to: the downgrade refuses rather than invent one.
    op.execute(
        "do $$ begin if exists (select 1 from research.provider_players where team is null) then "
        "raise exception 'provider_players holds free agents with no club; run the roster seed first'; "
        "end if; end $$"
    )
    op.alter_column("provider_players", "team", existing_type=sa.Text(), nullable=False, schema=_SCHEMA)
