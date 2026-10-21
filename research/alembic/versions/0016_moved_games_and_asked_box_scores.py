"""`provider_games.superseded_by` and `capture_snapshots.asked_game_id`.

Revision ID: 0016
Revises: 0015
Create Date: 2026-10-20

Lane 110.
- B77b: the schedule ingest marks a stored game superseded when the provider's week no longer lists its
  id but lists the same two clubs under another id (a date change: the id carries the date). The column
  holds that new id, NULL for a game to play. The API and the research reads of the schedule leave a
  superseded row out.
- B86: the hourly status pass's per-game box score (`tank01_game_box_score`) records the game it asked
  about, so a refused answer that names no game or another game still counts toward that game's re-ask
  cap. NULL on every other source and on the box scores kept before this revision.

Both columns are nullable and declared last, so a reader that predates them is unchanged.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("provider_games", sa.Column("superseded_by", sa.Text()), schema="research")
    op.add_column("capture_snapshots", sa.Column("asked_game_id", sa.Text()), schema="research")


def downgrade() -> None:
    op.drop_column("capture_snapshots", "asked_game_id", schema="research")
    op.drop_column("provider_games", "superseded_by", schema="research")
