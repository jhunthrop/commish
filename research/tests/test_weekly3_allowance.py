# ruff: noqa: PLR2004 - the expected values are hand-computed numbers, each read beside its case
"""Weekly round 3's opponent allowance (preregistration section 2 item 3): the position group's
total of a kind in D's games of weeks before W, over the same offences' totals in their other
games of weeks before W (never their games against D), shrunk toward 1 with 6 games of prior; the
quarterbacks' pass-attempt version on dropbacks; and the default of 1 with no game."""

from datetime import UTC, datetime
from types import MappingProxyType

import pytest

from research.model.weekly3.allowance import (
    ALLOWANCE_PRIOR_GAMES,
    NO_EXPECTATION,
    NO_GAME,
    allowance,
    group_totals,
)
from research.model.weekly3.instant import Schedule
from research.model.weekly3.work import PlayerGame, Work
from research.pipeline.nflverse.context import _RATING_SHRINKAGE_GAMES

_K = datetime(2023, 10, 22, tzinfo=UTC)


def _game(week: int, club: str, targets: float) -> PlayerGame:
    return PlayerGame(week, club, Work(targets, 0.0, 0.0, 0.5, 0.0), frozenset())


def _schedule(pairs: dict[int, list[tuple[str, str]]]) -> Schedule:
    pairing: dict[tuple[int, str], str] = {}
    for week, games in pairs.items():
        for a, b in games:
            pairing[(week, a)] = b
            pairing[(week, b)] = a
    kickoffs = dict.fromkeys(pairing, _K)
    return Schedule(2023, MappingProxyType(kickoffs), MappingProxyType({}), MappingProxyType(pairing))


# D faced A in week 1 and B in week 2; A also played C in week 2, B played C in week 1; week 3
# (A against D again) is the judged week, so nothing of it may enter.
_PAIRS = {1: [("D", "A"), ("B", "C")], 2: [("D", "B"), ("A", "C")], 3: [("D", "A"), ("B", "C")]}
_POSITIONS = MappingProxyType({"a1": "WR", "a2": "WR", "b1": "WR", "c1": "WR", "d1": "WR", "aq": "QB"})


def _games() -> dict[str, tuple[PlayerGame, ...]]:
    return {
        "a1": (_game(1, "A", 10.0), _game(2, "A", 4.0), _game(3, "A", 99.0)),
        "a2": (_game(1, "A", 2.0), _game(2, "A", 2.0)),
        "b1": (_game(1, "B", 3.0), _game(2, "B", 9.0)),
        "c1": (_game(1, "C", 1.0), _game(2, "C", 1.0)),
        "aq": (_game(1, "A", 0.0),),
    }


def test_the_prior_is_the_context_ingests_own_six_games() -> None:
    assert ALLOWANCE_PRIOR_GAMES == _RATING_SHRINKAGE_GAMES == 6


def test_the_group_total_sums_the_position_by_club_and_week() -> None:
    totals = group_totals(_games(), _POSITIONS)
    assert totals[(1, "A")]["WR"].targets == 12.0
    assert totals[(2, "B")]["WR"].targets == 9.0
    assert "QB" in totals[(1, "A")]


def test_the_allowance_reads_only_weeks_before_w_and_never_the_offences_games_against_d() -> None:
    totals = group_totals(_games(), _POSITIONS)
    found = allowance("D", 3, "WR", "targets", _schedule(_PAIRS), totals, MappingProxyType({}))
    # D allowed A 12 (week 1) and B 9 (week 2). A's other game: week 2 against C, 6 targets. B's
    # other game: week 1 against C, 3 targets. Week 3's 99 is never read.
    ratio = ((12.0 + 9.0) / 2) / ((6.0 + 3.0) / 2)
    assert found.games == 2
    assert found.value == pytest.approx((2 * ratio + 6) / (2 + 6))
    assert found.default is None


def test_an_offence_with_no_other_game_drops_that_game() -> None:
    totals = group_totals(_games(), _POSITIONS)
    pairs = {1: [("D", "A"), ("B", "C")], 2: [("D", "B"), ("A", "C")]}
    # At week 2 D has one game (A, week 1); A's only other game before week 2 is none.
    found = allowance("D", 2, "WR", "targets", _schedule(pairs), totals, MappingProxyType({}))
    assert (found.value, found.games, found.default) == (1.0, 0, NO_GAME)


def test_an_opponent_with_no_game_before_w_takes_the_prior() -> None:
    found = allowance("D", 1, "WR", "targets", _schedule(_PAIRS), group_totals(_games(), _POSITIONS), {})
    assert (found.value, found.games, found.default) == (1.0, 0, NO_GAME)


def test_a_group_that_never_does_the_kind_takes_the_prior() -> None:
    totals = group_totals(_games(), _POSITIONS)
    found = allowance("D", 3, "QB", "targets", _schedule(_PAIRS), totals, MappingProxyType({}))
    assert (found.value, found.default) == (1.0, NO_EXPECTATION)


def test_an_unstamped_game_is_not_counted() -> None:
    games = _games()
    del games["b1"]  # B's rows not yet stamped: D's week-2 game and B's week-1 game drop out
    found = allowance("D", 3, "WR", "targets", _schedule(_PAIRS), group_totals(games, _POSITIONS), {})
    ratio = 12.0 / 6.0
    assert found.games == 1
    assert found.value == pytest.approx((ratio + 6) / 7)


def test_the_quarterbacks_pass_attempts_read_dropbacks_faced_over_dropbacks() -> None:
    rows = {
        ("D", 1): {"defence_dropbacks_faced": 40.0},
        ("D", 2): {"defence_dropbacks_faced": 30.0},
        ("A", 2): {"dropbacks": 35.0},
        ("A", 1): {"dropbacks": 99.0},
        ("B", 1): {"dropbacks": 25.0},
        ("A", 3): {"dropbacks": 77.0},
    }
    found = allowance("D", 3, "QB", "pass_attempts", _schedule(_PAIRS), {}, MappingProxyType(rows))
    ratio = ((40.0 + 30.0) / 2) / ((35.0 + 25.0) / 2)
    assert found.games == 2
    assert found.value == pytest.approx((2 * ratio + 6) / 8)
