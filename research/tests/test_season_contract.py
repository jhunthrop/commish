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

Lane 135: run 2026-10-22T05 failed its schema gate on Josiah Deguara, whose newest line (PHI, week 4)
was a special-teams game: a club edge and a usage row of zeros, no stat line and no offensive snap, so
his log reads that week inactive under PHI's opponent while his page says the line was PHI's. The reader
required a played week. The mover here now also plays his newest line's week that way, and a free agent
(Lane 123: the list read after his last game names no club) goes through the same writer and gate.

It needs node and the web's dependencies (`npm ci` in `web/`); CI installs them, so there it never
skips.
"""

import json
import os
import shutil
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Final

import pytest

from research.free_agent import FREE_AGENT_CLUB, run_club
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


@dataclass(frozen=True, slots=True)
class Mover:
    """His LAC weeks as the store holds them, and the club the list read after his last one names."""

    lines: Mapping[int, Mapping[str, float]]
    snaps: Mapping[int, Mapping[str, float]]
    listed: str | None


_PLAYED_BOTH: Final = Mover(dict.fromkeys(_FORMER_WEEKS, _LINE), {}, _PAGE_CLUB)
# Lane 135: his week 5 for LAC on special teams only, as the store held Deguara's PHI week 4: the usage
# ingest's zeros and his club's totals, a snap row with no offensive snap, and no stat line.
_SPECIAL_TEAMS: Final = {"carries": 0.0, "targets": 0.0, "pass_attempts": 0.0, "team_carries": 27.0}
_NO_OFFENSIVE_SNAP: Final = {"offensive_snaps": 0.0, "team_offensive_snaps": 61.0}
_SPECIAL_TEAMS_LAST: Final = Mover({4: _LINE, 5: _SPECIAL_TEAMS}, {5: _NO_OFFENSIVE_SNAP}, _PAGE_CLUB)


def _context(run: Path, through: int, mover: Mover) -> SeasonContext:
    """The fixture's slate, every club's games in the records through `through`, and his LAC weeks."""
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
        lines={_PLAYER: {week: dict(line) for week, line in mover.lines.items()}},
        snaps={_PLAYER: {week: dict(snap) for week, snap in mover.snaps.items()}},
        teams={_PLAYER: dict.fromkeys(mover.lines, _FORMER_CLUB)},
        carried=dict.fromkeys(range(1, weeks + 1), _CARRIED),
        in_records=in_records,
    )
    # Lane 120: the list read two days after his newest line's game names DET (or, Lane 123, no club), so the
    # page is that club's and says his newest line was LAC's.
    last = next(g.kickoff for g in games[_FORMER_CLUB] if g.week == max(mover.lines))
    roster = RosterRead({_PLAYER: mover.listed}, last + timedelta(days=2))
    clubs = club_calls({_PLAYER: _PAGE_CLUB}, roster, store.teams, games)
    return SeasonContext(2026, weeks, through, games, byes, store, {}, clubs)


def _write_mover(root: Path, mover: Mover = _PLAYED_BOTH) -> Json:
    """The fixture copied under `root`, his page's club and season the writer's for the mover."""
    shutil.copytree(_FIXTURE / "runs" / _RUN, root / "runs" / _RUN)
    run = root / "runs" / _RUN
    page_path = run / "players" / f"{_PLAYER}.json"
    page = _read(page_path)
    assert page["team"] == _PAGE_CLUB
    context = _context(run, page["season"]["through"], mover)
    season = season_block(_PLAYER, PAGE_FORMAT, "RB", context)
    call = context.clubs[_PLAYER]
    team = run_club(call.club)
    page_path.write_text(json.dumps({**page, "team": team, "season": season, "lastGameClub": last_game_club(call)}))
    index = [
        {**entry, "team": team, "season": {"games": season["games"], "pointsPerGame": season["pointsPerGame"]}}
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


def test_a_newest_line_on_special_teams_only_passes_the_gate(tmp_path: Path) -> None:
    """Lane 135, the night's refusal: his page says his week 5 line was LAC's, and his log reads that week
    inactive under LAC's opponent, because the line has no stat and no offensive snap."""
    season = _write_mover(tmp_path, _SPECIAL_TEAMS_LAST)
    by_week = {row["week"]: row for row in season["log"]}
    assert (by_week[4]["status"], by_week[5]["status"]) == ("played", "inactive")
    assert (by_week[5]["opponent"], by_week[5]["home"]) == ("DEN", True)
    page = _read(tmp_path / "runs" / _RUN / "players" / f"{_PLAYER}.json")
    assert (page["team"], page["lastGameClub"]) == (_PAGE_CLUB, {"club": _FORMER_CLUB, "week": 5})
    record = schema_gate(tmp_path, _RUN, contract_dir(os.environ))
    assert record.passed, record.reasons
    assert "4 of 4 player pages parsed" in record.summary


def test_a_free_agent_after_his_last_line_passes_the_gate(tmp_path: Path) -> None:
    """Lane 123 through the writer: the list read after his week 6 game names no club, so his page is FA,
    names no game after his last line, and says that line was LAC's."""
    season = _write_mover(tmp_path, Mover(dict.fromkeys(_FORMER_WEEKS, _LINE), {}, None))
    page = _read(tmp_path / "runs" / _RUN / "players" / f"{_PLAYER}.json")
    assert (page["team"], page["lastGameClub"]) == (FREE_AGENT_CLUB, {"club": _FORMER_CLUB, "week": 6})
    after = [row for row in season["log"] if row["week"] > max(_FORMER_WEEKS)]
    assert after
    assert {(row["status"], row["opponent"]) for row in after} == {("inactive", None)}
    record = schema_gate(tmp_path, _RUN, contract_dir(os.environ))
    assert record.passed, record.reasons
    assert "4 of 4 player pages parsed" in record.summary


def test_a_last_game_club_on_a_week_that_is_not_its_game_is_refused_by_the_gate(tmp_path: Path) -> None:
    """The reader still holds the page to a week his log shows as that club's game."""
    _write_mover(tmp_path, _SPECIAL_TEAMS_LAST)
    page_path = tmp_path / "runs" / _RUN / "players" / f"{_PLAYER}.json"
    page = _read(page_path)
    page_path.write_text(json.dumps({**page, "lastGameClub": {"club": _FORMER_CLUB, "week": 3}}))
    record = schema_gate(tmp_path, _RUN, contract_dir(os.environ))
    assert not record.passed
    refusal = f"week 3 line was for {_FORMER_CLUB}, but his log has no {_FORMER_CLUB} game that week"
    assert any(refusal in r for r in record.reasons)
