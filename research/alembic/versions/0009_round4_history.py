"""The history the weekly round 4 fits on, and its two benchmarks' tables.

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-16

Lane 66b (`docs/research/2026-10-16-weekly-projection-round4-preregistration.md` §2.9), on Lane 63's
0008 (the coordinator's ruling: Lane 63 merges first):

- `nflverse_pbp_plays`: nflverse's play-by-play, one row per regular-season play, 2016 on.
- `nflverse_depth_chart_weeks`: nflverse's weekly depth charts, the offensive skill positions.
- `game_weather`: the recorded kickoff weather, each value with its source, and the precipitation.
- `tank01_projection_rows`: Tank01's weekly projection parsed per player, the prospective benchmark.
- `player_td_prop_observations`: the anytime-touchdown market, the market benchmark.
"""

from collections.abc import Sequence
from typing import Final

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA: Final = "research"
_TABLES: Final = (
    "player_td_prop_observations",
    "tank01_projection_rows",
    "game_weather",
    "nflverse_depth_chart_weeks",
    "nflverse_pbp_plays",
)


def upgrade() -> None:
    _nflverse_pbp_plays()
    _nflverse_depth_chart_weeks()
    _game_weather()
    _tank01_projection_rows()
    _player_td_prop_observations()


def downgrade() -> None:
    for table in _TABLES:
        op.drop_table(table, schema=_SCHEMA)


def _nflverse_pbp_plays() -> None:
    op.create_table(
        "nflverse_pbp_plays",
        sa.Column("game_id", sa.Text(), nullable=False),
        sa.Column("play_id", sa.Integer(), nullable=False),
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("week", sa.Integer(), nullable=False),
        sa.Column("game_date", sa.Date(), nullable=False),
        sa.Column("as_of", sa.DateTime(timezone=True), nullable=False),
        sa.Column("home_team", sa.Text(), nullable=False),
        sa.Column("away_team", sa.Text(), nullable=False),
        sa.Column("posteam", sa.Text(), nullable=True),
        sa.Column("defteam", sa.Text(), nullable=True),
        sa.Column("qtr", sa.Integer(), nullable=False),
        sa.Column("quarter_seconds_remaining", sa.Integer(), nullable=True),
        sa.Column("half_seconds_remaining", sa.Integer(), nullable=True),
        sa.Column("game_seconds_remaining", sa.Integer(), nullable=True),
        sa.Column("down", sa.Integer(), nullable=True),
        sa.Column("ydstogo", sa.Integer(), nullable=True),
        sa.Column("yardline_100", sa.Integer(), nullable=True),
        sa.Column("goal_to_go", sa.Boolean(), nullable=True),
        sa.Column("fixed_drive", sa.Integer(), nullable=True),
        sa.Column("play_type", sa.Text(), nullable=False),
        sa.Column("pass", sa.Boolean(), nullable=True),
        sa.Column("rush", sa.Boolean(), nullable=True),
        sa.Column("pass_attempt", sa.Boolean(), nullable=True),
        sa.Column("rush_attempt", sa.Boolean(), nullable=True),
        sa.Column("qb_dropback", sa.Boolean(), nullable=True),
        sa.Column("qb_scramble", sa.Boolean(), nullable=True),
        sa.Column("qb_kneel", sa.Boolean(), nullable=True),
        sa.Column("qb_spike", sa.Boolean(), nullable=True),
        sa.Column("sack", sa.Boolean(), nullable=True),
        sa.Column("qb_hit", sa.Boolean(), nullable=True),
        sa.Column("two_point_attempt", sa.Boolean(), nullable=True),
        sa.Column("penalty", sa.Boolean(), nullable=True),
        sa.Column("shotgun", sa.Boolean(), nullable=True),
        sa.Column("no_huddle", sa.Boolean(), nullable=True),
        sa.Column("passer_player_id", sa.Text(), nullable=True),
        sa.Column("rusher_player_id", sa.Text(), nullable=True),
        sa.Column("receiver_player_id", sa.Text(), nullable=True),
        sa.Column("td_player_id", sa.Text(), nullable=True),
        sa.Column("yards_gained", sa.Double(precision=53), nullable=True),
        sa.Column("air_yards", sa.Double(precision=53), nullable=True),
        sa.Column("yards_after_catch", sa.Double(precision=53), nullable=True),
        sa.Column("complete_pass", sa.Boolean(), nullable=True),
        sa.Column("interception", sa.Boolean(), nullable=True),
        sa.Column("fumble_lost", sa.Boolean(), nullable=True),
        sa.Column("touchdown", sa.Boolean(), nullable=True),
        sa.Column("pass_touchdown", sa.Boolean(), nullable=True),
        sa.Column("rush_touchdown", sa.Boolean(), nullable=True),
        sa.Column("pass_location", sa.Text(), nullable=True),
        sa.Column("pass_length", sa.Text(), nullable=True),
        sa.Column("run_location", sa.Text(), nullable=True),
        sa.Column("run_gap", sa.Text(), nullable=True),
        sa.Column("ep", sa.Double(precision=53), nullable=True),
        sa.Column("epa", sa.Double(precision=53), nullable=True),
        sa.Column("wp", sa.Double(precision=53), nullable=True),
        sa.Column("xpass", sa.Double(precision=53), nullable=True),
        sa.Column("weather", sa.Text(), nullable=True),
        sa.Column("roof", sa.Text(), nullable=True),
        sa.Column("surface", sa.Text(), nullable=True),
        sa.Column("temp", sa.Double(precision=53), nullable=True),
        sa.Column("wind", sa.Double(precision=53), nullable=True),
        sa.Column("stadium_id", sa.Text(), nullable=True),
        sa.Column("stadium", sa.Text(), nullable=True),
        sa.Column("ingested_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "play_type IN ('pass', 'run', 'punt', 'field_goal', 'kickoff', 'extra_point', 'qb_kneel', 'qb_spike', 'no_play')",
            name="nflverse_pbp_plays_play_type_ck",
        ),
        sa.PrimaryKeyConstraint("game_id", "play_id"),
        schema=_SCHEMA,
    )
    op.create_index("nflverse_pbp_plays_season_week_idx", "nflverse_pbp_plays", ["season", "week"], schema=_SCHEMA)
    op.create_index(
        "nflverse_pbp_plays_posteam_idx", "nflverse_pbp_plays", ["posteam", "season", "week"], schema=_SCHEMA
    )


def _nflverse_depth_chart_weeks() -> None:
    op.create_table(
        "nflverse_depth_chart_weeks",
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("week", sa.Integer(), nullable=False),
        sa.Column("team", sa.Text(), nullable=False),
        sa.Column("slot", sa.Text(), nullable=False),
        sa.Column("depth_order", sa.Integer(), nullable=False),
        sa.Column("player_id", sa.Text(), nullable=False),
        sa.Column("as_of", sa.DateTime(timezone=True), nullable=False),
        sa.Column("position", sa.Text(), nullable=False),
        sa.Column("ingested_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("depth_order >= 1", name="nflverse_depth_chart_weeks_depth_order_ck"),
        sa.PrimaryKeyConstraint("season", "week", "team", "slot", "depth_order", "player_id", "as_of"),
        schema=_SCHEMA,
    )
    op.create_index(
        "nflverse_depth_chart_weeks_player_idx",
        "nflverse_depth_chart_weeks",
        ["player_id", "season", "week"],
        schema=_SCHEMA,
    )


def _game_weather() -> None:
    op.create_table(
        "game_weather",
        sa.Column("game_id", sa.Text(), nullable=False),
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("week", sa.Integer(), nullable=False),
        sa.Column("home_team", sa.Text(), nullable=False),
        sa.Column("away_team", sa.Text(), nullable=False),
        sa.Column("stadium_id", sa.Text(), nullable=True),
        sa.Column("kickoff_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("roof", sa.Text(), nullable=True),
        sa.Column("temperature_f", sa.Double(precision=53), nullable=True),
        sa.Column("temperature_source", sa.Text(), nullable=True),
        sa.Column("wind_mph", sa.Double(precision=53), nullable=True),
        sa.Column("wind_source", sa.Text(), nullable=True),
        sa.Column("precipitation", sa.Integer(), nullable=True),
        sa.Column("precipitation_source", sa.Text(), nullable=True),
        sa.Column("precipitation_kind", sa.Text(), nullable=True),
        sa.Column("precipitation_mm", sa.Double(precision=53), nullable=True),
        sa.Column("isd_precipitation", sa.Integer(), nullable=True),
        sa.Column("isd_station", sa.Text(), nullable=True),
        sa.Column("isd_distance_km", sa.Double(precision=53), nullable=True),
        sa.Column("isd_precipitation_station", sa.Text(), nullable=True),
        sa.Column("as_of", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ingested_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "precipitation_source IN ('nflverse_games', 'pbp_weather_text', 'noaa_isd')",
            name="game_weather_precipitation_source_ck",
        ),
        sa.CheckConstraint("(wind_mph IS NULL) = (wind_source IS NULL)", name="game_weather_wind_pair_ck"),
        sa.CheckConstraint(
            "wind_source IN ('nflverse_games', 'pbp_weather_text', 'noaa_isd')", name="game_weather_wind_source_ck"
        ),
        sa.CheckConstraint("roof IN ('dome', 'closed', 'open', 'outdoors')", name="game_weather_roof_ck"),
        sa.CheckConstraint(
            "temperature_source IN ('nflverse_games', 'pbp_weather_text', 'noaa_isd')",
            name="game_weather_temperature_source_ck",
        ),
        sa.CheckConstraint("precipitation IN (0, 1)", name="game_weather_precipitation_ck"),
        sa.CheckConstraint("isd_precipitation IN (0, 1)", name="game_weather_isd_precipitation_ck"),
        sa.CheckConstraint(
            "precipitation_kind IN ('rain', 'snow', 'sleet', 'mix')", name="game_weather_precipitation_kind_ck"
        ),
        sa.CheckConstraint(
            "(precipitation IS NULL) = (precipitation_source IS NULL)", name="game_weather_precipitation_pair_ck"
        ),
        sa.CheckConstraint(
            "(temperature_f IS NULL) = (temperature_source IS NULL)", name="game_weather_temperature_pair_ck"
        ),
        sa.PrimaryKeyConstraint("game_id"),
        schema=_SCHEMA,
    )
    op.create_index("game_weather_season_week_idx", "game_weather", ["season", "week"], schema=_SCHEMA)


def _tank01_projection_rows() -> None:
    op.create_table(
        "tank01_projection_rows",
        sa.Column("snapshot_id", sa.BigInteger(), nullable=False),
        sa.Column("provider_player_id", sa.Text(), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("week", sa.Integer(), nullable=False),
        sa.Column("position", sa.Text(), nullable=False),
        sa.Column("team", sa.Text(), nullable=False),
        sa.Column("ppr_points", sa.Double(precision=53), nullable=False),
        sa.Column("half_points", sa.Double(precision=53), nullable=False),
        sa.Column("standard_points", sa.Double(precision=53), nullable=False),
        sa.Column("pass_yards", sa.Double(precision=53), nullable=True),
        sa.Column("pass_touchdowns", sa.Double(precision=53), nullable=True),
        sa.Column("interceptions", sa.Double(precision=53), nullable=True),
        sa.Column("carries", sa.Double(precision=53), nullable=True),
        sa.Column("rush_yards", sa.Double(precision=53), nullable=True),
        sa.Column("rush_touchdowns", sa.Double(precision=53), nullable=True),
        sa.Column("targets", sa.Double(precision=53), nullable=True),
        sa.Column("receptions", sa.Double(precision=53), nullable=True),
        sa.Column("receiving_yards", sa.Double(precision=53), nullable=True),
        sa.Column("receiving_touchdowns", sa.Double(precision=53), nullable=True),
        sa.Column("fumbles_lost", sa.Double(precision=53), nullable=True),
        sa.Column("ingested_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["snapshot_id"],
            ["research.capture_snapshots.id"],
            ondelete="CASCADE",
            name="tank01_projection_rows_snapshot_fk",
        ),
        sa.PrimaryKeyConstraint("snapshot_id", "provider_player_id"),
        schema=_SCHEMA,
    )
    op.create_index(
        "tank01_projection_rows_week_idx", "tank01_projection_rows", ["season", "week", "captured_at"], schema=_SCHEMA
    )


def _player_td_prop_observations() -> None:
    op.create_table(
        "player_td_prop_observations",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("event_id", sa.Text(), nullable=False),
        sa.Column("commence_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("bookmaker", sa.Text(), nullable=False),
        sa.Column("player_name", sa.Text(), nullable=False),
        sa.Column("yes_price", sa.Integer(), nullable=False),
        sa.Column("no_price", sa.Integer(), nullable=True),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema=_SCHEMA,
    )
    op.create_index(
        "player_td_prop_observations_fetched_at_idx", "player_td_prop_observations", ["fetched_at"], schema=_SCHEMA
    )
    op.create_index(
        "player_td_prop_observations_event_idx",
        "player_td_prop_observations",
        ["event_id", "fetched_at"],
        schema=_SCHEMA,
    )
