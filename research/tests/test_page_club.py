# ruff: noqa: PLR2004 - the expected weeks and counts are the recorded fixture's, each read beside its case
"""The club a page names (Lane 120, B100), on the five pages Lane 119 named: each as the dev store
recorded him (`testdata/page_club/five-movers.json`: his seeded roster club, the provider's club, his
2026 lines through week 5) on the real 2026 slate (the in-season contract fixture's `schedule.json`),
through the writer's own `club_calls` and `season_block`."""

import json
import os
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import MappingProxyType
from typing import Any, Final
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import insert

from research.db.engine import make_engine
from research.db.schema import CAPTURE_SNAPSHOTS, PROVIDER_PLAYERS
from research.db.url import sqlalchemy_url
from research.nightly import gates
from research.nightly.build.page_club import (
    LIST_CATCH_UP,
    NO_ROSTER_READ,
    ClubCall,
    RosterRead,
    club_call,
    club_calls,
    last_game_club,
    read_roster,
    seeded_clubs,
)
from research.nightly.build.player_season import SeasonContext, SeasonStore, season_block
from research.nightly.config import GATES, PAGE_FORMAT
from research.nightly.reads.schedule import Game
from research.parity import databases
from research.pipeline.tank01.capture import PLAYER_LIST_SOURCE
from research.pipeline.tank01.player_clubs import listed_clubs

_TESTDATA: Final = Path(__file__).parent / "testdata" / "page_club" / "five-movers.json"
_SCHEDULE: Final = (
    Path(__file__).resolve().parents[1]
    / "nightly"
    / "contract"
    / "fixture"
    / "runs"
    / "2026-10-21T12-ros"
    / "schedule.json"
)
_POSITIONS: Final = {"QB", "RB", "WR", "TE"}
WEASE, DORTCH, MCCARTHY, SCOTT, JONES = "4426535", "4037235", "4433970", "4257364", "4257188"

Json = dict[str, Any]


def _fixture() -> Json:
    fixture: Json = json.loads(_TESTDATA.read_text())
    return fixture


def _games() -> dict[str, list[Game]]:
    slates = json.loads(_SCHEDULE.read_text())["slates"]
    return {
        s["abbr"]: [Game(g["week"], g["opponent"], g["home"], datetime.fromisoformat(g["kickoff"])) for g in s["games"]]
        for s in slates
    }


def _byes(games: dict[str, list[Game]]) -> dict[str, int | None]:
    return {club: next(w for w in range(1, 19) if all(g.week != w for g in slate)) for club, slate in games.items()}


def _weeked[T](by: dict[str, T]) -> dict[int, T]:
    """The fixture's week keys are strings."""
    return {int(week): value for week, value in by.items()}


def _store(fixture: Json, games: dict[str, list[Game]]) -> SeasonStore:
    through = fixture["through"]
    players = fixture["players"]
    carried = {w: frozenset(m for p in players for m in p["lines"].get(str(w), {})) for w in range(1, through + 1)}
    return SeasonStore(
        lines={p["id"]: _weeked(p["lines"]) for p in players},
        snaps={p["id"]: _weeked(p["snaps"]) for p in players},
        teams={p["id"]: _weeked(p["clubs"]) for p in players},
        carried=carried,
        in_records=frozenset((club, g.week) for club, slate in games.items() for g in slate if g.week <= through),
    )


def _provider_read(fixture: Json) -> RosterRead:
    """The provider's clubs as one list read at its newest recorded instant."""
    payload = [{"playerID": p["id"], "team": p["providerClub"], "isFreeAgent": "False"} for p in fixture["players"]]
    return RosterRead(MappingProxyType(listed_clubs(payload)), datetime.fromisoformat(fixture["providerReadAt"]))


def _context(roster: RosterRead) -> SeasonContext:
    fixture, games = _fixture(), _games()
    store = _store(fixture, games)
    seeded = {p["id"]: p["seed"] for p in fixture["players"]}
    calls = club_calls(seeded, roster, store.teams, games)
    return SeasonContext(2026, 18, fixture["through"], games, _byes(games), store, {}, calls)


def _block(player_id: str, context: SeasonContext) -> dict[int, Json]:
    position = next(p["position"] for p in _fixture()["players"] if p["id"] == player_id)
    season = season_block(player_id, PAGE_FORMAT, position, context)
    return {row["week"]: row for row in season["log"]}


def _where(row: Json) -> tuple[str | None, bool | None, str]:
    return row["opponent"], row["home"], row["status"]


def test_the_fixture_is_the_five_pages_and_every_seeded_club_is_stale() -> None:
    players = _fixture()["players"]
    assert [p["id"] for p in players] == [WEASE, DORTCH, MCCARTHY, SCOTT, JONES]
    assert all(p["position"] in _POSITIONS for p in players)
    # The bug: the seed names a club his lines are not for, for every one of them.
    assert all(p["seed"] not in p["clubs"].values() for p in players)
    # The provider's own read names the club his lines are for: the lag is the seed's, not the provider's.
    assert all({p["providerClub"]} == set(p["clubs"].values()) for p in players)


@pytest.mark.parametrize("roster", ["provider read", "no read"])
def test_each_page_names_the_club_he_plays_for(roster: str) -> None:
    context = _context(_provider_read(_fixture()) if roster == "provider read" else NO_ROSTER_READ)
    clubs = {pid: call.club for pid, call in context.clubs.items()}
    assert clubs == {WEASE: "LAC", DORTCH: "BUF", MCCARTHY: "NYG", SCOTT: "CHI", JONES: "NYG"}
    # His newest line is for the page's club, so no page says another.
    assert all(last_game_club(call) is None for call in context.clubs.values())
    assert all(call.moved for call in context.clubs.values())


def test_a_movers_weeks_before_his_first_line_name_no_opponent() -> None:
    context = _context(_provider_read(_fixture()))
    wease = _block(WEASE, context)
    # Weeks 1 to 4: no line, and the run holds no fact of which club he was with.
    assert [_where(wease[w]) for w in range(1, 5)] == [(None, None, "inactive")] * 4
    # Week 5 is his LAC line (vs DEN); week 6 LAC's game at KC, still to come in the records.
    assert _where(wease[5]) == ("DEN", True, "played")
    assert _where(wease[6]) == ("KC", False, "upcoming")
    # Never MIA's: the seed's bye in week 6 is gone, LAC's in week 7 is his.
    assert _where(wease[7]) == (None, None, "bye")
    jones = _block(JONES, context)
    assert [_where(jones[w])[2] for w in range(1, 6)] == ["inactive", "inactive", "inactive", "played", "played"]
    assert jones[1]["opponent"] is None
    assert _where(jones[6]) == ("NO", True, "upcoming")  # NYG's, not CIN's week 6 bye
    assert _where(jones[8]) == (None, None, "bye")
    mccarthy = _block(MCCARTHY, context)
    # He was MIN's in weeks 1 to 3 (the provider moved him on September 28): no club the run can name.
    assert [mccarthy[w]["opponent"] for w in range(1, 5)] == [None] * 4
    assert _where(mccarthy[5]) == ("WSH", False, "played")
    scott = _block(SCOTT, context)
    assert _where(scott[6]) == ("ATL", False, "upcoming")
    assert _where(scott[10]) == (None, None, "bye")


def test_a_player_with_a_line_every_week_keeps_every_opponent() -> None:
    dortch = _block(DORTCH, _context(_provider_read(_fixture())))
    assert [_where(dortch[w]) for w in range(1, 6)] == [
        ("HOU", False, "played"),
        ("DET", True, "played"),
        ("LAC", True, "played"),
        ("NE", True, "played"),
        ("LAR", False, "played"),
    ]
    assert _where(dortch[7]) == (None, None, "bye")  # BUF's, never DET's week 6


def test_a_list_read_after_his_last_game_moves_the_page_and_names_the_lines_club() -> None:
    """A constructed move: the list read after his week 5 game names MIA (not a recorded fact)."""
    fixture, games = _fixture(), _games()
    week5 = next(g.kickoff for g in games["LAC"] if g.week == 5)
    read = RosterRead(MappingProxyType({WEASE: "MIA"}), week5 + timedelta(days=2))
    call = club_call("MIA", read, WEASE, {5: "LAC"}, games)
    assert call == ClubCall("MIA", 5, "LAC", True)
    assert last_game_club(call) == {"club": "LAC", "week": 5}
    store = _store(fixture, games)
    context = SeasonContext(2026, 18, 5, games, _byes(games), store, {}, {WEASE: call})
    wease = _block(WEASE, context)
    assert _where(wease[5]) == ("DEN", True, "played")  # the line keeps the club it was for
    assert _where(wease[6]) == (None, None, "bye")  # then MIA's slate: its week 6 bye
    assert _where(wease[7]) == ("NYJ", False, "upcoming")


def test_a_list_read_wins_over_the_line_only_36_hours_after_its_kickoff() -> None:
    """Fix round 1 (review M1): the provider's list can be a day behind a move, so a read the morning after
    a Sunday game naming the old club is not yet newer than the new club's line."""
    eastern = ZoneInfo("America/New_York")
    sunday = datetime(2026, 10, 25, 13, tzinfo=eastern)  # a Sunday 13:00 ET game for his new club
    games = {"NYJ": [Game(8, "BUF", True, sunday)]}
    lines = {8: "NYJ"}
    monday = RosterRead(MappingProxyType({WEASE: "MIA"}), datetime(2026, 10, 26, 6, tzinfo=eastern))
    held = club_call("MIA", monday, WEASE, lines, games)
    assert held.club == "NYJ"
    assert last_game_club(held) is None  # no "Now with" line
    tuesday = RosterRead(MappingProxyType({WEASE: "MIA"}), datetime(2026, 10, 27, 6, tzinfo=eastern))
    moved = club_call("MIA", tuesday, WEASE, lines, games)
    assert moved.club == "MIA"
    assert last_game_club(moved) == {"club": "NYJ", "week": 8}  # the read wins and the line is said
    # The line holds until exactly 36 hours after kickoff.
    edge = RosterRead(MappingProxyType({WEASE: "MIA"}), sunday + LIST_CATCH_UP)
    assert club_call("MIA", edge, WEASE, lines, games).club == "MIA"
    assert (
        club_call("MIA", replace(edge, read_at=sunday + LIST_CATCH_UP - timedelta(seconds=1)), WEASE, lines, games).club
        == "NYJ"
    )


def test_the_rule_a_line_newer_than_the_read_wins() -> None:
    games = _games()
    week5 = next(g.kickoff for g in games["LAC"] if g.week == 5)
    stale = RosterRead(MappingProxyType({WEASE: "MIA"}), week5 - timedelta(days=3))
    assert club_call("MIA", stale, WEASE, {5: "LAC"}, games) == ClubCall("LAC", 5, "LAC", True)
    # The list agrees, or names him nowhere (a free agent): the line's club; no line and no list: the seed.
    agree = RosterRead(MappingProxyType({WEASE: "LAC"}), week5 + timedelta(days=1))
    assert club_call("MIA", agree, WEASE, {5: "LAC"}, games).club == "LAC"
    assert club_call("MIA", NO_ROSTER_READ, WEASE, {5: "LAC"}, games).club == "LAC"
    assert club_call("MIA", NO_ROSTER_READ, WEASE, {}, games) == ClubCall("MIA", None, None, False)
    # One club in every fact: not a mover, so a week with no line keeps the page club's opponent.
    kept = club_call("LAC", agree, WEASE, {5: "LAC"}, games)
    assert not kept.moved
    assert kept.club_in(2, 5) == "LAC"


def test_the_list_names_a_free_agent_with_no_club_and_leaves_out_a_code_outside_the_32() -> None:
    payload = [
        {"playerID": "1", "team": "BUF", "isFreeAgent": "False"},
        {"playerID": "2", "team": "", "isFreeAgent": "True"},
        {"playerID": "3", "team": "FA", "isFreeAgent": "False"},
        {"playerID": "4", "team": "KC", "isFreeAgent": "True"},
        {"team": "KC"},
        "not a player",
    ]
    assert listed_clubs(payload) == {"1": "BUF", "2": None, "4": None}
    assert listed_clubs({"body": []}) == {}


def test_a_free_agent_on_the_list_has_no_club_unless_a_newer_line_names_one() -> None:
    """Lane 123 (B101): the list's free agent has no club, over a stale seed and over a NULL one; his line
    wins only while the read is not 36 hours newer than its game, as a move's does."""
    eastern = ZoneInfo("America/New_York")
    sunday = datetime(2026, 10, 25, 13, tzinfo=eastern)
    games = {"NYJ": [Game(8, "BUF", True, sunday)]}
    tuesday = RosterRead(MappingProxyType({WEASE: None}), datetime(2026, 10, 27, 6, tzinfo=eastern))
    assert club_call("MIA", tuesday, WEASE, {}, games) == ClubCall(None, None, None, False)
    assert club_call(None, tuesday, WEASE, {}, games) == ClubCall(None, None, None, False)
    cut = club_call(None, tuesday, WEASE, {8: "NYJ"}, games)
    assert cut == ClubCall(None, 8, "NYJ", False)
    assert last_game_club(cut) == {"club": "NYJ", "week": 8}  # the page says he is now a free agent
    monday = replace(tuesday, read_at=datetime(2026, 10, 26, 6, tzinfo=eastern))
    signed = club_call(None, monday, WEASE, {8: "NYJ"}, games)
    assert signed.club == "NYJ" and last_game_club(signed) is None
    # No read, a NULL club and no line: no club; a line: his line's.
    assert club_call(None, NO_ROSTER_READ, WEASE, {}, games).club is None
    assert club_call(None, NO_ROSTER_READ, WEASE, {8: "NYJ"}, games).club == "NYJ"


def test_a_free_agents_weeks_with_no_line_name_no_opponent() -> None:
    """A free agent's log: a week of his line keeps its club's game, every other week names none, never a
    bye of a club he is not with."""
    fixture, games = _fixture(), _games()
    store = _store(fixture, games)
    read = RosterRead(MappingProxyType({DORTCH: None}), datetime(2026, 10, 20, 6, tzinfo=ZoneInfo("UTC")))
    call = club_call(None, read, DORTCH, store.teams[DORTCH], games)
    assert call.club is None and call.latest_club == "BUF"
    context = SeasonContext(2026, 18, fixture["through"], games, _byes(games), store, {}, {DORTCH: call})
    dortch = _block(DORTCH, context)
    assert _where(dortch[5]) == ("LAR", False, "played")
    assert [_where(dortch[w]) for w in range(6, 19)] == [(None, None, "inactive")] * 13


def _page(pid: str, club: str, elsewhere: Json | None) -> Json:
    return {"id": pid, "team": club, "lastGameClub": elsewhere}


def test_the_club_gate_names_each_page_and_fails_past_its_line() -> None:
    most = GATES.max_club_elsewhere_pages
    one = [_page(WEASE, "MIA", {"club": "LAC", "week": 5}), _page(DORTCH, "BUF", None), {"id": "old", "team": "KC"}]
    record = gates.club_gate(one)
    assert record.passed
    assert record.summary == "1 of 3 pages name a club their newest line was not for: 4426535 MIA (week 5 LAC)"
    many = [_page(str(i), "MIA", {"club": "LAC", "week": 5}) for i in range(most + 1)]
    failed = gates.club_gate(many)
    assert not failed.passed
    assert failed.reasons == (f"club_elsewhere_pages:{most + 1}>{most}",)
    assert gates.club_gate(many[:most]).passed


_DATABASE: Final = "parity_lane120_page_club"


@pytest.mark.skipif("PARITY_DATABASE_URL" not in os.environ, reason="needs a Postgres for scratch databases")
def test_the_run_reads_the_newest_list_at_its_instant_and_the_seeded_roster() -> None:
    url = databases.build_with_alembic(_DATABASE)
    engine = make_engine(sqlalchemy_url(url))
    first, second = datetime(2026, 10, 15, 11, tzinfo=UTC), datetime(2026, 10, 16, 11, tzinfo=UTC)
    try:
        with engine.begin() as conn:
            conn.execute(
                insert(PROVIDER_PLAYERS),
                [{"id": WEASE, "name": "Theo Wease Jr.", "position": "WR", "team": "MIA", "headshot_url": None}],
            )
            for at, club in ((first, "LAC"), (second, "KC")):
                payload = [{"playerID": WEASE, "team": club, "isFreeAgent": "False"}]
                conn.execute(
                    insert(CAPTURE_SNAPSHOTS),
                    {"source": PLAYER_LIST_SOURCE, "captured_at": at, "digest": club, "payload": payload},
                )
            assert read_roster(conn, first - timedelta(hours=1)) == NO_ROSTER_READ
            assert read_roster(conn, first + timedelta(hours=1)) == RosterRead({WEASE: "LAC"}, first)
            assert read_roster(conn, second) == RosterRead({WEASE: "KC"}, second)
            assert seeded_clubs(conn, [WEASE, "missing"]) == {WEASE: "MIA"}
    finally:
        engine.dispose()
        databases.drop(_DATABASE)
