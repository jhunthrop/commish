"""The game's facts for the live week: nflverse's game table, the stadiums and the forecast grid.

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-16

Lane 66a (the round 4 preregistration, sections 2.5 and 2.9): `nflverse_games` holds games.csv
one row per game for 2016 on, the current state only; `nflverse_game_reads` keeps each pass's
read of every game's venue and kickoff, append-only, the as-of source; `stadiums` the venues from
the reviewed Wikidata seed; and `nws_grid_points` the weather service's grid cell per stadium and
season. The game figures and the forecasts themselves are team-week observations (`tank01_lines`,
`nflverse_game_figures`, `nws_forecast`), so they need no table of their own.

The chain is 0007, Lane 63's 0008, Lane 66b's 0009, this.
"""

from collections.abc import Sequence
from datetime import datetime
from typing import Final

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA: Final = "research"


def _now() -> "sa.Column[datetime]":
    return sa.Column("ingested_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False)


def _games() -> None:
    op.create_table(
        "nflverse_games",
        sa.Column("game_id", sa.Text(), nullable=False),
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("game_type", sa.Text(), nullable=False),
        sa.Column("week", sa.Integer(), nullable=False),
        sa.Column("gameday", sa.Date(), nullable=False),
        sa.Column("gametime", sa.Text(), nullable=True),
        sa.Column("kickoff_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("home_team", sa.Text(), nullable=False),
        sa.Column("away_team", sa.Text(), nullable=False),
        sa.Column("location", sa.Text(), nullable=False),
        sa.Column("home_score", sa.Integer(), nullable=True),
        sa.Column("away_score", sa.Integer(), nullable=True),
        sa.Column("result", sa.Integer(), nullable=True),
        sa.Column("spread_line", sa.Double(precision=53), nullable=True),
        sa.Column("total_line", sa.Double(precision=53), nullable=True),
        sa.Column("roof", sa.Text(), nullable=True),
        sa.Column("surface", sa.Text(), nullable=True),
        sa.Column("temp", sa.Double(precision=53), nullable=True),
        sa.Column("wind", sa.Double(precision=53), nullable=True),
        sa.Column("stadium_id", sa.Text(), nullable=False),
        sa.Column("stadium", sa.Text(), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=False),
        _now(),
        sa.PrimaryKeyConstraint("game_id"),
        schema=_SCHEMA,
    )
    op.create_index("nflverse_games_week_idx", "nflverse_games", ["season", "week"], schema=_SCHEMA)
    op.create_index("nflverse_games_kickoff_idx", "nflverse_games", ["kickoff_at"], schema=_SCHEMA)
    op.create_table(
        "nflverse_game_reads",
        sa.Column("game_id", sa.Text(), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("week", sa.Integer(), nullable=False),
        sa.Column("home_team", sa.Text(), nullable=False),
        sa.Column("away_team", sa.Text(), nullable=False),
        sa.Column("kickoff_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("stadium_id", sa.Text(), nullable=False),
        sa.Column("stadium", sa.Text(), nullable=False),
        sa.Column("roof", sa.Text(), nullable=True),
        _now(),
        sa.PrimaryKeyConstraint("game_id", "read_at"),
        schema=_SCHEMA,
    )
    op.create_index(
        "nflverse_game_reads_week_idx", "nflverse_game_reads", ["season", "week", "read_at"], schema=_SCHEMA
    )


def _stadiums() -> None:
    op.create_table(
        "stadiums",
        sa.Column("stadium_id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("clubs", sa.ARRAY(sa.Text()), nullable=False),
        sa.Column("aliases", sa.ARRAY(sa.Text()), nullable=False),
        sa.Column("latitude", sa.Double(precision=53), nullable=False),
        sa.Column("longitude", sa.Double(precision=53), nullable=False),
        sa.Column("roof_type", sa.Text(), nullable=False),
        sa.Column("surface", sa.Text(), nullable=True),
        sa.Column("country", sa.Text(), nullable=False),
        sa.Column("region", sa.Text(), nullable=True),
        sa.Column("time_zone", sa.Text(), nullable=False),
        sa.Column("international", sa.Boolean(), nullable=False),
        sa.Column("wikidata_id", sa.Text(), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=False),
        _now(),
        sa.CheckConstraint("roof_type IN ('outdoors', 'dome', 'retractable')", name="stadiums_roof_type_ck"),
        sa.CheckConstraint(
            "latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180", name="stadiums_coordinates_ck"
        ),
        sa.CheckConstraint("international = (country <> 'US')", name="stadiums_international_ck"),
        sa.CheckConstraint("(region IS NULL) = (country <> 'US')", name="stadiums_region_ck"),
        sa.PrimaryKeyConstraint("stadium_id"),
        schema=_SCHEMA,
    )
    op.create_table(
        "nws_grid_points",
        sa.Column("stadium_id", sa.Text(), nullable=False),
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("office", sa.Text(), nullable=False),
        sa.Column("grid_x", sa.Integer(), nullable=False),
        sa.Column("grid_y", sa.Integer(), nullable=False),
        sa.Column("grid_url", sa.Text(), nullable=False),
        sa.Column("time_zone", sa.Text(), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("stadium_id", "season"),
        schema=_SCHEMA,
    )


def upgrade() -> None:
    _games()
    _stadiums()


def downgrade() -> None:
    op.drop_table("nws_grid_points", schema=_SCHEMA)
    op.drop_table("stadiums", schema=_SCHEMA)
    op.drop_index("nflverse_game_reads_week_idx", "nflverse_game_reads", schema=_SCHEMA)
    op.drop_table("nflverse_game_reads", schema=_SCHEMA)
    op.drop_index("nflverse_games_kickoff_idx", "nflverse_games", schema=_SCHEMA)
    op.drop_index("nflverse_games_week_idx", "nflverse_games", schema=_SCHEMA)
    op.drop_table("nflverse_games", schema=_SCHEMA)
