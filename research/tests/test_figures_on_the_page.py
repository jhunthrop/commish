"""Lane 66v, the sweep's X5 on Josh Allen's page: the cards said Proj 26.4, the game "29.5 to 24" and weeks
3 and 4 at 17.5 and 18.5; the prose said 26.6, 29.3 vs 24.3, 17.46 and 18.52. The week read's sheet carries
the card's figures, and a draft quoting another is refused by the figure guard, named first so the
nightly's fallback line says why."""

from collections.abc import Iterator
from dataclasses import replace
from datetime import date, timedelta

import httpx
import pytest

from research.capsules.gateway import GatewayClient
from research.capsules.page_figures import FIGURE_OFF_PAGE
from research.capsules.validate import Grounding, validate_prose
from research.capsules.week import angles
from research.capsules.week.angle_candidates import AngleFigure, Measure
from research.capsules.week.angles import Angle
from research.capsules.week.collect import (
    expected_from_read,
    figures_at,
    last_games,
    last_read_of,
    published_projection,
)
from research.capsules.week.prompt import answer_json
from research.capsules.week.render import render_week_sheet
from research.capsules.week.sheet import (
    BoardPlace,
    DepthPlace,
    ExpectedScore,
    GameLine,
    PublishedProjection,
    WeekGame,
    WeekSheet,
    points_text,
)
from research.capsules.week.store import StoredWeekRead
from research.capsules.week.validate import validate_week_read
from research.capsules.week.write import WeekReadResult, write_week_read
from research.nightly.week_reads import WeekReadSpend
from research.tests.week_read_fixtures import BOARD, CAPTURED, FIGURES, KICKOFF, main_sheet, starter


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
        # On the angles' sheet the expected score is an angle (the card still prints it in its cell).
        angles=(_EXPECTED,),
    )


_EXPECTED = Angle(
    "expected",
    "Expected score: the Bills' expected score is 29.5 points, the highest of the week.",
    (AngleFigure(29.5, Measure.EXPECTED),),
    (),
    1.8,
    None,
    (("the highest", "of the week"),),
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
    # Main's sheet prints the expected score's line; the angles' sheet states it as his angle.
    expected = _EXPECTED.text if angles.angles_on() else "BUF 29.5 points, NYJ 24 points"
    assert expected in sheet
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


def test_a_read_over_its_band_that_misquotes_a_figure_falls_for_the_figure() -> None:
    """The review's finding 2: the band leads the draft's violations, but the fall names the figure guard."""
    padded = GOOD.replace("26.4 points", "26.6 points") + " He has the arm, the legs and the line." * 12

    def answer(_request: httpx.Request) -> httpx.Response:
        usage = {"prompt_tokens": 2000, "completion_tokens": 120, "total_tokens": 2120, "cost": 0.0004}
        choice = {"message": {"content": answer_json(padded, "start")}, "finish_reason": "stop"}
        return httpx.Response(200, json={"choices": [choice], "usage": usage})

    gateway = replace(GatewayClient("test-key", httpx.Client(transport=httpx.MockTransport(answer))), concurrency=1)
    result = write_week_read(allen(), gateway)
    assert result.source == "facts"
    assert result.attempts[-1].violations[0].startswith("Word count")
    assert result.fallback is not None and result.fallback.startswith(f'failed validation: {FIGURE_OFF_PAGE}: "26.6"')


def test_the_nightlys_fallback_reason_names_the_guard() -> None:
    """A week read that never passes falls to its facts block with its first violation as the reason, and
    the pass's line names the page and that reason."""
    draft = GOOD.replace("26.4 points", "26.6 points")
    first = validate_week_read(draft, allen(), call="start").violations[0]
    assert first.startswith(FIGURE_OFF_PAGE)
    spend = WeekReadSpend()
    spend.add(WeekReadResult("Week: 6 of 2026", "facts", None, None, None, 4, (), f"failed validation: {first}"))
    spend.fell_to_facts("Josh Allen", f"failed validation: {first}")
    assert f"1 fell to their facts blocks: Josh Allen: failed validation: {FIGURE_OFF_PAGE}" in spend.line()
    assert "fell to their facts blocks" not in WeekReadSpend().line()


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


def test_the_week_facts_are_read_as_the_card_serves_them() -> None:
    """The store's raw figures become the card's at collection: the projection's cents then tenth, the game in
    half points with the opponent's from the total, a week's points to the tenth."""
    at = FIGURES
    assert expected_from_read((at, {"implied_team_total": 29.3, "game_total": 53.6})) == ExpectedScore(29.5, 24.0, at)
    assert published_projection(26.449, at, 26.62, at) == PublishedProjection(26.5, at, 26.6, at)
    block = {"log": [{"week": 3, "opponent": "MIA", "home": False, "points": 17.46, "status": "played"}]}
    assert last_games(block) == (GameLine(3, "MIA", False, 17.5),)


def test_the_game_figures_are_the_read_the_card_shows() -> None:
    """The API's `figuresAt`: the hourly capture's read while it is at most six hours older than the
    instant (the kickoff once it has passed), else the game table's weekly read; a read without all three
    figures is none."""
    capture = (FIGURES, {"implied_team_total": 29.3, "game_total": 53.6, "point_spread": -5.5})
    table = (FIGURES - timedelta(days=2), {"implied_team_total": 28.0, "game_total": 52.0, "point_spread": -4.0})
    assert figures_at(capture, table, FIGURES + timedelta(hours=6), KICKOFF) == capture
    assert figures_at(capture, table, FIGURES + timedelta(hours=7), KICKOFF) == table
    # Past the kickoff the instant is the kickoff, so a capture read near it stands.
    assert figures_at(capture, table, FIGURES + timedelta(days=9), FIGURES + timedelta(hours=1)) == capture
    partial = (FIGURES, {"implied_team_total": 29.3, "game_total": 53.6})
    assert figures_at(partial, table, FIGURES, KICKOFF) == table
    assert figures_at(None, None, FIGURES, KICKOFF) is None


def test_the_last_reads_projection_is_the_cards_tenth_as_the_comparison_reads_it() -> None:
    """The review's finding 8: a row kept before the card's tenth was stored (26.449) prints 26.5 in "at our
    last read", the figure the run and the web compare, never the plain tenth's 26.4."""
    row = StoredWeekRead(
        "00-0034857", 2026, 6, "llm", "A read.", "m/x", FIGURES, FIGURES, {}, 26.449, None, "first", "start",
        date(2026, 10, 16), 1,
    )  # fmt: skip
    last = last_read_of(row)
    assert last is not None and last.projection_points == 26.5  # noqa: PLR2004 - the cents, then the tenth
    assert last_read_of(None) is None


def test_the_sheet_prints_a_tie_as_the_page_does() -> None:
    assert points_text(9.45) == "9.5"
    moved = replace(allen(), projection=PublishedProjection(26.4, CAPTURED, 26.6, CAPTURED))
    assert moved.projection_change == -0.2  # noqa: PLR2004 - the card's tenths, 26.4 less 26.6


@pytest.fixture(autouse=True, params=[False, True], ids=["angles-off", "angles-on"])
def _both_sheets(request: pytest.FixtureRequest) -> Iterator[None]:
    """The page's figures hold in both arms (Lane 300, the review's H3): every test runs on main's sheet and on
    the angles' sheet, where Josh Allen's expected score is an angle (`allen` gives him one on that arm)."""
    if request.param:
        held = angles.ANGLES_ON
        setattr(angles, "ANGLES_ON", True)  # noqa: B010 (a Final switch, set for the test)
        yield
        setattr(angles, "ANGLES_ON", held)  # noqa: B010
    else:
        with main_sheet():
            yield
