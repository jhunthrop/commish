"""The special-teams week is one fact (Lane 144, B117): Josiah Deguara's newest line (PHI, week 4) had no stat
line and no offensive snap, so his log reads it inactive under PHI's game, his page says "His week 4 snaps
were on special teams for the Eagles" with "Special teams only" on the row, and the writer's sheet says the
same: never "did not play", never a missed week, and a read that calls it missed fails validation."""

from types import SimpleNamespace
from typing import TYPE_CHECKING, Any, cast

from research.capsules.facts.model import SeasonSoFar, SeasonTotals, SeasonWeek, to_js
from research.capsules.render_season import SPECIAL_TEAMS_ONLY, season_section
from research.capsules.season_voice import (
    SPECIAL_TEAMS_CALLED_MISSED,
    SeasonClock,
    calls_special_teams_week_missed,
    clock_of,
)
from research.capsules.validate import Grounding, validate_prose
from research.nightly.build.page_club import ClubCall, page_last_game_club, special_teams_week

if TYPE_CHECKING:
    from research.capsules.facts.build import PlayerFacts

# Deguara's newest line: PHI's week 4 game.
_WEEK = 4
_TOTALS = SeasonTotals(None, None, None, None, None, None, None, None)
_WEEKS = (SeasonWeek(1, "inactive", None), SeasonWeek(4, "inactive", None), SeasonWeek(5, "inactive", None))


def _row(week: int, status: str, opponent: str | None) -> dict[str, Any]:
    return {"week": week, "status": status, "opponent": opponent}


_MOVED = ClubCall("SEA", 4, "PHI", moved=True)
_OWN = ClubCall("PHI", 4, "PHI", moved=False)


def test_the_writer_names_the_week_once_and_the_page_carries_it() -> None:
    log = [_row(3, "inactive", None), _row(4, "inactive", "LAR"), _row(5, "inactive", "ARI")]
    assert special_teams_week(_MOVED, log) == _WEEK
    assert page_last_game_club(_MOVED, log) == {"club": "PHI", "week": 4, "specialTeams": True}
    # A played newest line is a game, and a page whose newest line is its own club's says nothing.
    played = [_row(4, "played", "LAR")]
    assert special_teams_week(_MOVED, played) is None
    assert page_last_game_club(_MOVED, played) == {"club": "PHI", "week": 4}
    assert special_teams_week(_OWN, log) is None
    assert page_last_game_club(_OWN, log) is None


def _season() -> SeasonSoFar:
    return SeasonSoFar(2026, 6, 0, None, _TOTALS, _WEEKS, None, 4)


def test_the_sheet_says_special_teams_and_never_counts_the_week_missed() -> None:
    season = _season()
    assert season.missed_weeks == (1, 5)
    section = season_section(cast("PlayerFacts", SimpleNamespace(season=season, product_season=2026)))
    assert f"week 4 of 2026, {SPECIAL_TEAMS_ONLY}" in section
    assert "week 4 of 2026, did not play" not in section
    assert "Weeks he has missed this season: weeks 1 and 5 of 2026 (2 in all)." in section
    # Without the fact the week is one he sat, as before.
    plain = SeasonSoFar(2026, 6, 0, None, _TOTALS, _WEEKS, None)
    assert plain.missed_weeks == (1, 4, 5)


def _grounding(clock: SeasonClock) -> Grounding:
    return Grounding((), (), "", None, (), None, "TE", None, None, clock)


def _rules(text: str, clock: SeasonClock) -> list[str]:
    return [
        v
        for v in validate_prose(text, _grounding(clock), (1, 500)).violations
        if v.startswith(SPECIAL_TEAMS_CALLED_MISSED)
    ]


def test_a_read_calling_the_special_teams_week_missed_fails_validation() -> None:
    clock = clock_of(cast("PlayerFacts", SimpleNamespace(season=_season(), product_season=2026)))
    assert (clock.missed, clock.special_teams) == ((1, 5), 4)
    for text in (
        "He missed week 4 of 2026.",
        "He did not play in week 4 of 2026 for the Eagles.",
        "Week 4 of 2026 he sat out.",
        "He missed weeks 4 and 5 of 2026.",
        "He missed weeks 1 and 5 of 2026 and played special teams only in week 4, then missed week 4 of 2026 again.",
    ):
        assert _rules(text, clock), text
    for text in (
        "His week 4 of 2026 snaps were on special teams for the Eagles.",
        "He missed weeks 1 and 5 of 2026.",
        "He missed week 4 of 2025.",
        # Review M1: the weeks he missed, and the special-teams week said as special teams.
        "He missed weeks 1 and 5 of 2026 and played special teams only in week 4.",
        "He missed weeks 1 and 5 of 2026, but in week 4 of 2026 he was on special teams for the Eagles.",
    ):
        assert not _rules(text, clock), text
    # No special-teams week, no rule.
    assert not calls_special_teams_week_missed("He missed week 4 of 2026.", SeasonClock(2026, 6, (), (1, 4, 5)))


def test_a_season_with_no_special_teams_week_keeps_its_facts_json() -> None:
    """Every other player's facts hash stays as it was, so no capsule is rewritten for the new fact."""
    plain = to_js(SeasonSoFar(2026, 6, 0, None, _TOTALS, _WEEKS, None))
    assert "specialTeamsWeek" not in plain
    assert to_js(_season())["specialTeamsWeek"] == _WEEK
