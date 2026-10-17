"""THE STORE'S COLUMNS AND ITS DEFAULTS: one fixed schema per row kind, and every default of the
round 4 preregistration's section 2.10 as an indicator column, so each row says which defaults it
took and the coverage report counts them per season.

Every missing numeric input is NaN with its indicator 1 (2.10: "numpy NaN passed to the tree's native
missing-value handling, plus the named indicator column set to 1"); an explicit value is written only
where 2.10 says so (indoor weather, an allowance of 1, a share of 0 with no game of the kind).
"""

from typing import Final

from research.model.weekly3.allowance import NO_EXPECTATION, NO_GAME
from research.model.weekly3.features import NO_FILING, NO_PRIOR_SEASON, TEAMMATE_NOT_IN_LAST_THREE
from research.model.weekly3.work import NO_SNAP_ROW
from research.model.weekly4.features.charted import CHARTED_FEATURES, missing_indicator
from research.model.weekly4.features.game import (
    FIGURE_FROM_GAME_TABLE,
    NO_FORECAST,
    NO_GAME_FIGURE,
    NO_ROOF_STATE,
    NO_SCHEDULE_ROW,
    NO_STADIUM_ROW,
    NO_WEATHER,
    NO_WEATHER_ROW,
    SURFACE_STOPPED,
)
from research.model.weekly4.features.matchup import (
    CLUB_GAME_WITHOUT_PACE,
    NO_PACE,
    NO_PFR_PRESSURE,
    NO_PRESSURE_GAME,
    ROLE_ALLOWANCES,
)
from research.model.weekly4.features.plays import DEPTH_BUCKETS, SHARE_KINDS
from research.model.weekly4.features.shares import DECAYS

# Stopped features (the lane's brief: a required input absent in a way 2.10 does not cover is stopped,
# counted and named), and the opponent's tempo default beside the club's own.
PASS_RATE_ALLOWED_STOPPED: Final = "defence_pass_rate_allowed_stopped"
OPPONENT_NO_PACE: Final = "opponent_no_pace"
NO_GAME_THIS_SEASON: Final = "no_game_this_season"
NO_DEPTH_ROW: Final = "no_depth_row"
NO_OPPORTUNITY_YET: Final = tuple(f"no_{kind}_yet" for kind in ("targets", "carries"))
RETURNING_WITHOUT_EVIDENCE: Final = "returning_teammate_without_evidence"
RETURNING_WITHOUT_PRE_ABSENCE: Final = "returning_teammate_without_pre_absence_share"

GAME_DEFAULTS: Final = (
    NO_GAME_FIGURE,
    FIGURE_FROM_GAME_TABLE,
    NO_ROOF_STATE,
    NO_WEATHER,
    NO_WEATHER_ROW,
    NO_FORECAST,
    NO_STADIUM_ROW,
    NO_SCHEDULE_ROW,
    NO_PACE,
    CLUB_GAME_WITHOUT_PACE,
    OPPONENT_NO_PACE,
    NO_PRESSURE_GAME,
    NO_PFR_PRESSURE,
    SURFACE_STOPPED,
    PASS_RATE_ALLOWED_STOPPED,
)
PLAYER_DEFAULTS: Final = (
    NO_GAME_THIS_SEASON,
    NO_PRIOR_SEASON,
    NO_DEPTH_ROW,
    NO_FILING,
    NO_SNAP_ROW,
    *NO_OPPORTUNITY_YET,
    TEAMMATE_NOT_IN_LAST_THREE,
    RETURNING_WITHOUT_EVIDENCE,
    RETURNING_WITHOUT_PRE_ABSENCE,
    NO_GAME,
    NO_EXPECTATION,
    *(missing_indicator(name) for name in CHARTED_FEATURES),
)


def default_column(name: str) -> str:
    return f"default_{name}"


def decay_label(decay: float) -> str:
    return "decay_" + f"{decay:g}".replace(".", "_")


SHARE_STATS: Final = ("season", "last_three", *(decay_label(d) for d in DECAYS), "prior")
ROUND_THREE_ALLOWANCES: Final = ("targets", "carries", "red_zone", "pass_attempts")

# (name, kind): kind is one of "int", "float", "str", the Parquet types of `store.py`.
KEY_COLUMNS: Final = (
    ("season", "int"),
    ("week", "int"),
    ("game_id", "str"),
    ("club", "str"),
    ("opponent", "str"),
    ("instant", "str"),
)
GAME_COLUMNS: Final = (
    ("home", "float"),
    ("rest_days", "float"),
    ("division_game", "float"),
    ("implied_points", "float"),
    ("opponent_implied_points", "float"),
    ("spread", "float"),
    ("figure_source", "str"),
    ("roof", "str"),
    ("indoor", "float"),
    ("temperature_f", "float"),
    ("wind_mph", "float"),
    ("precipitation", "float"),
    ("precipitation_probability", "float"),
    ("surface", "float"),
    ("own_pace", "float"),
    ("own_pass_rate_over_expected", "float"),
    ("opponent_pace", "float"),
    ("opponent_pass_rate_over_expected", "float"),
    ("opponent_pass_rate_allowed", "float"),
    ("opponent_sack_rate", "float"),
    ("opponent_hit_rate", "float"),
    ("opponent_pfr_pressure_rate", "float"),
)
PLAYER_COLUMNS: Final = (
    ("player_id", "str"),
    ("position", "str"),
    ("status", "str"),
    ("questionable", "int"),
    ("withheld", "int"),
    ("games_played", "int"),
    ("played_in_last_three", "int"),
    *((f"share_{stat}_{kind}", "float") for stat in SHARE_STATS for kind in SHARE_KINDS),
    ("snap_season", "float"),
    ("snap_last_three", "float"),
    ("snap_trend", "float"),
    ("depth_rank", "float"),
    ("depth_chart_week", "int"),
    ("depth_rank_mapped", "int"),
    *((f"vacated_{kind}", "float") for kind in SHARE_KINDS),
    ("vacating_teammates", "int"),
    *((f"returning_{kind}", "float") for kind in SHARE_KINDS),
    ("returning_teammates", "int"),
    *((f"target_depth_{bucket}", "float") for bucket in DEPTH_BUCKETS),
    ("target_outside", "float"),
    ("target_middle", "float"),
    ("air_yards_per_target", "float"),
    *((name, "float") for name in CHARTED_FEATURES),
    *((f"allowance_{kind}", "float") for kind in ROUND_THREE_ALLOWANCES),
    *((f"allowance_{name}", "float") for name in ROLE_ALLOWANCES),
)
TEAM_OUTCOME_COLUMNS: Final = (
    ("plays", "float"),
    ("dropbacks", "float"),
    ("sacks", "float"),
    ("scrambles", "float"),
    ("designed_rushes", "float"),
    ("team_targets", "float"),
    ("rushing_touchdowns", "float"),
    ("receiving_touchdowns", "float"),
)
PLAYER_SCHEMA: Final = (
    *KEY_COLUMNS,
    *GAME_COLUMNS,
    *PLAYER_COLUMNS,
    *((default_column(d), "int") for d in (*GAME_DEFAULTS, *PLAYER_DEFAULTS)),
)
TEAM_SCHEMA: Final = (
    *KEY_COLUMNS,
    *GAME_COLUMNS,
    *((default_column(d), "int") for d in GAME_DEFAULTS),
    *TEAM_OUTCOME_COLUMNS,
)
PLAY_SCHEMA: Final = (
    ("season", "int"),
    ("week", "int"),
    ("game_id", "str"),
    ("play_id", "int"),
    ("as_of", "str"),
    ("kind", "str"),
    ("player_id", "str"),
    ("posteam", "str"),
    ("defteam", "str"),
    ("down", "float"),
    ("ydstogo", "float"),
    ("yardline_100", "float"),
    ("air_yards", "float"),
    ("pass_location", "str"),
    ("run_location", "str"),
    ("run_gap", "str"),
    ("roof", "str"),
    ("indoor", "float"),
    ("temperature_f", "float"),
    ("wind_mph", "float"),
    ("precipitation", "float"),
    (default_column(NO_WEATHER), "int"),
    ("complete_pass", "float"),
    ("yards_gained", "float"),
    ("touchdown", "float"),
    ("interception", "float"),
    ("sack", "float"),
)
