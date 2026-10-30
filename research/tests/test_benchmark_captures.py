"""The two benchmarks captured per kickoff slot: the slots themselves, Tank01's weekly projection
parsed per player (`testdata/tank01/projections-2026-week-1.json`, eight players and one team defense
of the one stored snapshot), and The Odds API's anytime-touchdown market (`testdata/odds/`, recorded 2026-10-16: the
event list and HOU at JAX in London, 2026-10-18)."""

import json
import os
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Final
from urllib.parse import parse_qs
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import Connection, Engine, delete, func, insert, select, text

from research.db.engine import make_engine
from research.db.schema import (
    CAPTURE_CHECKS,
    CAPTURE_SNAPSHOTS,
    PLAYER_TD_PROP_OBSERVATIONS,
    TANK01_PROJECTION_ROWS,
    TEAM_WEEK_OBSERVATIONS,
)
from research.db.url import sqlalchemy_url
from research.errors import SchemaDriftError
from research.parity import databases
from research.pipeline.budget import UnmeteredBudget
from research.pipeline.http import HttpResponse
from research.pipeline.kickoff_slots import LEAD, due_slot, kickoff_slots, slot_name, slot_of
from research.pipeline.kickoffs import TeamKickoff, stored_kickoffs
from research.pipeline.odds import touchdowns
from research.pipeline.tank01 import projections
from research.pipeline.tank01.capture import (
    CAPTURE_FEEDS,
    CaptureContext,
    CapturePass,
    CaptureResult,
    FeedOutcome,
    capture_once,
    record_checks,
    run_capture_harvest,
)
from research.pipeline.tank01.client import Paths, Tank01Client

TESTDATA: Final = Path(__file__).resolve().parent / "testdata"
_EVENT: Final = "57418b2cf5aca558b3c98eafac1e264a"
_DATABASE = "parity_test_benchmark_captures"


def _at(day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 10, day, hour, minute, tzinfo=UTC)


# A recording that lands after the fixture's own rows, whose `ingested_at` is the database's now() at insert: a
# fixed instant aged past it at 2026-10-30 00:00 UTC and the rescheduled kickoff stopped being the latest.
_RECORDED_AFTER_THE_FIXTURE: Final = datetime.now(UTC) + timedelta(days=1)


# Week 6 of 2026 from Sunday as stored (London in the morning, early, late and night, Monday), and week 7 Thursday.
KICKOFFS: Final = [
    TeamKickoff(2026, 7, "PIT", _at(23, 0, 15)),
    TeamKickoff(2026, 7, "CIN", _at(23, 0, 15)),
    TeamKickoff(2026, 6, "JAX", _at(18, 13, 30)),
    TeamKickoff(2026, 6, "HOU", _at(18, 13, 30)),
    TeamKickoff(2026, 6, "CHI", _at(18, 17)),
    TeamKickoff(2026, 6, "NO", _at(18, 17)),
    TeamKickoff(2026, 6, "LAC", _at(18, 20, 5)),
    TeamKickoff(2026, 6, "KC", _at(19, 0, 20)),
    TeamKickoff(2026, 6, "DET", _at(20, 0, 15)),
]


def test_a_week_has_its_slots_by_new_york_day_and_sunday_window() -> None:
    slots = kickoff_slots([k for k in KICKOFFS if k.week == 6])  # noqa: PLR2004 - week 6
    assert [(s.name, s.first_kickoff, s.last_kickoff) for s in slots] == [
        ("sunday-morning", _at(18, 13, 30), _at(18, 13, 30)),
        ("sunday-early", _at(18, 17), _at(18, 17)),
        ("sunday-late", _at(18, 20, 5), _at(19, 0, 20)),
        ("monday", _at(20, 0, 15), _at(20, 0, 15)),
    ]
    # Thursday 20:15 New York is Friday 00:15 UTC.
    assert slot_name(_at(23, 0, 15)) == "thursday"


def test_a_slot_is_due_in_the_lead_before_its_first_kickoff() -> None:
    slots = kickoff_slots(KICKOFFS)
    assert due_slot(slots, _at(18, 13, 30) - LEAD) is not None
    assert due_slot(slots, _at(18, 13, 29)).name == "sunday-morning"  # type: ignore[union-attr]
    assert due_slot(slots, _at(18, 13, 30)) is None
    assert due_slot(slots, _at(18, 10)) is None


def _projections() -> object:
    return json.loads((TESTDATA / "tank01/projections-2026-week-1.json").read_text())


def test_each_projected_player_is_a_row_with_his_points_and_stats() -> None:
    captured = datetime(2026, 9, 9, 0, 53, tzinfo=UTC)
    rows = {r["provider_player_id"]: r for r in projections.parse_projection_snapshot(_projections(), 41, captured)}
    assert len(rows) == 9  # noqa: PLR2004 - the fixture's eight players and one defense
    rodgers = rows["8439"]
    assert (rodgers["position"], rodgers["team"], rodgers["season"], rodgers["week"]) == ("QB", "PIT", 2026, 1)
    assert (rodgers["ppr_points"], rodgers["pass_yards"], rodgers["pass_touchdowns"]) == (15.76, 230.0, 1.7)
    kicker = rows["10621"]
    assert (kicker["position"], kicker["pass_yards"], kicker["ppr_points"]) == ("PK", None, 6.0)


def test_a_team_defense_is_a_row_with_its_one_figure_in_every_format() -> None:
    captured = datetime(2026, 9, 9, 0, 53, tzinfo=UTC)
    rows = {r["provider_player_id"]: r for r in projections.parse_projection_snapshot(_projections(), 41, captured)}
    defense = rows[projections.defense_player_id("ARI")]
    assert (defense["position"], defense["team"], defense["season"], defense["week"]) == ("DEF", "ARI", 2026, 1)
    assert (defense["ppr_points"], defense["half_points"], defense["standard_points"]) == (7.0, 7.0, 7.0)
    assert defense["pass_yards"] is None
    assert defense["fumbles_lost"] is None


def test_a_defense_without_its_figure_is_refused_and_a_payload_without_defenses_has_none() -> None:
    payload = _projections()
    assert isinstance(payload, dict)
    del payload["teamDefenseProjections"]["1"]["fantasyPointsDefault"]
    with pytest.raises(SchemaDriftError, match=r"teamDefenseProjections\.1\.fantasyPointsDefault"):
        projections.parse_projection_snapshot(payload, 41, datetime(2026, 9, 9, tzinfo=UTC))
    del payload["teamDefenseProjections"]
    rows = projections.parse_projection_snapshot(payload, 41, datetime(2026, 9, 9, tzinfo=UTC))
    assert all(r["position"] != projections.DEFENSE_POSITION for r in rows)


def test_a_player_without_points_is_refused() -> None:
    payload = _projections()
    assert isinstance(payload, dict)
    del payload["playerProjections"]["8439"]["fantasyPointsDefault"]
    with pytest.raises(SchemaDriftError, match="fantasyPointsDefault"):
        projections.parse_projection_snapshot(payload, 41, datetime(2026, 9, 9, tzinfo=UTC))


def _td() -> object:
    return json.loads((TESTDATA / f"odds/event-{_EVENT}-player_anytime_td.json").read_text())


def test_every_book_quotes_a_yes_price_per_player() -> None:
    fetched = datetime(2026, 10, 16, 21, 3, tzinfo=UTC)
    parsed = touchdowns.parse_td_response(_td(), fetched)
    payload = _td()
    assert isinstance(payload, dict)
    expected = sum(len(m["outcomes"]) for b in payload["bookmakers"] for m in b["markets"])
    assert len(parsed.observations) == expected and parsed.skipped == 0
    first = parsed.observations[0]
    assert (first.bookmaker, first.player_name, first.yes_price, first.no_price) == (
        "draftkings",
        "Woody Marks",
        120,
        None,
    )
    assert first.commence_time == datetime(2026, 10, 18, 13, 30, tzinfo=UTC)


def test_the_three_region_answer_quotes_no_no_price() -> None:
    """Recorded 2026-10-16 for HOU at JAX across us, us2 and eu: 14 books, all US, Yes prices only."""
    payload = json.loads((TESTDATA / f"odds/event-{_EVENT}-player_anytime_td-us-us2-eu.json").read_text())
    parsed = touchdowns.parse_td_response(payload, datetime(2026, 10, 16, 21, 30, tzinfo=UTC))
    assert len({o.bookmaker for o in parsed.observations}) == 14  # noqa: PLR2004 - the recorded books
    assert all(o.no_price is None for o in parsed.observations)


def test_an_unknown_market_or_side_is_refused() -> None:
    payload = _td()
    assert isinstance(payload, dict)
    payload["bookmakers"][0]["markets"][0]["outcomes"][0]["name"] = "Over"
    with pytest.raises(SchemaDriftError, match='expected "Yes" or "No"'):
        touchdowns.parse_td_response(payload, datetime(2026, 10, 16, tzinfo=UTC))
    payload = _td()
    assert isinstance(payload, dict)
    payload["bookmakers"][0]["markets"][0]["key"] = "player_pass_tds"
    with pytest.raises(SchemaDriftError, match="unknown market"):
        touchdowns.parse_td_response(payload, datetime(2026, 10, 16, tzinfo=UTC))


@dataclass
class OddsFetcher:
    """The recorded event list and London's market; any other event odds request is refused."""

    requested: list[str] = field(default_factory=list)

    def get(self, url: str, headers: Mapping[str, str] | None = None) -> HttpResponse:
        self.requested.append(url.split("?", maxsplit=1)[0])
        credits = {"x-requests-remaining": "99684", "x-requests-used": "316"}
        if url.split("?", maxsplit=1)[0].endswith("/events"):
            return HttpResponse(200, (TESTDATA / "odds/events.json").read_bytes(), credits)
        if f"/events/{_EVENT}/odds" in url:
            return HttpResponse(200, (TESTDATA / f"odds/event-{_EVENT}-player_anytime_td.json").read_bytes(), credits)
        raise AssertionError(f"an event outside the slot was requested: {url.split('?', maxsplit=1)[0]}")

    def stream(self, url: str, headers: Mapping[str, str] | None = None) -> tuple[int, Iterator[bytes]]:
        raise AssertionError("never streams")


@pytest.fixture(scope="module")
def engine() -> Any:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    url = databases.build_with_alembic(_DATABASE)
    built = make_engine(sqlalchemy_url(url))
    try:
        with built.begin() as conn:
            conn.execute(
                insert(TEAM_WEEK_OBSERVATIONS),
                [
                    {"season": 2026, "week": k.week, "team": k.team, "source": "nflverse_kickoff",
                     "metric": "kickoff_instant", "value": 1.0, "as_of": k.at}
                    for k in KICKOFFS
                ],
            )  # fmt: skip
        yield built
    finally:
        built.dispose()
        databases.drop(_DATABASE)


def test_the_touchdown_market_is_taken_once_per_slot_for_the_slots_events(engine: Engine) -> None:
    fetcher = OddsFetcher()
    now = _at(18, 12)
    with engine.begin() as conn:
        first = touchdowns.run_td_snapshot(conn, fetcher, "key", 2026, now)
        again = touchdowns.run_td_snapshot(conn, fetcher, "key", 2026, now + timedelta(minutes=60))
        stored = conn.execute(select(func.count()).select_from(PLAYER_TD_PROP_OBSERVATIONS)).scalar_one()
        idle = touchdowns.run_td_snapshot(conn, fetcher, "key", 2026, _at(17, 12))
    assert first.slot is not None and first.slot.name == "sunday-morning"
    assert first.events == 1 and first.written == stored > 0
    assert "99684 credits left this month" in first.line()
    assert again.slot is None and idle.slot is None
    assert len(fetcher.requested) == 2  # noqa: PLR2004 - the list and the one London event, once


def test_the_harvest_window_captures_the_slots_projection_and_every_snapshot_is_parsed(engine: Engine) -> None:
    with engine.begin() as conn:
        now = _at(22, 23)  # Thursday 19:00 New York: Thursday night's window
        slot = projections.projection_slot_due(conn, 2026, now)
        assert slot is not None and (slot.week, slot.name) == (7, "thursday")
        conn.execute(
            text(
                f"insert into {CAPTURE_SNAPSHOTS.fullname} (source, captured_at, digest, payload) "
                "values (:source, :at, 'd', cast(:payload as jsonb))"
            ),
            {"source": projections.PROJECTIONS_SOURCE, "at": now, "payload": json.dumps(_projections())},
        )
        assert projections.projection_slot_due(conn, 2026, now + timedelta(minutes=30)) is None
        parsed = projections.parse_stored_projections(conn)
        again = projections.parse_stored_projections(conn)
        rows = conn.execute(select(func.count()).select_from(TANK01_PROJECTION_ROWS)).scalar_one()
    assert (parsed.snapshots, parsed.rows, rows) == (1, 9, 9)
    assert (again.snapshots, again.rows) == (0, 0)


def test_a_snapshot_parsed_before_defenses_were_kept_gains_them_once(engine: Engine) -> None:
    with engine.begin() as conn:
        snapshot = conn.execute(
            text(
                f"insert into {CAPTURE_SNAPSHOTS.fullname} (source, captured_at, digest, payload) "
                "values (:source, :at, 'd', cast(:payload as jsonb)) returning id"
            ),
            {"source": projections.PROJECTIONS_SOURCE, "at": _at(16, 20), "payload": json.dumps(_projections())},
        ).scalar_one()
        players_only = [
            row
            for row in projections.parse_projection_snapshot(_projections(), snapshot, _at(16, 20))
            if row["position"] != projections.DEFENSE_POSITION
        ]
        conn.execute(insert(TANK01_PROJECTION_ROWS), players_only)
        parsed = projections.parse_stored_projections(conn)
        again = projections.parse_stored_projections(conn)
        defenses = conn.execute(
            select(func.count())
            .select_from(TANK01_PROJECTION_ROWS)
            .where(TANK01_PROJECTION_ROWS.c.position == projections.DEFENSE_POSITION)
            .where(TANK01_PROJECTION_ROWS.c.snapshot_id == snapshot)
        ).scalar_one()
    assert (parsed.snapshots, parsed.rows, defenses) == (1, 1, 1)
    assert (again.snapshots, again.rows) == (0, 0)


def test_an_event_belongs_to_its_nearest_slot_within_three_hours() -> None:
    slots = kickoff_slots(KICKOFFS)
    monday = slot_of(slots, _at(20, 0, 25))  # the provider's start ten minutes off nflverse's
    assert monday is not None and monday.name == "monday"
    late = slot_of(slots, _at(18, 20, 25))
    assert late is not None and late.name == "sunday-late"
    assert slot_of(slots, _at(21, 12)) is None


def test_a_refused_snapshot_is_its_own_line_and_the_capture_stands(engine: Engine) -> None:
    broken = _projections()
    assert isinstance(broken, dict)
    broken["playerProjections"]["8439"]["team"] = ""
    insert_snapshot = text(
        f"insert into {CAPTURE_SNAPSHOTS.fullname} (source, captured_at, digest, payload) "
        "values (:source, :at, 'd', cast(:payload as jsonb))"
    )
    with engine.begin() as conn:
        conn.execute(insert_snapshot, {"source": "tank01_news", "at": _at(16, 20), "payload": "[]"})
        conn.execute(
            insert_snapshot,
            {"source": projections.PROJECTIONS_SOURCE, "at": _at(16, 20), "payload": json.dumps(broken)},
        )
        report = projections.parse_stored_projections(conn)
        news = conn.execute(
            select(func.count()).select_from(CAPTURE_SNAPSHOTS).where(CAPTURE_SNAPSHOTS.c.source == "tank01_news")
        ).scalar_one()
    assert len(report.refused) == 1 and "playerProjections.8439.team" in report.refused[0]
    assert "FAILED" in report.line()
    assert news == 1


def test_a_rescheduled_game_takes_its_latest_recorded_kickoff(engine: Engine) -> None:
    with engine.begin() as conn:
        conn.execute(
            insert(TEAM_WEEK_OBSERVATIONS).values(
                season=2026, week=6, team="CHI", source="nflverse_kickoff", metric="kickoff_instant", value=1.0,
                as_of=_at(18, 20, 25), ingested_at=_RECORDED_AFTER_THE_FIXTURE,
            )
        )  # fmt: skip
        chicago = [k.at for k in stored_kickoffs(conn, 2026) if k.team == "CHI"]
        conn.execute(
            text("delete from research.team_week_observations where team = 'CHI' and as_of = :at"),
            {"at": _at(18, 20, 25)},
        )
    assert chicago == [_at(18, 20, 25)]


# The week ahead's daily read (Lane 97, B68). Week 6's last game is Monday 20:15 New York (Tuesday
# 00:15 UTC), week 7's first is Thursday 20:15 New York; New York is four hours behind UTC in October.
def _eastern(day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 10, day, hour, minute, tzinfo=ZoneInfo("America/New_York"))


def test_the_week_ahead_is_read_once_a_day_from_tuesday_until_its_first_kickoff() -> None:
    due = projections.daily_capture_due
    assert due(KICKOFFS, _eastern(20, 5, 59)) is None  # Tuesday before 06:00
    assert due(KICKOFFS, _eastern(20, 6)) == projections.DailyCapture(7, _eastern(20, 6))
    assert due(KICKOFFS, _eastern(21, 23)) == projections.DailyCapture(7, _eastern(21, 6))
    assert due(KICKOFFS, _eastern(22, 6)) == projections.DailyCapture(7, _eastern(22, 6))
    assert due(KICKOFFS, _eastern(22, 20, 14)) == projections.DailyCapture(7, _eastern(22, 6))
    assert due(KICKOFFS, _eastern(22, 20, 15)) is None  # the week's first kickoff: the slots take over
    assert due(KICKOFFS, _eastern(19, 10)) is None  # Monday: week 6 is under way
    assert due(KICKOFFS, _eastern(19, 21)) is None  # after Monday's kickoff, still Monday
    assert due([], _eastern(20, 6)) is None


def test_a_week_without_a_thursday_game_is_read_from_tuesday_to_its_first_game() -> None:
    sunday_first = [*(k for k in KICKOFFS if k.week == 6), TeamKickoff(2026, 7, "PIT", _eastern(25, 13))]  # noqa: PLR2004
    due = projections.daily_capture_due
    assert due(sunday_first, _eastern(20, 6)) == projections.DailyCapture(7, _eastern(20, 6))
    assert due(sunday_first, _eastern(23, 9)) == projections.DailyCapture(7, _eastern(23, 6))
    assert due(sunday_first, _eastern(25, 12)) == projections.DailyCapture(7, _eastern(25, 6))
    assert due(sunday_first, _eastern(25, 13)) is None


def test_a_week_with_no_week_before_it_opens_six_days_before_its_first_kickoff_day() -> None:
    opener = [TeamKickoff(2026, 1, "SEA", datetime(2026, 9, 10, 20, 20, tzinfo=ZoneInfo("America/New_York")))]
    due = projections.daily_capture_due
    friday = datetime(2026, 9, 4, 6, tzinfo=ZoneInfo("America/New_York"))
    assert due(opener, friday - timedelta(minutes=1)) is None
    assert due(opener, friday) == projections.DailyCapture(1, friday)
    assert due(opener, datetime(2026, 8, 1, 12, tzinfo=UTC)) is None  # the offseason reads nothing


@dataclass
class Tank01Fetcher:
    """Every harvest feed answers an empty body; the projections feed answers the week asked for, or
    `answer` (an HTTP status and the whole response) while one is set."""

    weeks: list[str] = field(default_factory=list)
    answer: tuple[int, object] | None = None

    def get(self, url: str, headers: Mapping[str, str] | None = None) -> HttpResponse:
        path, _, query = url.partition("?")
        body: object = []
        if path.endswith(Paths.PROJECTIONS):
            week = parse_qs(query)["week"][0]
            self.weeks.append(week)
            if self.answer is not None:
                return HttpResponse(self.answer[0], json.dumps(self.answer[1]).encode(), {})
            payload = _projections()
            assert isinstance(payload, dict)
            body = {**payload, "week": week}
        return HttpResponse(200, json.dumps({"statusCode": 200, "body": body}).encode(), {})

    def stream(self, url: str, headers: Mapping[str, str] | None = None) -> tuple[int, Iterator[bytes]]:
        raise AssertionError("never streams")


def _clear_projection_reads(conn: Connection) -> None:
    conn.execute(delete(TANK01_PROJECTION_ROWS))
    conn.execute(delete(CAPTURE_SNAPSHOTS).where(CAPTURE_SNAPSHOTS.c.source == projections.PROJECTIONS_SOURCE))
    conn.execute(delete(CAPTURE_CHECKS))


def test_the_harvest_reads_the_week_ahead_once_a_day_and_an_unchanged_read_keeps_the_earlier(engine: Engine) -> None:
    fetcher = Tank01Fetcher()
    client = Tank01Client(fetcher, "key")
    passes = [_eastern(20, 2), _eastern(20, 6), _eastern(20, 7), _eastern(21, 6), _eastern(21, 7), _eastern(22, 6)]
    with engine.connect() as conn:
        _clear_projection_reads(conn)
        asked = []
        for at in passes:
            before = len(fetcher.weeks)
            run_capture_harvest(conn, client, at, 2026)
            asked.append(fetcher.weeks[before:])
        thursday_slot = projections.projection_week_due(conn, 2026, _eastern(22, 19))
        parsed = projections.parse_stored_projections(conn)
        week_rows = (
            conn.execute(
                select(TANK01_PROJECTION_ROWS.c.captured_at)
                .where(TANK01_PROJECTION_ROWS.c.week == 7)  # noqa: PLR2004 - week 7
                .distinct()
            )
            .scalars()
            .all()
        )
        conn.rollback()
    assert asked == [[], ["7"], [], ["7"], [], ["7"]]
    # Wednesday's and Thursday's reads equal Tuesday's: no new snapshot, Tuesday's stands at its captured_at.
    assert week_rows == [_eastern(20, 6)]
    assert parsed.snapshots == 1
    assert thursday_slot == projections.ProjectionRead(7, ahead=False)  # the slot reads the week in its window


def test_a_changed_projection_is_kept_each_day_and_another_weeks_read_never_counts(engine: Engine) -> None:
    insert_snapshot = text(
        f"insert into {CAPTURE_SNAPSHOTS.fullname} (source, captured_at, digest, payload) "
        "values (:source, :at, :digest, cast(:payload as jsonb))"
    )
    payload = _projections()
    assert isinstance(payload, dict)

    def read(conn: Connection, at: datetime, week: str) -> None:
        row = {"source": projections.PROJECTIONS_SOURCE, "at": at, "digest": f"{week}-{at.isoformat()}"}
        conn.execute(insert_snapshot, {**row, "payload": json.dumps({**payload, "week": week})})
        record_checks(conn, [FeedOutcome(projections.PROJECTIONS_SOURCE, "captured", 1)], at)

    with engine.connect() as conn:
        _clear_projection_reads(conn)
        read(conn, _eastern(20, 6, 30), "6")  # a week 6 read after 06:00 (an operator's full pass)
        after_another_week = projections.projection_week_due(conn, 2026, _eastern(20, 7))
        read(conn, _eastern(20, 7), "7")
        after_its_read = projections.projection_week_due(conn, 2026, _eastern(20, 8))
        next_day = projections.projection_week_due(conn, 2026, _eastern(21, 6))
        read(conn, _eastern(21, 6), "7")
        parsed = projections.parse_stored_projections(conn)
        kept = conn.execute(
            select(func.count(func.distinct(TANK01_PROJECTION_ROWS.c.captured_at))).where(
                TANK01_PROJECTION_ROWS.c.week == 7  # noqa: PLR2004 - week 7
            )
        ).scalar_one()
        conn.rollback()
    ahead = projections.ProjectionRead(7, ahead=True)
    assert (after_another_week, after_its_read, next_day) == (ahead, None, ahead)
    assert (parsed.snapshots, kept) == (3, 2)


# On the daily read, "not published yet" is a 404, an `error` envelope, an entirely empty body, or the
# week with its player map present and empty: never stored, so nothing can poison a later pass. Drift is
# a non-empty payload without the player map, or one that is not an object: stored and refused.
_UNPUBLISHED_ANSWERS: Final = [
    pytest.param((404, {"statusCode": 404}), id="404"),
    pytest.param((200, {"statusCode": 200, "error": "No projections for week 7"}), id="error-envelope"),
    pytest.param((200, {"statusCode": 200, "body": {}}), id="empty-object"),
    pytest.param((200, {"statusCode": 200, "body": []}), id="empty-list"),
    pytest.param((200, {"statusCode": 200, "body": ""}), id="empty-string"),
    pytest.param((200, {"statusCode": 200, "body": {"season": "2026", "week": "7", "playerProjections": {}}}), id="empty-map"),
    pytest.param((200, {"statusCode": 200, "body": {"season": "2026", "week": "7", "playerProjections": []}}), id="empty-list-map"),
]  # fmt: skip
_DRIFT_ANSWERS: Final = [
    pytest.param({"season": "2026", "week": "7", "projections": {}}, id="missing-map"),
    pytest.param({"season": "2026", "week": "7"}, id="no-map-key"),
    pytest.param(["not", "an", "object"], id="non-object-list"),
    pytest.param("not an object", id="non-object-string"),
]
_EMPTY_BODIES: Final = [pytest.param({}, id="{}"), pytest.param([], id="[]"), pytest.param("", id='""')]


def _count(conn: Connection, table: Any) -> int:
    query = select(func.count()).select_from(table).where(table.c.source == projections.PROJECTIONS_SOURCE)
    return int(conn.execute(query).scalar_one())


def _outcome(result: CaptureResult) -> FeedOutcome:
    (outcome,) = [f for f in result.feeds if f.source == projections.PROJECTIONS_SOURCE]
    return outcome


@pytest.mark.parametrize("answer", _UNPUBLISHED_ANSWERS)
def test_a_week_ahead_not_published_yet_is_no_failure_no_snapshot_and_no_read(
    engine: Engine, answer: tuple[int, object]
) -> None:
    fetcher = Tank01Fetcher(answer=answer)
    client = Tank01Client(fetcher, "key")
    with engine.connect() as conn:
        _clear_projection_reads(conn)
        tuesday = run_capture_harvest(conn, client, _eastern(20, 6), 2026)
        stored, checked = _count(conn, CAPTURE_SNAPSHOTS), _count(conn, CAPTURE_CHECKS)
        fetcher.answer = None  # published by the next hour
        next_hour = run_capture_harvest(conn, client, _eastern(20, 7), 2026)
        parsed = projections.parse_stored_projections(conn)
        conn.rollback()
    assert (_outcome(tuesday).status, _outcome(tuesday).reason) == ("unpublished", "week 7 not published yet")
    assert not [f for f in tuesday.feeds if f.status == "failed"]  # the pass's verdict: no failure
    assert (stored, checked) == (0, 0)
    assert fetcher.weeks == ["7", "7"]  # the next hour tries again
    assert _outcome(next_hour).status == "captured"
    assert (parsed.snapshots, parsed.refused) == (1, ())


@pytest.mark.parametrize("body", _DRIFT_ANSWERS)
def test_drift_on_the_daily_read_is_stored_and_refused(engine: Engine, body: object) -> None:
    fetcher = Tank01Fetcher(answer=(200, {"statusCode": 200, "body": body}))
    with engine.connect() as conn:
        _clear_projection_reads(conn)
        result = run_capture_harvest(conn, Tank01Client(fetcher, "key"), _eastern(20, 6), 2026)
        stored = _count(conn, CAPTURE_SNAPSHOTS)
        parsed = projections.parse_stored_projections(conn)
        conn.rollback()
    assert (_outcome(result).status, stored) == ("captured", 1)
    assert len(parsed.refused) == 1 and "FAILED" in parsed.line()


def test_drift_on_the_slot_read_is_stored_and_refused(engine: Engine) -> None:
    fetcher = Tank01Fetcher(answer=(200, {"statusCode": 200, "body": {"season": "2026", "week": "7"}}))
    with engine.connect() as conn:
        _clear_projection_reads(conn)
        result = run_capture_harvest(conn, Tank01Client(fetcher, "key"), _eastern(22, 19), 2026)
        parsed = projections.parse_stored_projections(conn)
        conn.rollback()
    assert _outcome(result).status == "captured"
    assert len(parsed.refused) == 1 and "playerProjections" in parsed.refused[0]


@pytest.mark.parametrize("body", _EMPTY_BODIES)
def test_an_empty_answer_on_the_slot_read_fails_and_the_slot_is_read_again(engine: Engine, body: object) -> None:
    fetcher = Tank01Fetcher(answer=(200, {"statusCode": 200, "body": body}))
    client = Tank01Client(fetcher, "key")
    with engine.connect() as conn:
        _clear_projection_reads(conn)
        first = run_capture_harvest(conn, client, _eastern(22, 19), 2026)
        stored = _count(conn, CAPTURE_SNAPSHOTS)
        fetcher.answer = None
        again = run_capture_harvest(conn, client, _eastern(22, 20), 2026)
        conn.rollback()
    assert (_outcome(first).status, _outcome(first).reason) == (
        "failed",
        "week 7 answered an empty body two hours before its kickoff",
    )
    assert stored == 0
    assert _outcome(again).status == "captured"  # never counted as the slot's read


def test_a_slot_week_not_published_two_hours_before_kickoff_fails_loudly(engine: Engine) -> None:
    for answer in [
        (404, {"statusCode": 404}),
        (200, {"statusCode": 200, "body": {"week": "7", "playerProjections": {}}}),
    ]:
        fetcher = Tank01Fetcher(answer=answer)
        with engine.connect() as conn:
            _clear_projection_reads(conn)
            result = run_capture_harvest(conn, Tank01Client(fetcher, "key"), _eastern(22, 19), 2026)
            stored = _count(conn, CAPTURE_SNAPSHOTS)
            conn.rollback()
        assert (_outcome(result).status, stored) == ("failed", 0)


def test_a_published_week_is_stored_and_content_the_parser_refuses_is_an_error() -> None:
    assert projections.projection_answer(_projections()) is None
    broken = _projections()
    assert isinstance(broken, dict)
    broken["playerProjections"]["8439"]["team"] = ""
    assert projections.projection_answer(broken) is None
    with pytest.raises(SchemaDriftError):
        projections.parse_projection_snapshot(broken, 1, _at(20, 10))


def test_a_slot_read_unchanged_since_the_mornings_read_is_not_repeated(engine: Engine) -> None:
    fetcher = Tank01Fetcher()
    client = Tank01Client(fetcher, "key")
    with engine.connect() as conn:
        _clear_projection_reads(conn)
        for at in (_eastern(22, 6), _eastern(22, 19), _eastern(22, 20)):
            run_capture_harvest(conn, client, at, 2026)
        conn.rollback()
    assert fetcher.weeks == ["7", "7"]  # Thursday 06:00, then 19:00 (unchanged); 20:00 reads nothing


def test_only_the_week_with_an_empty_player_map_is_never_reparsed(engine: Engine) -> None:
    insert_snapshot = text(
        f"insert into {CAPTURE_SNAPSHOTS.fullname} (source, captured_at, digest, payload) "
        "values (:source, :at, :digest, cast(:payload as jsonb))"
    )
    payloads = [{"season": "2026", "week": "7", "playerProjections": {}}, {"season": "2026", "week": "7"}, [], {}]
    with engine.connect() as conn:
        _clear_projection_reads(conn)
        for index, payload in enumerate(payloads):
            row = {"source": projections.PROJECTIONS_SOURCE, "at": _at(20, 10), "digest": str(index)}
            conn.execute(insert_snapshot, {**row, "payload": json.dumps(payload)})
        report = projections.parse_stored_projections(conn)
        conn.rollback()
    assert (report.snapshots, report.rows, len(report.refused)) == (0, 0, 3)


# The full-capture feed list (the operator's stats:capture pass, the parity case's path) screens its
# projections entry as the daily read does (B73): a week not published yet is never stored, drift is.
_FULL_LIST_PROJECTIONS: Final = [f for f in CAPTURE_FEEDS if f.source == projections.PROJECTIONS_SOURCE]


def _full_list_pass(conn: Connection, fetcher: Tank01Fetcher) -> CaptureResult:
    capture = CapturePass(_eastern(20, 6), 2026, 7, feeds=_FULL_LIST_PROJECTIONS)
    return capture_once(conn, Tank01Client(fetcher, "key"), capture, UnmeteredBudget())


@pytest.mark.parametrize("answer", _UNPUBLISHED_ANSWERS)
def test_the_full_list_never_stores_a_week_not_published_yet(engine: Engine, answer: tuple[int, object]) -> None:
    fetcher = Tank01Fetcher(answer=answer)
    with engine.connect() as conn:
        _clear_projection_reads(conn)
        result = _full_list_pass(conn, fetcher)
        stored, checked = _count(conn, CAPTURE_SNAPSHOTS), _count(conn, CAPTURE_CHECKS)
        fetcher.answer = None  # published by the next pass: nothing earlier stands in its way
        later = _full_list_pass(conn, fetcher)
        parsed = projections.parse_stored_projections(conn)
        conn.rollback()
    assert (_outcome(result).status, _outcome(result).reason) == ("unpublished", "week 7 not published yet")
    assert (stored, checked) == (0, 0)
    assert _outcome(later).status == "captured"
    assert (parsed.snapshots, parsed.refused) == (1, ())


@pytest.mark.parametrize("body", _DRIFT_ANSWERS)
def test_drift_on_the_full_list_is_stored_and_refused(engine: Engine, body: object) -> None:
    fetcher = Tank01Fetcher(answer=(200, {"statusCode": 200, "body": body}))
    with engine.connect() as conn:
        _clear_projection_reads(conn)
        result = _full_list_pass(conn, fetcher)
        stored = _count(conn, CAPTURE_SNAPSHOTS)
        parsed = projections.parse_stored_projections(conn)
        conn.rollback()
    assert (_outcome(result).status, stored) == ("captured", 1)
    assert len(parsed.refused) == 1 and "FAILED" in parsed.line()


def test_the_full_list_reads_and_screens_the_pass_week() -> None:
    (feed,) = _FULL_LIST_PROJECTIONS
    assert feed.screen is not None
    context = CaptureContext(2026, 9, "20261030", ())
    assert [r.query for r in feed.requests(context)] == [{"week": "9"}]
    assert feed.screen(context, {"week": "9", "playerProjections": {}}) == ("unpublished", "week 9 not published yet")
    assert feed.screen(context, {}) == ("unpublished", "week 9 not published yet")
    assert feed.screen(context, _projections()) is None
    assert feed.screen(context, {"week": "9"}) is None  # drift: stored, and the parser refuses it
