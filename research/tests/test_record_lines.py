"""The record's week lines (Lane 66j): the starters each order called right, the week's published
projection graded on the same players once the freeze keeps it, the season to date, and the sentence
the page prints when a benchmark called the weeks better than our order."""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

from research.nightly.reads.record import (
    AGREEMENT_PLACES,
    ALL,
    LEAGUE_TEAMS,
    RECORD_POSITIONS,
    SCALE,
    Line,
    Score,
    Week,
    filled_ranks,
    honest_line,
    method,
    printed,
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
    assert said == ("Starters right counts the week's top 12 QBs it also put there.")
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


def test_a_figure_is_rounded_once_half_away_from_zero_on_its_decimal_value() -> None:
    """Lane 66k's ruling: 9.45 prints 9.5 and 0.485 prints 0.49, whatever their binary form."""
    cases = ((9.45, 1, "9.5"), (0.485, 2, "0.49"), (-0.485, 2, "-0.49"))
    for value, places, said in cases:
        assert repr(printed(value, places)) == said
    assert printed(None, 1) is None


def _two_weeks(first: list[Mapping[str, Any]], second: list[Mapping[str, Any]]) -> Any:
    weeks = [
        Week(1, "graded", None, None, None, _QUARTERBACKS, week_lines(first), "preseason"),
        Week(2, "graded", None, None, None, _QUARTERBACKS, week_lines(second), "preseason"),
    ]
    return to_date(weeks, {1: first, 2: second})


def test_to_date_compares_ours_with_published_over_the_weeks_that_graded_it() -> None:
    """Review 66j N1: from the first week the register keeps the published projection, the season to
    date sets it against ours on those weeks only. Ours trails on the shared week alone here."""
    first = _quarterbacks(ours_right=True, published=False)
    second = _quarterbacks(ours_right=False, published=True)
    lines = _two_weeks(first, second)
    total = _line(lines, ALL)
    shared = _line(week_lines(second), ALL)
    assert total.ours_on_published == shared.ours
    assert total.ours.starters_of == 2 * LEAGUE_TEAMS
    sentence = honest_line(lines) or ""
    its = printed(shared.published.agreement, 2)
    mine = printed(shared.ours.agreement, 2)
    assert f"The published projection's order matched the finish better, {its:.2f} against our {mine:.2f}." in sentence
    assert f"{shared.published.starters} of {LEAGUE_TEAMS} against our {shared.ours.starters}." in sentence


def test_to_date_names_no_published_lead_that_only_other_weeks_made() -> None:
    """Review 66j N1: ours missed in a week the published projection was not graded and matched it in
    the week it was, so the sentence names no published lead."""
    first = _quarterbacks(ours_right=False, published=False)
    second = _quarterbacks(ours_right=True, published=True)
    lines = _two_weeks(first, second)
    assert _line(lines, ALL).ours_on_published == _line(week_lines(second), ALL).ours
    assert "The published projection" not in (honest_line(lines) or "")


def test_a_week_line_carries_no_separate_ours_for_published() -> None:
    """Within a week published is graded on the same rows as ours, so only the season to date needs it."""
    assert _line(week_lines(_quarterbacks(ours_right=True, published=True)), ALL).ours_on_published is None


def test_published_starters_right_counts_only_the_players_it_listed() -> None:
    """Review 66j N5: listing the top four of fourteen quarterbacks is four starters right, never more
    from unlisted players filling its top twelve."""
    top = 4
    rows = [
        row if i < top else {**row, "published_points": None}
        for i, row in enumerate(_quarterbacks(ours_right=True, published=True))
    ]
    qb = _line(week_lines(rows), "QB")
    assert qb.published is not None
    assert qb.published.starters == top
    assert qb.published.starters_of == LEAGUE_TEAMS


def test_the_scale_prints_its_ends_as_the_page_prints_the_rate() -> None:
    """Ruling R2: order matched prints two decimals, so the sentence that says its scale names its ends
    in that form, 1.00 and 0.00, never 1.0 and 0 (Lane 78)."""
    ends = re.findall(r"-?\d+(?:\.\d+)?", SCALE)
    assert ends == [f"{1:.{AGREEMENT_PLACES}f}", f"{0:.{AGREEMENT_PLACES}f}"], SCALE
    assert SCALE == "1.00 is a perfect match of the week's finishing order, 0.00 is none."


def test_the_method_names_only_the_orders_the_record_draws() -> None:
    """Lane 82, the honest empty state: Published is named once a graded week carries it, never before."""
    before = _quarterbacks(ours_right=True, published=False)
    weeks = [Week(1, "graded", None, None, None, _QUARTERBACKS, week_lines(before), "preseason")]
    assert method(to_date(weeks, {1: before})) == (
        "Each week our preseason board froze before the first kickoff and was graded on its players' points, "
        "ADP on the same players."
    )
    assert method(_two_weeks(before, _quarterbacks(ours_right=True, published=True))) == (
        "Each week our preseason board froze before the first kickoff and was graded on its players' points, "
        "ADP and Published on the same players."
    )
    assert method(()).endswith("ADP on the same players.")


_ORDER_SHOTS: Final = Path(__file__).resolve().parents[2] / "web" / "scripts" / "order-shots.ts"


def test_the_order_shots_variants_say_what_the_nightly_writes() -> None:
    """Review 82: order-shots measures the record's basis with Published drawn and at its worst by
    sentences it types; they are held here to what method and starters_basis write, so drift fails."""
    shots = _ORDER_SHOTS.read_text()
    replaced = re.search(r"RECORD\.method\.replace\('([^']+)', '([^']+)'\)", shots)
    assert replaced is not None
    drawn = method(
        _two_weeks(_quarterbacks(ours_right=True, published=False), _quarterbacks(ours_right=True, published=True))
    )
    assert method(()).replace(replaced[1], replaced[2]) == drawn
    worst = re.search(r'"(Starters right counts [^"]+)"', shots)
    assert worst is not None
    graded = Score(1, None, None, 0, 1)
    every = tuple(Line(position, graded, graded, None) for position in RECORD_POSITIONS)
    assert starters_basis(every) == worst[1]
