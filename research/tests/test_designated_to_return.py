"""A player designated to return is this week's question, not season-long (Lane 153, the Jordan Mason report).

The rule is pinned against the API's own cases (`api/testdata/designation-codes.json`). Through the status
read on a migrated scratch database (PARITY_DATABASE_URL, skipped without it): the hourly list holds four
players on injured reserve, the daily player list dates three of them, and the schedule's kickoffs set the
week. The Mason shape (back this Sunday) is questionable and dated, back next week stays season-long with
his day, a date already passed and no date leave him as he was. Through the week sheet: the returning
player's one sentence, he may play, and a read that keeps him out is refused.
"""

import json
import os
from dataclasses import replace
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any, Final

import pytest
from sqlalchemy import Engine, insert

from research.capsules.week.render import render_week_facts_block, render_week_sheet
from research.capsules.week.rules import week_rule_violations
from research.capsules.week.sheet import Status
from research.db.engine import make_engine
from research.db.schema import CAPTURE_SNAPSHOTS, TEAM_WEEK_OBSERVATIONS
from research.db.url import sqlalchemy_url
from research.model.designations import (
    NO_RETURN,
    RETURNING_LATER,
    RETURNING_STATUS,
    RETURNING_THIS_WEEK,
    returning_of,
)
from research.nightly.designations import PlayerStatus, StatusRead, designations_file, read_statuses, season_ids
from research.nightly.return_days import ListedReturn, return_day
from research.parity import databases
from research.pipeline.nflverse.schedule import ScheduleMetric, ScheduleSource
from research.tests.week_read_fixtures import REPORT, starter

_CODES: Final = Path(__file__).resolve().parents[2] / "api" / "testdata" / "designation-codes.json"
_READINGS: Final = {"none": NO_RETURN, "this_week": RETURNING_THIS_WEEK, "later": RETURNING_LATER}
_DATABASE: Final = "parity_test_designated_to_return"
Json = dict[str, Any]


def _day(text: str | None) -> date | None:
    return None if text is None else date.fromisoformat(text)


def test_the_return_rule_is_the_apis() -> None:
    shared = json.loads(_CODES.read_text())["returning"]
    assert shared["this_week_status"] == RETURNING_STATUS
    assert shared["cases"]
    for case in shared["cases"]:
        got = returning_of(case["status"], _day(case["returning"]), _day(case["last_game_day"]), _day(case["today"]))  # type: ignore[arg-type]
        assert got == _READINGS[case["reads"]], case["name"]


@pytest.mark.parametrize(
    ("entry", "status", "expected"),
    [
        (ListedReturn("Injured Reserve - Designated to Return", "20261025"), "injured_reserve", date(2026, 10, 25)),
        # The list names him under another status: its date is not his designation's.
        (ListedReturn("Q", "20261025"), "injured_reserve", None),
        # Earlier than the list's own Eastern day: a date the provider let pass.
        (ListedReturn("IR", "20261020"), "injured_reserve", None),
        (ListedReturn("IR", "2026-10-25"), "injured_reserve", None),
        (ListedReturn("IR", "20261341"), "injured_reserve", None),
        (None, "injured_reserve", None),
    ],
)
def test_a_return_date_reads_strictly(entry: ListedReturn | None, status: str, expected: date | None) -> None:
    # Oct 22, 7:30 pm Eastern (23:30 UTC), as the founder's report.
    assert return_day(entry, status, datetime(2026, 10, 22, 23, 30, tzinfo=UTC)) == expected


def _returning(day: date | None = date(2026, 10, 18)) -> Status:
    return Status(RETURNING_STATUS, REPORT, None, day, "injured_reserve")


def test_the_sheet_says_his_one_sentence_and_he_may_play() -> None:
    sheet = replace(starter(), status=_returning())
    assert sheet.may_start and sheet.can_play
    text = render_week_sheet(sheet)
    assert (
        "Injury report: Designated to return from injured reserve, expected back Sun Oct 18. "
        "He can play in week 6 of 2026."
    ) in text
    assert "cannot play" not in text and "not settled" not in text
    facts = dict(line.split(": ", 1) for line in render_week_facts_block(sheet).splitlines())
    assert facts["Status"] == "Designated to return from injured reserve, expected back Sun Oct 18"


def test_a_read_that_keeps_him_out_is_refused() -> None:
    sheet = replace(starter(), status=_returning())
    for sentence in ("He remains on injured reserve this week.", "Puka Nacua cannot play in week 6 of 2026."):
        found = [v for v in week_rule_violations(sentence, sheet) if "designated to return" in v]
        assert found, sentence
    honest = "He is designated to return from injured reserve, expected back Sunday."
    assert not [v for v in week_rule_violations(honest, sheet) if "designated to return this week out" in v]
    # A player still on the list is not held to it.
    listed = replace(starter(), status=Status("injured_reserve", REPORT))
    assert not [v for v in week_rule_violations("He cannot play.", listed) if "designated to return" in v]


def test_the_file_carries_the_day_only_when_the_read_dates_one() -> None:
    since = datetime(2026, 9, 22, 15, 0, tzinfo=UTC)
    read_at = datetime(2026, 10, 22, 23, 30, tzinfo=UTC)
    read = StatusRead(
        read_at,
        None,
        "tank01_injuries_by_date",
        {
            "mason": PlayerStatus(RETURNING_STATUS, False, None, date(2026, 10, 25), "injured_reserve"),
            "later": PlayerStatus("injured_reserve", True, since, date(2026, 11, 8)),
            "listed": PlayerStatus("injured_reserve", True, since),
        },
    )
    file = designations_file(read, ["mason", "later", "listed"])
    assert file["players"] == {
        "later": {
            "status": "injured_reserve",
            "seasonLong": True,
            "since": "2026-09-22T15:00:00.000Z",
            "returning": "2026-11-08",
        },
        "listed": {"status": "injured_reserve", "seasonLong": True, "since": "2026-09-22T15:00:00.000Z"},
        "mason": {"status": "questionable", "seasonLong": False, "since": None, "returning": "2026-10-25"},
    }
    # The build's set moves when he comes off the list.
    assert season_ids(file) == frozenset({"later", "listed"})


# THE READ, against a migrated scratch database.

_NOW: Final = datetime(2026, 10, 22, 23, 35, tzinfo=UTC)  # Thursday 7:35 pm Eastern


@pytest.fixture(scope="module")
def engine() -> Any:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    url = databases.build_with_alembic(_DATABASE)
    built = make_engine(sqlalchemy_url(url))
    try:
        yield built
    finally:
        built.dispose()
        databases.drop(_DATABASE)


def _player(player_id: str, code: str, day: str, inj_date: str = "") -> Json:
    return {
        "playerID": player_id,
        "longName": player_id,
        "injury": {"designation": code, "injReturnDate": day, "injDate": inj_date, "description": ""},
    }


def _seed(engine: Engine, player_list: list[Json]) -> None:
    by_date = {
        "injList": [
            {"playerID": p, "designation": "Injured Reserve - Designated to Return" if p == "mason" else "IR"}
            for p in ("mason", "next", "past", "none")
        ]
    }
    kickoffs = [
        # Week 8: Thursday Oct 22, Sunday Oct 25, Monday Oct 26 (its last game day). Week 9 from Oct 29.
        (8, "MIN", datetime(2026, 10, 25, 17, 0, tzinfo=UTC)),
        (8, "LAC", datetime(2026, 10, 23, 0, 15, tzinfo=UTC)),
        (8, "KC", datetime(2026, 10, 27, 0, 15, tzinfo=UTC)),
        (9, "MIN", datetime(2026, 11, 1, 18, 0, tzinfo=UTC)),
        (7, "MIN", datetime(2026, 10, 18, 17, 0, tzinfo=UTC)),
    ]
    with engine.begin() as conn:
        conn.execute(CAPTURE_SNAPSHOTS.delete())
        conn.execute(TEAM_WEEK_OBSERVATIONS.delete())
        conn.execute(
            insert(CAPTURE_SNAPSHOTS),
            [
                {"source": "tank01_injuries_by_date", "payload": by_date, "captured_at": _NOW, "digest": "a"},
                {
                    "source": "tank01_player_list",
                    "payload": player_list,
                    "captured_at": datetime(2026, 10, 22, 12, 0, tzinfo=UTC),
                    "digest": "b",
                },
            ],
        )
        conn.execute(
            insert(TEAM_WEEK_OBSERVATIONS),
            [
                {
                    "season": 2026,
                    "week": week,
                    "team": team,
                    "source": ScheduleSource.KICKOFF,
                    "metric": ScheduleMetric.KICKOFF_INSTANT,
                    "as_of": at,
                    "value": 1.0,
                }
                for week, team, at in kickoffs
            ],
        )


def test_the_read_makes_the_mason_shape_this_weeks_question(engine: Engine) -> None:
    _seed(
        engine,
        [
            _player("mason", "Injured Reserve - Designated to Return", "20261025", inj_date="20260922"),
            _player("next", "IR", "20261101"),
            # Passed by Thursday night, the list's own day before it: never his return.
            _player("past", "IR", "20261019", inj_date="20261025"),
            _player("none", "IR", "", inj_date="20261025"),
            _player("healthy", "", ""),
        ],
    )
    with engine.connect() as conn:
        read = read_statuses(conn, now=_NOW)
    assert read is not None
    assert dict(read.players) == {
        "mason": PlayerStatus(RETURNING_STATUS, False, None, date(2026, 10, 25), "injured_reserve"),
        "next": PlayerStatus("injured_reserve", True, None, date(2026, 11, 1)),
        "past": PlayerStatus("injured_reserve", True, None),
        "none": PlayerStatus("injured_reserve", True, None),
    }
    # On Tuesday after week 8's games, Oct 25 has passed: he reads as listed again, his day said nothing.
    with engine.connect() as conn:
        tuesday = read_statuses(conn, now=datetime(2026, 10, 27, 14, 0, tzinfo=UTC))
    assert tuesday is not None and tuesday.players["mason"] == PlayerStatus("injured_reserve", True, None)
    # On the Saturday of week 7 his Sunday is the next week's: still on the list, his day carried.
    with engine.connect() as conn:
        earlier = read_statuses(conn, now=datetime(2026, 10, 17, 18, 0, tzinfo=UTC))
    assert earlier is not None
    assert earlier.players["mason"] == PlayerStatus("injured_reserve", True, None, date(2026, 10, 25))


def test_a_player_list_that_does_not_read_leaves_the_statuses_undated(engine: Engine) -> None:
    _seed(engine, {"not": "a list"})  # type: ignore[arg-type]
    with engine.connect() as conn:
        read = read_statuses(conn, now=_NOW)
    assert read is not None
    assert read.players["mason"] == PlayerStatus("injured_reserve", True, None)
