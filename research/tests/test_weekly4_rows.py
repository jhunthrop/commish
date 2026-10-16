"""One row of the store (round 4 preregistration, section 2.10): its columns are the schema's, every
default it took is an indicator set to 1, an absent input is NaN, and a player with no game this
season, no filing, no chart row and no prior season says so."""

import math
from datetime import UTC, datetime

import pytest

from research.model.weekly4.features.columns import (
    PLAYER_SCHEMA,
    TEAM_OUTCOME_COLUMNS,
    TEAM_SCHEMA,
    default_column,
)
from research.model.weekly4.features.game import Figures, Venue, Weather
from research.model.weekly4.features.matchup import DefencePressure, Tempo
from research.model.weekly4.features.plays import ZERO_COUNTS
from research.model.weekly4.features.rows import ClubGame, PlayerInputs, game_row, indicators, player_row
from research.model.weekly4.features.teammates import Returning, Vacated

_T = datetime(2023, 10, 22, 16, 59, 59, 999000, tzinfo=UTC)


def _game() -> ClubGame:
    nan = math.nan
    return ClubGame(
        2023,
        7,
        "2023_07_LAC_KC",
        "KC",
        "LAC",
        _T,
        Figures(nan, nan, nan, None, frozenset({"no_game_figure"})),
        Weather("dome", 1.0, 70.0, 0.0, 0.0, 0.0, frozenset()),
        Venue(1.0, 7.0, 1.0, 1.0, frozenset({"surface_stopped"})),
        Tempo(28.0, 1.0, 6, frozenset()),
        Tempo(nan, nan, 0, frozenset({"no_pace"})),
        DefencePressure(0.07, 0.15, nan, frozenset({"defence_without_a_pfr_pressure_row"})),
    )


def _rookie() -> PlayerInputs:
    return PlayerInputs(
        "rookie",
        "WR",
        None,
        (),
        (),
        frozenset(),
        {},
        (),
        None,
        7,
        (4, 5, 6),
        Vacated(ZERO_COUNTS, 0, 0),
        Returning(ZERO_COUNTS, 0, 0, 0),
        {},
        {},
    )


def test_a_team_row_is_the_schemas_and_marks_its_game_defaults() -> None:
    row = game_row(_game())
    assert set(row) == {n for n, _ in TEAM_SCHEMA} - {n for n, _ in TEAM_OUTCOME_COLUMNS}
    assert row[default_column("no_game_figure")] == 1
    assert row[default_column("opponent_no_pace")] == 1
    assert row[default_column("defence_pass_rate_allowed_stopped")] == 1
    assert row[default_column("no_weather")] == 0
    assert math.isnan(float(str(row["spread"])))


def test_a_player_with_nothing_yet_says_each_default_and_reads_nan() -> None:
    row = player_row(_game(), _rookie())
    assert set(row) == {n for n, _ in PLAYER_SCHEMA}
    for name in ("no_game_this_season", "no_prior_season", "no_depth_row", "no_filing", "no_targets_yet"):
        assert row[default_column(name)] == 1, name
    assert row["status"] == "clear"
    assert math.isnan(float(str(row["share_season_targets"]))) and math.isnan(float(str(row["depth_rank"])))
    assert row["allowance_targets"] == 1.0


def test_a_default_without_its_indicator_column_is_refused() -> None:
    with pytest.raises(ValueError, match="no indicator column"):
        indicators({"made_up_default"}, ("no_weather",))
