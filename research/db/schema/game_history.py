"""THE PLAY-LEVEL AND GAME-LEVEL HISTORY the weekly round 4 fits on (revision 0009).

`docs/research/2026-10-16-weekly-projection-round4-preregistration.md` §2.9: the store held the
play-by-play only as team-week and player-week aggregates, the depth chart for week 1 only, and the
recorded weather with holes. These three tables are the history its play, team and share models
read, each written by an idempotent, stamped ingest (`pipeline/nflverse/pbp_plays.py`,
`pipeline/nflverse/depth_chart_weeks.py`, `pipeline/weather/game_weather.py`).

- `nflverse_pbp_plays`: one row per regular-season play of nflverse's `play_by_play_<season>`, the
  columns the expected-points and team models need, stamped per game exactly as the play-by-play
  aggregates are (`as_of`, the game's day plus the publication lag). A play's player ids are gsis
  ids and carry no foreign key: a defender, a lineman or a player outside the universe can be one.
- `nflverse_depth_chart_weeks`: the offensive skill positions of nflverse's weekly depth charts,
  one row per player per chart slot per week and per statement (`as_of`). The weekly files of 2016
  to 2024 carry no publication time, so they are stamped at the in-season pass of their week; the
  dated files (2025 on) carry their own snapshot instant.
- `game_weather`: the recorded kickoff weather of every regular-season game, each value with the
  source it came from (the nflverse game table, the play-by-play's gamebook text, NOAA's
  Integrated Surface Database), and the precipitation the store never held.
"""

from typing import Final

from sqlalchemy import Boolean, CheckConstraint, Column, Date, DateTime, Double, Index, Integer, Table, Text

from research.db.schema._base import METADATA, one_of, recorded_at

PLAY_TYPES: Final = (
    "pass",
    "run",
    "punt",
    "field_goal",
    "kickoff",
    "extra_point",
    "qb_kneel",
    "qb_spike",
    "no_play",
)
WEATHER_SOURCES: Final = ("nflverse_games", "pbp_weather_text", "noaa_isd")
ROOF_STATES: Final = ("dome", "closed", "open", "outdoors")
PRECIPITATION_KINDS: Final = ("rain", "snow", "sleet", "mix")


def _flag(name: str) -> "Column[bool]":
    """nflverse's 0 or 1, NULL where the file says NA."""
    return Column(name, Boolean)


NFLVERSE_PBP_PLAYS: Final = Table(
    "nflverse_pbp_plays",
    METADATA,
    Column("game_id", Text, primary_key=True),
    Column("play_id", Integer, primary_key=True),
    Column("season", Integer, nullable=False),
    Column("week", Integer, nullable=False),
    Column("game_date", Date, nullable=False),
    Column("as_of", DateTime(True), nullable=False),
    Column("home_team", Text, nullable=False),
    Column("away_team", Text, nullable=False),
    Column("posteam", Text),
    Column("defteam", Text),
    Column("qtr", Integer, nullable=False),
    Column("quarter_seconds_remaining", Integer),
    Column("half_seconds_remaining", Integer),
    Column("game_seconds_remaining", Integer),
    Column("down", Integer),
    Column("ydstogo", Integer),
    Column("yardline_100", Integer),
    _flag("goal_to_go"),
    Column("fixed_drive", Integer),
    Column("play_type", Text, nullable=False),
    _flag("pass"),
    _flag("rush"),
    _flag("pass_attempt"),
    _flag("rush_attempt"),
    _flag("qb_dropback"),
    _flag("qb_scramble"),
    _flag("qb_kneel"),
    _flag("qb_spike"),
    _flag("sack"),
    _flag("qb_hit"),
    _flag("two_point_attempt"),
    _flag("penalty"),
    _flag("shotgun"),
    _flag("no_huddle"),
    Column("passer_player_id", Text),
    Column("rusher_player_id", Text),
    Column("receiver_player_id", Text),
    Column("td_player_id", Text),
    Column("yards_gained", Double(53)),
    Column("air_yards", Double(53)),
    Column("yards_after_catch", Double(53)),
    _flag("complete_pass"),
    _flag("interception"),
    _flag("fumble_lost"),
    _flag("touchdown"),
    _flag("pass_touchdown"),
    _flag("rush_touchdown"),
    Column("pass_location", Text),
    Column("pass_length", Text),
    Column("run_location", Text),
    Column("run_gap", Text),
    Column("ep", Double(53)),
    Column("epa", Double(53)),
    Column("wp", Double(53)),
    Column("xpass", Double(53)),
    Column("weather", Text),
    Column("roof", Text),
    Column("surface", Text),
    Column("temp", Double(53)),
    Column("wind", Double(53)),
    Column("stadium_id", Text),
    Column("stadium", Text),
    recorded_at(),
    one_of("play_type", PLAY_TYPES, "nflverse_pbp_plays_play_type_ck"),
    Index("nflverse_pbp_plays_season_week_idx", "season", "week"),
    Index("nflverse_pbp_plays_posteam_idx", "posteam", "season", "week"),
)

NFLVERSE_DEPTH_CHART_WEEKS: Final = Table(
    "nflverse_depth_chart_weeks",
    METADATA,
    Column("season", Integer, primary_key=True),
    Column("week", Integer, primary_key=True),
    Column("team", Text, primary_key=True),
    # The chart's slot (`depth_position` to 2024, `pos_abb` from 2025): LWR and RWR are two slots.
    Column("slot", Text, primary_key=True),
    Column("depth_order", Integer, primary_key=True),
    Column("player_id", Text, primary_key=True),
    Column("as_of", DateTime(True), primary_key=True),
    # The player's own position on the chart's row (QB, RB, FB, WR, TE).
    Column("position", Text, nullable=False),
    recorded_at(),
    CheckConstraint("depth_order >= 1", name="nflverse_depth_chart_weeks_depth_order_ck"),
    Index("nflverse_depth_chart_weeks_player_idx", "player_id", "season", "week"),
)

GAME_WEATHER: Final = Table(
    "game_weather",
    METADATA,
    Column("game_id", Text, primary_key=True),
    Column("season", Integer, nullable=False),
    Column("week", Integer, nullable=False),
    Column("home_team", Text, nullable=False),
    Column("away_team", Text, nullable=False),
    Column("stadium_id", Text),
    Column("kickoff_at", DateTime(True), nullable=False),
    # nflverse's four-valued roof (dome, closed, open, outdoors); NULL where the game table has none.
    Column("roof", Text),
    Column("temperature_f", Double(53)),
    Column("temperature_source", Text),
    Column("wind_mph", Double(53)),
    Column("wind_source", Text),
    # 1 when precipitation fell at kickoff, 0 when none did, NULL when no source says.
    Column("precipitation", Integer),
    Column("precipitation_source", Text),
    # The present condition's word class (rain, snow, sleet, mix) where a source names one.
    Column("precipitation_kind", Text),
    # ISD's one-hour liquid depth in the hour after kickoff, millimetres, and ISD's own 0 or 1 for it,
    # kept beside the chosen flag so the gamebook's word can be checked against the gauge.
    Column("precipitation_mm", Double(53)),
    Column("isd_precipitation", Integer),
    Column("isd_station", Text),
    Column("isd_distance_km", Double(53)),
    # The station ISD's precipitation came from, when the nearest had no one-hour depth for the hour.
    Column("isd_precipitation_station", Text),
    # The recorded weather's stamp: the game's day plus the publication lag, as `nflverse_kickoff`'s.
    Column("as_of", DateTime(True), nullable=False),
    recorded_at(),
    one_of("roof", ROOF_STATES, "game_weather_roof_ck"),
    one_of("temperature_source", WEATHER_SOURCES, "game_weather_temperature_source_ck"),
    one_of("wind_source", WEATHER_SOURCES, "game_weather_wind_source_ck"),
    one_of("precipitation_source", WEATHER_SOURCES, "game_weather_precipitation_source_ck"),
    CheckConstraint("precipitation IN (0, 1)", name="game_weather_precipitation_ck"),
    CheckConstraint("isd_precipitation IN (0, 1)", name="game_weather_isd_precipitation_ck"),
    one_of("precipitation_kind", PRECIPITATION_KINDS, "game_weather_precipitation_kind_ck"),
    CheckConstraint("(temperature_f IS NULL) = (temperature_source IS NULL)", name="game_weather_temperature_pair_ck"),
    CheckConstraint("(wind_mph IS NULL) = (wind_source IS NULL)", name="game_weather_wind_pair_ck"),
    CheckConstraint(
        "(precipitation IS NULL) = (precipitation_source IS NULL)", name="game_weather_precipitation_pair_ck"
    ),
    Index("game_weather_season_week_idx", "season", "week"),
)
