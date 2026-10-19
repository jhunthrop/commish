"""Lane 66v, the sweep's X5 on Josh Allen's page: the cards said Proj 26.4, the game "29.5 to 24" and weeks
3 and 4 at 17.5 and 18.5; the prose said 26.6, 29.3 vs 24.3, 17.46 and 18.52. The week read's sheet carries
the card's figures, and a draft quoting another is refused by the figure guard, named first so the
nightly's fallback line says why."""

from dataclasses import replace

from research.capsules.page_figures import FIGURE_OFF_PAGE
from research.capsules.validate import Grounding, validate_prose
from research.capsules.week.render import render_week_sheet
from research.capsules.week.sheet import (
    BoardPlace,
    DepthPlace,
    ExpectedScore,
    GameLine,
    PublishedProjection,
    WeekGame,
    WeekSheet,
)
from research.capsules.week.validate import validate_week_read
from research.capsules.week.write import WeekReadResult
from research.tests.week_read_fixtures import BOARD, CAPTURED, FIGURES, KICKOFF, starter


def allen() -> WeekSheet:
    """Josh Allen's week as his page printed it in the sweep."""
    return replace(
        starter(),
        player_id="00-0034857",
        name="Josh Allen",
        position="QB",
        team="BUF",
        game=WeekGame(6, "NYJ", home=True, kickoff=KICKOFF),
        projection=PublishedProjection(26.4, CAPTURED, None, None),
        expected=ExpectedScore(29.5, 24.0, FIGURES),
        weather=None,
        allowed=None,
        depth=DepthPlace(1.0, ()),
        last_games=(GameLine(5, "NE", False, 22.1), GameLine(4, "NO", True, 18.5), GameLine(3, "MIA", False, 17.5)),
        points_per_game=21.4,
        games_played=5,
        touchdowns=12.0,
        played=(1, 2, 3, 4, 5),
        missed=(),
        board=BoardPlace(4, 1, 301.2, "rest_of_season", 6, BOARD),
    )


GOOD = (
    "Josh Allen gets the Jets at home in week 6 of 2026, and the published projection has him at 26.4 points. "
    "Buffalo are expected to win 29.5 to 24, and he comes in off 22.1 PPR points at New England, after 18.5 "
    "and 17.5 the two weeks before. He is QB1 in our rest-of-season order. Start him."
)


def _figure_violations(result_violations: tuple[str, ...]) -> list[str]:
    return [v for v in result_violations if v.startswith(FIGURE_OFF_PAGE)]


def test_the_sheet_prints_the_cards_figures() -> None:
    sheet = render_week_sheet(allen())
    assert "26.4 points in PPR scoring" in sheet
    assert "BUF 29.5 points, NYJ 24 points" in sheet
    assert "17.5 PPR points" in sheet and "18.5 PPR points" in sheet


def test_a_read_quoting_the_cards_figures_passes_the_guard() -> None:
    assert _figure_violations(validate_week_read(GOOD, allen(), call="start").violations) == []


def test_a_draft_saying_26_6_against_the_cards_26_4_is_refused_by_name() -> None:
    draft = GOOD.replace("26.4 points", "26.6 points")
    violations = validate_week_read(draft, allen(), call="start").violations
    off = _figure_violations(violations)
    assert len(off) == 1 and '"26.6"' in off[0] and "26.4" in off[0]
    # The guard names it, and the grounding rule does not repeat it as a number with no fact.
    assert not any('"26.6" does not trace' in v for v in violations)


def test_every_figure_of_the_sweeps_prose_is_refused() -> None:
    draft = (
        GOOD.replace("26.4 points", "26.6 points")
        .replace("29.5 to 24", "29.3 to 24.3")
        .replace("after 18.5 and 17.5", "after 18.52 and 17.46")
    )
    off = _figure_violations(validate_week_read(draft, allen(), call="start").violations)
    assert [v.split('"')[1] for v in off] == ["26.6", "29.3", "24.3", "18.52", "17.46"]


def test_the_nightlys_fallback_reason_names_the_guard() -> None:
    """A week read that never passes falls to its facts block with its first violation as the reason."""
    draft = GOOD.replace("26.4 points", "26.6 points")
    first = validate_week_read(draft, allen(), call="start").violations[0]
    assert first.startswith(FIGURE_OFF_PAGE)
    fallback = WeekReadResult("", "facts", None, None, None, 4, (), f"failed validation: {first}").fallback
    assert fallback is not None and FIGURE_OFF_PAGE in fallback


def _season_grounding(sheet: str) -> Grounding:
    return Grounding(
        number_ledger=(17.46,),
        name_ledger=("Josh Allen",),
        prompt_text=sheet,
        tension=None,
        page_numbers=(),
        adp=None,
        position="QB",
        position_rank=None,
        board_rank=None,
        clock=allen().clock,
    )


def test_the_season_read_refuses_a_figure_to_more_decimals_than_the_page_prints() -> None:
    """The season read's ledger may still hold the stat line's cents; the page prints the tenth."""
    sheet = "Week by week: week 3 of 2026, played, 17.5 points. week 4 of 2026, played, 18.5 points."
    prose = "Josh Allen scored 17.46 points in week 3 of 2026, and the week after he scored more."
    off = _figure_violations(validate_prose(prose, _season_grounding(sheet), (5, 60)).violations)
    assert len(off) == 1 and '"17.46"' in off[0] and "17.5" in off[0]
    ok = prose.replace("17.46", "17.5")
    assert _figure_violations(validate_prose(ok, _season_grounding(sheet), (5, 60)).violations) == []
