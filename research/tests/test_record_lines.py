"""The record's week lines (Lane 66j): the starters each order called right, the week's published
projection graded on the same players once the freeze keeps it, the season to date, and the sentence
the page prints when a benchmark called the weeks better than our order."""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Final

from research.nightly.reads.record import (
    ALL,
    LEAGUE_TEAMS,
    Week,
    filled_ranks,
    honest_line,
    starters_basis,
    to_date,
    week_lines,
)

# Fourteen quarterbacks: a 12-team league starts twelve, so two finish outside the starters.
_QUARTERBACKS: Final = 14
# Our miss: the two who finished last are among our twelve, in place of the tenth and eleventh.
_MISSED: Final = 2
_TOP: Final = 100.0
# An order that matches all but the shared tail of the finish.
_NEAR_PERFECT: Final = 0.9


@dataclass(frozen=True, slots=True)
class _Stance:
    ours: float
    adp: float | None
    actual: float
    published: float | None = None


def _row(pid: str, position: str, stance: _Stance) -> dict[str, Any]:
    return {
        "player_id": pid,
        "position": position,
        "board_points": stance.ours,
        "adp": stance.adp,
        "actual_points": stance.actual,
        "published_points": stance.published,
    }


def _ours(i: int, *, right: bool) -> float:
    """Our stance on the i-th finisher: his finish when right, else the last two swapped above the
    tenth and eleventh (who drop below every starter)."""
    finish = _TOP - i
    if right:
        return finish
    swapped = LEAGUE_TEAMS - _MISSED
    if i >= LEAGUE_TEAMS:
        return _TOP - (i - LEAGUE_TEAMS + swapped)
    if i >= swapped:
        return -float(i)
    return finish


def _quarterbacks(*, ours_right: bool, published: bool) -> list[Mapping[str, Any]]:
    """ADP always calls the twelve starters right; the published projection, when listed, matches the finish."""
    return [
        _row(
            f"q{i}",
            "QB",
            _Stance(_ours(i, right=ours_right), float(i + 1), _TOP - i, _TOP - i if published else None),
        )
        for i in range(_QUARTERBACKS)
    ]


def _line(lines: tuple[Any, ...], position: str) -> Any:
    return next(line for line in lines if line.position == position)


def test_starters_right_counts_the_order_top_n_against_the_finish() -> None:
    lines = week_lines(_quarterbacks(ours_right=False, published=False))
    qb = _line(lines, "QB")
    assert qb.ours.starters_of == LEAGUE_TEAMS
    assert qb.adp.starters == LEAGUE_TEAMS
    assert qb.ours.starters == LEAGUE_TEAMS - _MISSED
    assert qb.published is None
    assert _line(lines, ALL).ours.starters == qb.ours.starters


def test_published_is_graded_on_the_same_rows_under_the_fill_rule() -> None:
    """A week where the published projection lacks players (review 66j H3): it is graded on every row
    ours and ADP are, the rows it lacks ranked below every row it has, sharing their average rank."""
    rows = _quarterbacks(ours_right=True, published=True)
    lacking = 3
    for i in range(1, lacking + 1):
        rows[-i] = {**rows[-i], "published_points": None}
    qb = _line(week_lines(rows), "QB")
    assert qb.published is not None
    assert qb.published.graded == qb.ours.graded == qb.adp.graded == _QUARTERBACKS
    listed = _QUARTERBACKS - lacking
    shared = (listed + 1 + _QUARTERBACKS) / 2
    ranks = filled_ranks([(r["player_id"], r["published_points"], r["actual_points"], "QB") for r in rows])
    assert [ranks[r["player_id"]] for r in rows[listed:]] == [shared] * lacking
    assert sorted(ranks[r["player_id"]] for r in rows[:listed]) == list(range(1, listed + 1))
    # The rows it lacks are the week's last three finishers, so the fill costs it nothing here.
    assert qb.published.places_off is not None
    assert qb.published.agreement is not None
    assert qb.published.agreement > _NEAR_PERFECT


def test_a_published_projection_listing_few_players_is_not_favoured() -> None:
    """Like with like (review 66j H3): listing only the top four of fourteen does not make the published
    projection's places off look better than a full order that is just as right."""
    rows = _quarterbacks(ours_right=True, published=True)
    top = 4
    rows = [row if i < top else {**row, "published_points": None} for i, row in enumerate(rows)]
    qb = _line(week_lines(rows), "QB")
    assert qb.published is not None
    assert qb.published.places_off is not None
    assert qb.ours.places_off is not None
    assert qb.published.places_off >= qb.ours.places_off
    weeks = [Week(1, "graded", None, None, None, _QUARTERBACKS, week_lines(rows), "preseason")]
    sentence = honest_line(to_date(weeks, {1: rows})) or ""
    assert "The published projection put a typical player closer" not in sentence


def test_the_starters_basis_names_only_the_positions_graded() -> None:
    """Review 66j M8: no kickers or defenses in the sentence when the register grades none."""
    rows = _quarterbacks(ours_right=True, published=False)
    weeks = [Week(1, "graded", None, None, None, _QUARTERBACKS, week_lines(rows), "preseason")]
    said = starters_basis(to_date(weeks, {1: rows}))
    assert said == (
        "Starters right counts the week's top 12 QBs, a 12-team league's starters, that the order also put there."
    )
    assert starters_basis(()) is None


def test_to_date_sums_starters_and_pools_published_only_where_graded() -> None:
    first = _quarterbacks(ours_right=False, published=False)
    second = _quarterbacks(ours_right=True, published=True)
    weeks = [
        Week(1, "graded", None, None, None, _QUARTERBACKS, week_lines(first)),
        Week(2, "graded", None, None, None, _QUARTERBACKS, week_lines(second)),
    ]
    total = _line(to_date(weeks, {1: first, 2: second}), ALL)
    assert total.ours.starters == 2 * LEAGUE_TEAMS - _MISSED
    assert total.ours.starters_of == 2 * LEAGUE_TEAMS
    assert total.published is not None
    assert total.published.starters_of == LEAGUE_TEAMS


def test_honest_line_names_each_benchmark_ahead_of_ours() -> None:
    rows = _quarterbacks(ours_right=False, published=True)
    weeks = [Week(1, "graded", None, None, None, _QUARTERBACKS, week_lines(rows))]
    sentence = honest_line(to_date(weeks, {1: rows}))
    assert sentence is not None
    assert "ADP had more of the week's starters right, 12 of 12 against our 10." in sentence
    assert "The published projection" in sentence
    words = set(re.findall(r"[a-z']+", sentence.lower()))
    assert not words & {"odds", "line", "spread", "bet", "market", "favoured", "underdog"}
    assert ";" not in sentence
    assert "—" not in sentence


def test_honest_line_is_none_when_ours_leads_everywhere() -> None:
    receivers = 40
    rows = [_row(f"w{i}", "WR", _Stance(_TOP - i, float(receivers - i), _TOP - i)) for i in range(receivers)]
    weeks = [Week(1, "graded", None, None, None, receivers, week_lines(rows))]
    assert honest_line(to_date(weeks, {1: rows})) is None
