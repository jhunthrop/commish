"""`published_boards.game_points`: one more club game at his rate.

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-20

Lane 96 (B25, review H1): a league whose title week is past the run's last week (week 18 against the
run's 17) values that week at the player's points for one more club game, his rate a game times his
expected games of it. The run writes it beside the rest-of-season points; NULL preseason and on a run
older than the column, where the API values the week from the run's points a game.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("published_boards", sa.Column("game_points", sa.Double(53)), schema="research")


def downgrade() -> None:
    op.drop_column("published_boards", "game_points", schema="research")
