"""Lane 286 (B282) added four rules on Lane 282's samples (a rank stated twice, the member's sheet addressed, an
opening set up on a colon, a figure spelled out); Lane 307 retired them with the checklist prompt, each one a rule
that refused a true sentence for its wording. The samples now pass the week's rules, and a count no cell prints
still reads in words, the cell rule refusing its digits."""

from dataclasses import replace
from typing import Final

import pytest

from research.capsules.week.rules import week_rule_violations
from research.capsules.week.sheet import GameLine
from research.tests.week_read_fixtures import on_bye, starter

_OPEN: Final = "Puka Nacua is healthy for week 6 of 2026."
# Jefferson's sheet as Lane 282 sampled it: 14 PPR points a game over 5 games, each a cell (Avg).
_JEFFERSON: Final = replace(starter(), points_per_game=14.0, games_played=5)
_RETIRED: Final = (
    "states the rank",
    "addresses the member's sheet",
    "opens on a set-up clause",
    "opens without",
)


@pytest.mark.parametrize(
    "sample",
    [
        "Tampa Bay has allowed the 11th-fewest PPR points a game to receivers, 11th of 32, so the matchup asks for "
        "effort but not fear.",
        "The 49ers don't play in week 6, so he puts zero points on your sheet this week.",
        "Keep him on your roster and fill the spot this week.",
        "He is a fine play in your flex this week.",
    ],
)
def test_a_retired_wording_rule_refuses_nothing(sample: str) -> None:
    violations = week_rule_violations(f"{_OPEN} {sample} Start him.", _JEFFERSON, "start")
    assert not [v for v in violations if any(rule in v for rule in _RETIRED)], violations


@pytest.mark.parametrize(
    ("spelled", "digits"),
    [
        ("Fourteen PPR points a game over 5 games is a quiet season for Jefferson.", "14 PPR points a game over 5"),
        ("He put up five PPR points in week 7.", "He put up 5 PPR points in week 7."),
    ],
)
def test_a_cell_figure_spelled_out_is_still_refused(spelled: str, digits: str) -> None:
    """The phase 1 review's M1: the figure, week-tie and measure rules read digits, so a figure a cell prints is
    refused spelled out and read in digits (his Avg 14 and his 5 games here)."""
    violations = week_rule_violations(f"{_OPEN} {spelled} Start him.", _JEFFERSON, "start")
    assert [v for v in violations if "spells out a figure" in v], violations


def test_an_opening_set_up_on_a_colon_is_taken() -> None:
    opener = "Bye week for Kittle: the 49ers don't play in week 6 of 2026, so he scores nothing this week."
    violations = week_rule_violations(f"{opener} He leads the Rams' receivers.", on_bye(), "hold")
    assert not [v for v in violations if any(rule in v for rule in _RETIRED)], violations


def test_a_count_no_cell_prints_stands_in_words_and_its_digits_are_refused() -> None:
    """The cell rule still binds a figure to the page: "his last 2 games" is no cell's figure."""
    words = week_rule_violations(f"{_OPEN} He has been quiet over his last two games. Start him.", _JEFFERSON, "start")
    digits = week_rule_violations(f"{_OPEN} He has been quiet over his last 2 games. Start him.", _JEFFERSON, "start")
    assert not [v for v in words if "no cell" in v]
    assert [v for v in digits if "no cell" in v]


def test_waddles_count_in_words_stands() -> None:
    """Lane 286's run lost Jaylen Waddle's read to "his last three games", then to its "3": in words it stands."""
    sheet = replace(
        _JEFFERSON,
        last_games=(GameLine(7, "BUF", True, 8.8), GameLine(6, "CLE", False, 6.4), GameLine(5, "NYJ", True, 4.8)),
    )
    words = "His last three games brought 8.8 PPR points, then 6.4 PPR points, then 4.8 PPR points."
    assert not [v for v in week_rule_violations(f"{_OPEN} {words} Start him.", sheet, "start") if "no cell" in v]
