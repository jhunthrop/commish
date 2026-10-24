"""Round 5's input-rule guard tests (Lane 168; preregistration section 5, "The guard tests"), each in the round's
suite before the check:

1. R4 5 item 5's tests, carried: the selected `nflverse_kickoff` and `game_weather` metric lists, and a week-W
   `game_result` row refused through each read kind;
2. a week-W stat line, each component a tree targets, refused by the feature reads (the usage and play reads
   the store is built through), and by the anchor and shrinkage reads (`test_weekly5_shrinkage`);
3. the projected-set rule (`test_weekly5_projected`);
4. the shrinkage, residual-band and minor-constant fits refusing a row of 2025 or 2026 or after their window
   (`test_weekly5_shrinkage`, `test_weekly5_bands`, `test_weekly5_components`);
5. the rival's PPR recent form equal to the G2 benchmark's on every row, its half-PPR and standard forms from
   the same function with the format's scoring.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from types import MappingProxyType
from typing import get_args

import pandas as pd
import pytest

from research.model.domain import StatLine
from research.model.reads.observations import SeasonStatLine
from research.model.weekly.round.scoring import FORMATS, form_from_lines, points_by_format
from research.model.weekly2.statistics import JudgedRow
from research.model.weekly3 import ledger
from research.model.weekly3.ledger import InputRuleError, ReadKind
from research.model.weekly3.work import USAGE_ROWS
from research.model.weekly4.features import admitted
from research.model.weekly4.features.admitted import ADMITTED, PLAYS, admit_observations, admit_read
from research.model.weekly4.features.plays import PLAY_COLUMNS
from research.model.weekly5.judgment import form_mismatches
from research.model.weekly5.reads import forms
from research.pipeline.observations import PlayerWeekObservation, TeamWeekObservation

KICKOFF = datetime(2021, 10, 24, 17, 0, tzinfo=UTC)
T_G = KICKOFF - timedelta(milliseconds=1)
KINDS: tuple[ReadKind, ...] = (
    "plays", "charted", "figures", "live_figures", "weather", "depth", "depth_prior", "forecast", "schedule", "box",
    "filings", "prior",
)  # fmt: skip


def test_guard_one_the_kickoff_and_weather_lists_are_as_selected() -> None:
    assert {m for s, m in ADMITTED["figures"]} == {"implied_team_total", "point_spread"}
    assert {s for s, _ in ADMITTED["figures"]} == {"nflverse_kickoff"}
    weather = {m for s, m in ADMITTED["weather"] if s == "game_weather"}
    assert {"temperature_f", "wind_mph", "precipitation", "roof"} <= weather
    for pairs in ADMITTED.values():
        assert ("nflverse_kickoff", "game_result") not in pairs and ("nflverse_kickoff", "points_allowed") not in pairs
    assert set(KINDS) <= set(ADMITTED) <= set(get_args(ReadKind))


@pytest.mark.parametrize("kind", KINDS)
def test_guard_one_a_week_w_game_result_is_refused_through_every_read_kind(kind: ReadKind) -> None:
    """Stamped an hour before t_g, so neither the stamp rule nor (for a week-W kind) the week rule refuses it:
    the allow-list does."""
    row = TeamWeekObservation(2021, 7, "KC", "nflverse_kickoff", "game_result", 1.0, T_G - timedelta(hours=1))
    with pytest.raises(InputRuleError, match="allow-list refuses"):
        admit_observations(kind, [row], 2021, 7, T_G)


@pytest.mark.parametrize("kind", KINDS)
def test_guard_one_holds_with_the_week_and_stamp_rules_switched_off(
    kind: ReadKind, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Lane 156's mutation discipline: with round 3's week and stamp rules off, a week-W `game_result` stamped
    at the kickoff is still refused through every kind, so the guard proves the allow-list itself; and with the
    allow-list off too, the same row is admitted, so the test can fail."""
    monkeypatch.setattr(ledger, "_week_breaks", lambda *args: None)
    monkeypatch.setattr(ledger, "_stamp_breaks", lambda *args: None)
    row = TeamWeekObservation(2021, 7, "KC", "nflverse_kickoff", "game_result", 1.0, KICKOFF)
    with pytest.raises(InputRuleError, match="allow-list refuses"):
        admit_observations(kind, [row], 2021, 7, T_G)
    monkeypatch.setattr(admitted, "refused_pairs", lambda kind, pairs: [])
    assert admit_observations(kind, [row], 2021, 7, T_G).rows == 1


@pytest.mark.parametrize(("source", "metric"), USAGE_ROWS)
def test_guard_two_a_week_w_usage_line_is_refused_by_the_feature_read(source: str, metric: str) -> None:
    row = PlayerWeekObservation(2021, 7, "wr", source, metric, 9.0, T_G - timedelta(hours=1))
    with pytest.raises(InputRuleError):
        admit_observations("box", [row], 2021, 7, T_G)
    earlier = PlayerWeekObservation(2021, 6, "wr", source, metric, 9.0, T_G - timedelta(days=5))
    assert admit_observations("box", [earlier], 2021, 7, T_G).rows == 1


@dataclass(frozen=True, slots=True)
class _Play:
    season: int
    week: int
    as_of: datetime


def test_guard_two_a_week_w_play_is_refused_by_the_play_read() -> None:
    pairs = [(PLAYS, column) for column in PLAY_COLUMNS]
    with pytest.raises(InputRuleError):
        admit_read("plays", pairs, [_Play(2021, 7, T_G - timedelta(hours=1))], 2021, 7, T_G)
    assert admit_read("plays", pairs, [_Play(2021, 6, T_G - timedelta(days=5))], 2021, 7, T_G).rows == 1


@dataclass(frozen=True, slots=True)
class _Board:
    week: int
    form: object


@dataclass(frozen=True, slots=True)
class _Week:
    board: _Board


@dataclass(frozen=True, slots=True)
class _Read:
    season: int
    weeks: tuple[_Week, ...]


def _history() -> list[SeasonStatLine]:
    lines = [
        StatLine("wr", 1, receptions=6, receiving_yards=81, receiving_touchdowns=1, fumbles_lost=1),
        StatLine("wr", 2, receptions=3, receiving_yards=40),
        StatLine("wr", 3, receptions=9, receiving_yards=150),  # week 3's own line: never in week 3's form
    ]
    return [SeasonStatLine(2021, line, KICKOFF) for line in lines]


def test_guard_five_the_rivals_form_is_the_g2_benchmarks_in_every_format() -> None:
    form = form_from_lines(_history(), 2021, 3, {"wr": "WR"})
    read = _Read(2021, (_Week(_Board(3, MappingProxyType(form))),))
    found = forms([read]).set_index("player_id")  # type: ignore[list-item]
    by_hand = [points_by_format(row.line, "WR") for row in _history()[:2]]
    for name in FORMATS:
        assert found.loc["wr", f"form_{name}"] == pytest.approx((by_hand[0][name] + by_hand[1][name]) / 2)
        assert found.loc["wr", f"form_{name}"] == pytest.approx(form["wr"][name])
    row = JudgedRow(3, "wr", "WR", None, None, None, 1.0, form["wr"], dict.fromkeys(FORMATS, 0.0), False)
    assert form_mismatches([row], forms([read]).assign(season=2021), 2021) == 0  # type: ignore[list-item]
    moved = forms([read]).assign(season=2021, form_ppr=1.0)  # type: ignore[list-item]
    assert form_mismatches([row], moved, 2021) == 1


def test_guard_five_counts_a_benchmark_row_the_rival_has_no_form_for() -> None:
    row = JudgedRow(3, "te", "TE", None, None, None, 1.0, {"ppr": 4.0, "half": 3.0, "std": 2.0}, {}, False)
    empty = pd.DataFrame(columns=["season", "week", "player_id", *(f"form_{n}" for n in FORMATS)])
    assert form_mismatches([row], empty, 2021) == 1
