"""The record's measures on a shared fixture (Lane 114 fix round 1, review M1): the Python record read
and the API's league ranking (`api/internal/leaguerecord/ranking_parity_test.go`) grade the same week
from `testdata/record-measures.json` and must print the same figures. Only players with a stat line are
graded; ties share their average place; a player with no stance is tied below every listed one."""

import json
from pathlib import Path
from typing import Any, Final

from research.nightly.build.season import _clamped
from research.nightly.reads.record import (
    AGREEMENT_PLACES,
    LEAGUE_TEAMS,
    PLACES_OFF_PLACES,
    STARTERS_A_TEAM,
    Entry,
    Score,
    printed,
    score_entries,
)

FIXTURE: Final = Path(__file__).parent / "testdata" / "record-measures.json"


def _fixture() -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads(FIXTURE.read_text())
    return loaded


def _entries(players: list[dict[str, Any]], stance: str) -> list[Entry]:
    graded = [p for p in players if p["actual"] is not None]
    out: list[Entry] = []
    for p in graded:
        value = p[stance]
        held = None if value is None else (-float(value) if stance == "ours" else float(value))
        out.append((p["id"], held, float(p["actual"]), p["position"]))
    return out


def _printed(score: Score) -> dict[str, Any]:
    return {
        "agreement": printed(_clamped(score.agreement), AGREEMENT_PLACES),
        "placesOff": printed(score.places_off, PLACES_OFF_PLACES),
        "starters": score.starters,
        "startersOf": score.starters_of,
    }


def test_the_fixture_lineup_is_the_records_standard_one() -> None:
    lineup = _fixture()["lineup"]
    assert lineup["teams"] == LEAGUE_TEAMS
    assert {k.upper(): lineup[k.lower()] for k in ("QB", "RB", "WR", "TE")} == {
        p: STARTERS_A_TEAM[p] for p in ("QB", "RB", "WR", "TE")
    }


def test_the_record_read_grades_the_fixture_as_the_api_must() -> None:
    fixture = _fixture()
    ours = score_entries(_entries(fixture["players"], "ours"))
    espn = score_entries(_entries(fixture["players"], "espn"))
    expected = fixture["expected"]
    assert ours.graded == espn.graded == expected["players"]
    assert _printed(ours) == expected["ours"]
    assert _printed(espn) == expected["espn"]


def test_half_way_figures_round_away_from_zero_on_their_shortest_form() -> None:
    for case in _fixture()["rounding"]:
        assert printed(case["value"], case["places"]) == case["printed"], case
