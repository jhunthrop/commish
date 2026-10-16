"""The two benchmarks captured per kickoff slot: the slots themselves, Tank01's weekly projection
parsed per player (`testdata/tank01/projections-2026-week-1.json`, eight players of the one stored
snapshot), and The Odds API's anytime-touchdown market (`testdata/odds/`, recorded 2026-10-16: the
event list and HOU at JAX in London, 2026-10-18)."""

import json
import os
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Final

import pytest
from sqlalchemy import Engine, func, insert, select, text

from research.db.engine import make_engine
from research.db.schema import (
    CAPTURE_SNAPSHOTS,
    PLAYER_TD_PROP_OBSERVATIONS,
    TANK01_PROJECTION_ROWS,
    TEAM_WEEK_OBSERVATIONS,
)
from research.db.url import sqlalchemy_url
from research.errors import SchemaDriftError
from research.parity import databases
from research.pipeline.http import HttpResponse
from research.pipeline.kickoff_slots import LEAD, due_slot, kickoff_slots, slot_name, slot_of
from research.pipeline.kickoffs import TeamKickoff, stored_kickoffs
from research.pipeline.odds import touchdowns
from research.pipeline.tank01 import projections

TESTDATA: Final = Path(__file__).resolve().parent / "testdata"
_EVENT: Final = "57418b2cf5aca558b3c98eafac1e264a"
_DATABASE = "parity_test_benchmark_captures"


def _at(day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 10, day, hour, minute, tzinfo=UTC)


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
    assert len(rows) == 8  # noqa: PLR2004 - the fixture's eight players
    rodgers = rows["8439"]
    assert (rodgers["position"], rodgers["team"], rodgers["season"], rodgers["week"]) == ("QB", "PIT", 2026, 1)
    assert (rodgers["ppr_points"], rodgers["pass_yards"], rodgers["pass_touchdowns"]) == (15.76, 230.0, 1.7)
    kicker = rows["10621"]
    assert (kicker["position"], kicker["pass_yards"], kicker["ppr_points"]) == ("PK", None, 6.0)


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
    assert (parsed.snapshots, parsed.rows, rows) == (1, 8, 8)
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
                as_of=_at(18, 20, 25), ingested_at=datetime(2026, 10, 30, tzinfo=UTC),
            )
        )  # fmt: skip
        chicago = [k.at for k in stored_kickoffs(conn, 2026) if k.team == "CHI"]
        conn.execute(
            text("delete from research.team_week_observations where team = 'CHI' and as_of = :at"),
            {"at": _at(18, 20, 25)},
        )
    assert chicago == [_at(18, 20, 25)]
