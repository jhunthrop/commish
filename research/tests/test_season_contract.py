"""A season block the writer makes, read by the web's own reader through the schema gate (Lane 119).

Run 2026-10-21T05 failed its schema gate on five pages the writer had made by its own rules: a player
whose page names his current club (MIA, bye week 6) and who played week 6 for the club he was with
(LAC) has no bye in his log, and the reader required exactly one. Neither side's own tests could see
it, because the writer's were never parsed by the reader. Here the writer's `season_block` makes that
page and the real gate (`schema_gate`, the web's `server/run.ts` under node) reads it inside a copy of
the in-season contract fixture, so a reader rule the writer breaks fails here, and the other way round.

Lane 120 extends the mover: his page club comes from the writer's own rule (`page_club`, a list read
after his week 6 game naming DET), his weeks before his first line name no opponent, and his page says
his newest line was LAC's (`lastGameClub`); the reader refuses a played week that names none.

It needs node and the web's dependencies (`npm ci` in `web/`); CI installs them, so there it never
skips.
"""

import json
import os
import shutil
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Final

import pytest

from research.nightly.build.page_club import RosterRead, club_calls, last_game_club
from research.nightly.build.player_season import SeasonContext, SeasonStore, season_block
from research.nightly.config import PAGE_FORMAT
from research.nightly.reads.schedule import Game
from research.nightly.schema_gate import schema_gate
from research.web_contract import contract_dir

_FIXTURE: Final = Path(__file__).resolve().parents[1] / "nightly" / "contract" / "fixture"
_RUN: Final = "2026-10-21T12-ros"
# Jahmyr Gibbs's page in the fixture: DET, whose bye is week 6.
_PLAYER: Final = "4429795"
_PAGE_CLUB: Final = "DET"
_CLUB_BYE: Final = 6
_FORMER_CLUB: Final = "LAC"
_FORMER_WEEKS: Final = (5, 6)
_CARRIED: Final = frozenset({"carries", "rushing_yards", "rushing_touchdowns", "receptions", "receiving_yards"})
_LINE: Final = {"carries": 14.0, "rushing_yards": 61.0, "rushing_touchdowns": 0.0, "receptions": 3.0}

Json = dict[str, Any]


def _reader_present() -> bool:
    web = contract_dir(os.environ)
    return shutil.which("node") is not None and (web / "node_modules" / "zod").is_dir()


pytestmark = pytest.mark.skipif(
    not _reader_present() and not os.environ.get("CI"),
    reason="the web's reader needs node and web/node_modules (npm ci in web/)",
)


def _read(path: Path) -> Any:
    return json.loads(path.read_text())


def _context(run: Path, through: int) -> SeasonContext:
    """The fixture's slate, every club's games in the records through `through`, and his LAC lines."""
    slates = _read(run / "schedule.json")["slates"]
    games = {
        slate["abbr"]: [
            Game(g["week"], g["opponent"], g["home"], datetime.fromisoformat(g["kickoff"])) for g in slate["games"]
        ]
        for slate in slates
    }
    weeks = max(game.week for slate in games.values() for game in slate)
    byes = {
        club: next(w for w in range(1, weeks + 1) if all(g.week != w for g in slate)) for club, slate in games.items()
    }
    in_records = frozenset((club, g.week) for club, slate in games.items() for g in slate if g.week <= through)
    store = SeasonStore(
        lines={_PLAYER: dict.fromkeys(_FORMER_WEEKS, _LINE)},
        snaps={},
        teams={_PLAYER: dict.fromkeys(_FORMER_WEEKS, _FORMER_CLUB)},
        carried=dict.fromkeys(range(1, weeks + 1), _CARRIED),
        in_records=in_records,
    )
    # Lane 120: the list read the day after his week 6 game names DET, so the page is DET's and says
    # his newest line was LAC's.
    last = next(g.kickoff for g in games[_FORMER_CLUB] if g.week == max(_FORMER_WEEKS))
    roster = RosterRead({_PLAYER: _PAGE_CLUB}, last + timedelta(days=1))
    clubs = club_calls({_PLAYER: _PAGE_CLUB}, roster, store.teams, games)
    return SeasonContext(2026, weeks, through, games, byes, store, {}, clubs)


def _write_mover(root: Path) -> Json:
    """The fixture copied under `root`, his page's season the writer's block for the mover."""
    shutil.copytree(_FIXTURE / "runs" / _RUN, root / "runs" / _RUN)
    run = root / "runs" / _RUN
    page_path = run / "players" / f"{_PLAYER}.json"
    page = _read(page_path)
    assert page["team"] == _PAGE_CLUB
    context = _context(run, page["season"]["through"])
    season = season_block(_PLAYER, PAGE_FORMAT, "RB", context)
    elsewhere = last_game_club(context.clubs[_PLAYER])
    page_path.write_text(json.dumps({**page, "season": season, "lastGameClub": elsewhere}))
    index = [
        {**entry, "season": {"games": season["games"], "pointsPerGame": season["pointsPerGame"]}}
        if entry["id"] == _PLAYER
        else entry
        for entry in _read(run / "index.json")
    ]
    (run / "index.json").write_text(json.dumps(index))
    return season


def test_a_player_who_played_his_club_bye_week_for_another_club_passes_the_gate(tmp_path: Path) -> None:
    season = _write_mover(tmp_path)
    by_week = {row["week"]: row for row in season["log"]}
    # The writer's own rules: weeks 5 and 6 are LAC's games, week 6 is DET's bye, so the log has none.
    assert [by_week[w]["status"] for w in _FORMER_WEEKS] == ["played", "played"]
    assert (by_week[_CLUB_BYE]["opponent"], by_week[_CLUB_BYE]["home"]) == ("KC", False)
    assert not [row for row in season["log"] if row["status"] == "bye"]
    # Lane 120: his weeks before his first line name no opponent (the run cannot say whose he was).
    assert [(by_week[w]["opponent"], by_week[w]["status"]) for w in range(1, 5)] == [(None, "inactive")] * 4
    assert _read(tmp_path / "runs" / _RUN / "players" / f"{_PLAYER}.json")["lastGameClub"] == {
        "club": _FORMER_CLUB,
        "week": max(_FORMER_WEEKS),
    }
    record = schema_gate(tmp_path, _RUN, contract_dir(os.environ))
    assert record.passed, record.reasons
    assert "4 of 4 player pages parsed" in record.summary


def test_a_played_week_with_no_opponent_is_refused_by_the_gate(tmp_path: Path) -> None:
    _write_mover(tmp_path)
    page_path = tmp_path / "runs" / _RUN / "players" / f"{_PLAYER}.json"
    page = _read(page_path)
    week = max(_FORMER_WEEKS)
    log = [{**row, "opponent": None, "home": None} if row["week"] == week else row for row in page["season"]["log"]]
    page_path.write_text(json.dumps({**page, "season": {**page["season"], "log": log}}))
    record = schema_gate(tmp_path, _RUN, contract_dir(os.environ))
    assert not record.passed
    assert any(f"Week {week} is played but names no opponent" in r for r in record.reasons)


def test_a_bye_on_a_week_his_club_plays_is_refused_by_the_gate(tmp_path: Path) -> None:
    _write_mover(tmp_path)
    page_path = tmp_path / "runs" / _RUN / "players" / f"{_PLAYER}.json"
    page = _read(page_path)
    week = 7
    log = [
        {**row, "status": "bye", "opponent": None, "home": None} if row["week"] == week else row
        for row in page["season"]["log"]
    ]
    page_path.write_text(json.dumps({**page, "season": {**page["season"], "log": log}}))
    record = schema_gate(tmp_path, _RUN, contract_dir(os.environ))
    assert not record.passed
    assert any(f"has a bye in week {week}, but {_PAGE_CLUB} plays that week" in r for r in record.reasons)
