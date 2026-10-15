# ruff: noqa: PLR2004 - the expected values are the preregistration's numbers and hand-made cases
"""Weekly round 3's input rule and its recording wrapper (preregistration section 2, "The input
rule", and section 5, G5's per-game clause): a week-W row and a row stamped after the instant are
refused, an earlier week's row stamped before it is admitted, the filings are week W's own, and
the clause holds only when every game has its reads and every read kept the rule."""

from datetime import UTC, datetime, timedelta

import pytest

from research.model.reads.stamps import Newest
from research.model.weekly3.ledger import (
    Game,
    InputRuleError,
    Stamp,
    admit,
    per_game_clause,
    stamp_of,
    violation,
)
from research.pipeline.observations import PlayerWeekObservation, PlayerWeekTeam, TeamWeekObservation

_KICKOFF = datetime(2023, 10, 22, 17, 0, tzinfo=UTC)
_T = _KICKOFF - timedelta(milliseconds=1)
_BEFORE = _T - timedelta(days=4)


def _row(week: int, as_of: datetime, season: int = 2023) -> PlayerWeekObservation:
    return PlayerWeekObservation(season, week, "p1", "nflverse_player_week", "targets", 5.0, as_of)


def test_a_row_of_an_earlier_week_stamped_before_the_instant_is_admitted() -> None:
    found = admit([_row(6, _BEFORE), _row(5, _BEFORE - timedelta(days=7))], 2023, 7, _T, "box")
    assert found == Stamp(2023, 7, _T, "box", Newest(2023, 6, _BEFORE), 2)


def test_a_row_from_week_w_is_refused() -> None:
    with pytest.raises(InputRuleError, match="week 7"):
        admit([_row(7, _BEFORE)], 2023, 7, _T, "box")


def test_a_row_stamped_after_the_instant_is_refused() -> None:
    with pytest.raises(InputRuleError, match="after"):
        admit([_row(6, _T + timedelta(milliseconds=1))], 2023, 7, _T, "box")


def test_a_row_stamped_at_the_instant_itself_is_admitted() -> None:
    assert admit([_row(6, _T)], 2023, 7, _T, "box").newest == Newest(2023, 6, _T)


def test_the_filings_are_week_ws_own_and_stamped_by_the_instant() -> None:
    assert admit([_row(7, _BEFORE)], 2023, 7, _T, "filings").newest == Newest(2023, 7, _BEFORE)
    with pytest.raises(InputRuleError):
        admit([_row(6, _BEFORE)], 2023, 7, _T, "filings")
    with pytest.raises(InputRuleError):
        admit([_row(7, _KICKOFF)], 2023, 7, _T, "filings")


def test_the_prior_season_is_an_earlier_season_stamped_by_the_instant() -> None:
    assert admit([_row(20, _BEFORE, 2022)], 2023, 7, _T, "prior").rows == 1
    with pytest.raises(InputRuleError):
        admit([_row(1, _BEFORE, 2023)], 2023, 7, _T, "prior")


def test_every_covered_row_kind_is_read_by_the_wrapper() -> None:
    team = TeamWeekObservation(2023, 6, "KC", "nflverse_pbp", "pass_rate", 0.6, _BEFORE)
    edge = PlayerWeekTeam(2023, 6, "p1", "KC", _BEFORE)
    assert admit([team, edge], 2023, 7, _T, "box").rows == 2
    with pytest.raises(InputRuleError):
        admit([PlayerWeekTeam(2023, 7, "p1", "KC", _BEFORE)], 2023, 7, _T, "box")


def test_a_read_with_no_row_keeps_no_newest_row_and_breaks_no_rule() -> None:
    found = admit([], 2023, 7, _T, "filings")
    assert found.newest is None
    assert violation(found) is None


def test_the_rates_read_is_stamped_from_the_newest_row_it_saw() -> None:
    found = stamp_of(Newest(2023, 6, _BEFORE), 2023, 7, _BEFORE + timedelta(days=1), "rate")
    assert violation(found) is None
    late = Stamp(2023, 7, _BEFORE, "rate", Newest(2023, 6, _T), 1)
    assert violation(late) is not None
    with pytest.raises(InputRuleError):
        stamp_of(Newest(2023, 7, _BEFORE), 2023, 7, _T, "rate")


def _stamps(moment: datetime, rate_moment: datetime | None = None) -> list[Stamp]:
    early = rate_moment or moment
    return [
        Stamp(2023, 7, moment, "box", Newest(2023, 6, _BEFORE), 10),
        Stamp(2023, 7, moment, "filings", Newest(2023, 7, _BEFORE), 3),
        Stamp(2023, 7, early, "rate", Newest(2023, 6, _BEFORE), 10),
        Stamp(2023, 0, early, "prior", Newest(2022, 20, _BEFORE), 10),
    ]


def test_the_per_game_clause_holds_when_every_game_has_its_reads_within_the_rule() -> None:
    games = [Game(2023, 7, "KC", _T)]
    held, detail = per_game_clause(games, _stamps(_T, _T - timedelta(days=3)))
    assert held, detail


def test_the_per_game_clause_fails_for_a_game_missing_a_read() -> None:
    games = [Game(2023, 7, "KC", _T), Game(2023, 7, "BUF", _T + timedelta(hours=3))]
    held, detail = per_game_clause(games, _stamps(_T))
    assert not held
    assert "BUF" in detail


def test_the_per_game_clause_fails_when_the_rate_was_read_after_the_game() -> None:
    held, _ = per_game_clause([Game(2023, 7, "KC", _T)], _stamps(_T, _T + timedelta(hours=1)))
    assert not held


def test_the_per_game_clause_cannot_answer_with_no_game() -> None:
    held, detail = per_game_clause([], _stamps(_T))
    assert not held
    assert "no game" in detail
