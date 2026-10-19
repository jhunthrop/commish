"""Lane 66v: the writers' sheets print each figure as the page prints it, and the guard refuses prose that
quotes a figure the page does not print (the sweep's X5: Josh Allen's cards said Proj 26.4, the game
29.5 to 24 and week 3 at 17.5; his prose said 26.6, 29.3 vs 24.3 and 17.46)."""

from research.capsules.page_figures import (
    FIGURE_OFF_PAGE,
    expected_score,
    figure_violations,
    page_tenth,
    page_tenth_text,
    projection_tenth,
)
from research.capsules.pull_figures import PullFigure, figure_matches_value, renderings_of


def test_a_figure_prints_to_the_tenth_by_the_sites_one_rule() -> None:
    assert page_tenth_text(17.46) == "17.5"
    assert page_tenth_text(18.52) == "18.5"
    # Half away from zero on the decimal the float is written as, where toFixed would give 9.4.
    assert page_tenth_text(9.45) == "9.5"
    assert page_tenth_text(24.0) == "24"
    assert page_tenth(-0.04) == 0.0


def test_the_weeks_projection_is_the_cents_then_the_tenth_as_the_api_serves_it() -> None:
    # The API's player week rounds the cents first (`roundTenth(roundCents(p))`): 26.449 is 26.45, then 26.5.
    assert (projection_tenth(26.44), projection_tenth(26.449)) == (26.4, 26.5)


def test_the_games_expected_score_is_in_half_points_the_opponents_from_the_total() -> None:
    # Allen's game: his club 29.3 of a 53.6 total, which the card prints "29.5 to 24".
    assert expected_score(29.3, 53.6) == (29.5, 24.0)
    assert expected_score(32.5, 52.5) == (32.5, 20.0)


def test_a_pull_figure_is_the_tenth_the_page_prints_on_a_tie() -> None:
    """The board row prints 9.45 as 9.5 (the run's tenth), so the gate and the writer count "9.5", never
    toFixed's "9.4"."""
    assert renderings_of(9.45) == ["9.5"]
    assert renderings_of(26.45) == ["26.5", "26"]
    assert figure_matches_value(PullFigure("9.5", "projected points", 9.45, ""))
    assert not figure_matches_value(PullFigure("9.4", "projected points", 9.45, ""))


_SHEET = "Week by week: week 3 of 2026, played, 17.5 points. week 4 of 2026, played, 18.5 points. Time to throw: 2.85 seconds."


def test_a_figure_to_more_decimals_than_the_page_prints_is_refused_by_name() -> None:
    violations = figure_violations("He put up 17.46 points in week 3 of 2026.", _SHEET, exact=False)
    assert len(violations) == 1
    assert violations[0].startswith(FIGURE_OFF_PAGE)
    assert '"17.46"' in violations[0] and "17.5" in violations[0]


def test_a_figure_the_sheet_prints_to_two_decimals_stands() -> None:
    assert figure_violations("He gets the ball out in 2.85 seconds.", _SHEET, exact=False) == []


def test_a_figure_the_sheet_prints_stands_and_a_whole_number_is_left_to_the_grounding() -> None:
    assert figure_violations("He scored 17.5 points, then about 18.", _SHEET, exact=True) == []


def test_an_exact_read_refuses_every_decimal_the_sheet_does_not_print() -> None:
    sheet = "Published projection for week 7 of 2026: 26.4 points in PPR scoring. Expected points: BUF 29.5 points, NYJ 24 points."
    prose = "The published projection has him at 26.6 points, with Buffalo expected at 29.3 to 24.3."
    violations = figure_violations(prose, sheet, exact=True)
    assert [v.split('"')[1] for v in violations] == ["26.6", "29.3", "24.3"]
    assert all(v.startswith(FIGURE_OFF_PAGE) for v in violations)
    assert "26.4" in violations[0] and "29.5" in violations[1]
    # Not exact, a one-decimal figure is left to the grounding rule.
    assert figure_violations(prose, sheet, exact=False) == []
