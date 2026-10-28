"""The game-day status cadence (Lane 263): the schedule's windows, the capture's two feeds, the quota.

The schedule entries are read from `infra/research-schedule.sh` itself and expanded on a fixed week (Sunday
2026-10-25, with its Thursday and Monday), so a change to a cron field is a change a test sees. The capture runs
against a migrated scratch database and needs PARITY_DATABASE_URL (skipped without it, run by CI).
"""

import itertools
import json
import os
import re
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Final
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import Engine

from research.capsules.week.sheet import WeekSheet
from research.db.engine import make_engine
from research.db.url import sqlalchemy_url
from research.inseason.status_windows import LAST_STATUS_PASS, is_last_status_pass
from research.nightly import week_reads
from research.parity import databases
from research.pipeline.budget import PROVIDER_DAILY_REQUEST_QUOTA, PROVIDER_MONTHLY_REQUEST_CEILING
from research.pipeline.http import HttpResponse
from research.pipeline.kickoff_slots import LEAD, Slot, kickoff_slots
from research.pipeline.kickoffs import TeamKickoff
from research.pipeline.tank01.capture import (
    CAPTURE_HARVEST_REQUEST_BUDGET,
    CAPTURE_STATUS_REQUEST_BUDGET,
    PLAYER_LIST_REQUESTS,
    STATUS_FEED_SOURCES,
    CaptureContext,
    _due,
    run_capture_status,
    status_feeds,
)
from research.pipeline.tank01.client import Paths, Tank01Client
from research.tests.week_read_fixtures import starter

REPO_ROOT: Final = Path(__file__).resolve().parents[2]
_EASTERN: Final = ZoneInfo("America/New_York")
_DATABASE: Final = "parity_test_game_day_status"
SEASON: Final = 2026
STEP: Final = timedelta(minutes=15)
HARVEST_PASSES_A_DAY: Final = 20  # 00:00, 02:00 and 06:00 through 23:00
DAYS_A_MONTH: Final = 31


def _eastern(day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 10, day, hour, minute, tzinfo=_EASTERN)


def _field_values(expression: str, low: int, high: int) -> set[int]:
    values: set[int] = set()
    for part in expression.split(","):
        if part == "*":
            values.update(range(low, high + 1))
        elif "-" in part:
            start, end = part.split("-")
            values.update(range(int(start), int(end) + 1))
        else:
            values.add(int(part))
    return values


def _status_entries() -> list[tuple[str, str, str]]:
    """(name, cron, Cloud Run job) of each game-day status entry in the schedule script."""
    script = (REPO_ROOT / "infra" / "research-schedule.sh").read_text()
    entries = re.findall(r'^\s*"(research-status-[^|]+)\|([^|]+)\|[^|]+\|([^|]+)\|', script, re.MULTILINE)
    assert entries, "no research-status entry in the schedule"
    return entries


def _fires(cron: str, day: datetime) -> list[datetime]:
    """The instants (Eastern) the cron fires on `day`'s date; the weekday is cron's, Sunday 0."""
    minute, hour, _dom, month, weekday = cron.split()
    if day.month not in _field_values(month, 1, 12) or (day.isoweekday() % 7) not in _field_values(weekday, 0, 6):
        return []
    return [
        day.replace(hour=h, minute=m)
        for h in sorted(_field_values(hour, 0, 23))
        for m in sorted(_field_values(minute, 0, 59))
    ]


def _status_fires(day: datetime) -> list[datetime]:
    fires = [at for _name, cron, _job in _status_entries() for at in _fires(cron, day)]
    return sorted(fires)


def _week_slots() -> dict[str, Slot]:
    """The slots of Sunday 2026-10-25's week: a Thursday night game, Sunday's 9:30 game abroad, 1:00, 4:05 and
    4:25 and the 8:20 night game, and a Monday night game."""
    games = [
        (22, 20, 15), (25, 9, 30), (25, 13, 0), (25, 16, 5), (25, 16, 25), (25, 20, 20), (26, 20, 15),
    ]  # fmt: skip
    kickoffs = [TeamKickoff(SEASON, 7, f"T{i}", _eastern(d, h, m)) for i, (d, h, m) in enumerate(games)]
    return {slot.name: slot for slot in kickoff_slots(kickoffs)}


def _covered(slot: Slot, fires: list[datetime]) -> bool:
    """Every quarter hour from the slot's opening (rounded up to the quarter) to its first kickoff is a status fire or the harvest's :00."""
    at = slot.opens + (-slot.opens.minute % 15) * timedelta(minutes=1)
    while at <= slot.first_kickoff:
        if at.minute != 0 and at.astimezone(_EASTERN) not in fires:
            return False
        at += STEP
    return True


def test_every_status_entry_targets_the_status_job() -> None:
    assert {job for _name, _cron, job in _status_entries()} == {"inseason-status"}


def test_sunday_runs_every_quarter_hour_from_ten_through_the_last_kickoff() -> None:
    fires = _status_fires(_eastern(25, 0))
    slots = _week_slots()
    assert fires[0] == _eastern(25, 10, 15) and fires[-1] >= slots["sunday-late"].last_kickoff
    assert all(b - a <= STEP * 2 for a, b in itertools.pairwise(fires))  # the :00 is the harvest's
    # The 9:30 game abroad's inactives (about 90 minutes before) land at 8:00, before the window: the hourly
    # cadence holds it, and the window opens at the ruling's 10:00 for the 1:00 games.
    assert fires[0] > slots["sunday-morning"].first_kickoff
    for name in ("sunday-early", "sunday-late"):
        assert _covered(slots[name], fires), name


@pytest.mark.parametrize(("day", "name"), [(22, "thursday"), (26, "monday")])
def test_a_night_game_has_a_pass_every_quarter_hour_for_its_two_hours(day: int, name: str) -> None:
    fires = _status_fires(_eastern(day, 0))
    slot = _week_slots()[name]
    assert slot.opens == slot.first_kickoff - LEAD
    assert _covered(slot, fires)
    assert min(fires) <= slot.opens and max(fires) == slot.first_kickoff  # none after the kickoff


@pytest.mark.parametrize("day", [20, 21, 23, 24])
def test_the_other_days_have_no_status_pass(day: int) -> None:
    assert _status_fires(_eastern(day, 0)) == []


def test_the_offseason_has_no_status_pass() -> None:
    assert _status_fires(datetime(2026, 7, 26, tzinfo=_EASTERN)) == []


def test_the_status_capture_asks_the_status_feeds_only() -> None:
    context = CaptureContext(SEASON, 7, "20261025", ("KC", "BUF"))
    paths = [r.path for feed in status_feeds() for r in feed.requests(context)]
    assert paths == [Paths.INJURIES_BY_DATE, Paths.INACTIVES]
    assert len(paths) == CAPTURE_STATUS_REQUEST_BUDGET


def test_every_kind_of_request_stays_inside_the_provider_plan() -> None:
    """The busiest day (a Thursday: the weekly pass's player list, a Sunday's 66 status requests are the larger)
    and the month, every kind: the hourly harvest (its ten include the game statuses, box scores and the
    player list), the nightly's capture, the Thursday pass's player list, and the status passes."""
    per_day = [len(_status_fires(_eastern(day, 0))) * CAPTURE_STATUS_REQUEST_BUDGET for day in range(19, 26)]
    status_a_week = sum(per_day)
    harvest_a_day = HARVEST_PASSES_A_DAY * CAPTURE_HARVEST_REQUEST_BUDGET
    nightly_a_day = CAPTURE_HARVEST_REQUEST_BUDGET
    busiest_day = harvest_a_day + nightly_a_day + PLAYER_LIST_REQUESTS + max(per_day)
    month = DAYS_A_MONTH * (harvest_a_day + nightly_a_day) + 5 * (PLAYER_LIST_REQUESTS + status_a_week)
    assert (max(per_day), status_a_week) == (66, 100)
    assert busiest_day <= PROVIDER_DAILY_REQUEST_QUOTA
    assert month <= PROVIDER_MONTHLY_REQUEST_CEILING


@pytest.mark.parametrize(
    "fired_at",
    [
        datetime(2026, 10, 27, 0, 15, tzinfo=UTC),  # Monday 20:15 EDT, already Tuesday in UTC
        datetime(2026, 11, 3, 1, 15, tzinfo=UTC),  # Monday 20:15 EST (after the clocks change on Nov 1)
        datetime(2026, 11, 3, 0, 45, tzinfo=UTC),  # Monday 19:45 EST
    ],
)
def test_the_inactives_are_asked_on_a_monday_evening_in_utc_tuesday(fired_at: datetime) -> None:
    due, skipped = _due(status_feeds(), fired_at, lambda _key: False, CaptureContext(SEASON, 8, "20261027", ("KC",)))
    assert [feed.source for feed in due] == sorted(STATUS_FEED_SOURCES, key=lambda s: s != "tank01_injuries_by_date")
    assert skipped == []


@dataclass
class _Fetcher:
    """Every path answers an empty list; `asked` is the paths the provider was asked."""

    asked: list[str] = field(default_factory=list)

    def get(self, url: str, headers: Mapping[str, str] | None = None) -> HttpResponse:
        self.asked.append(url.partition("?")[0])
        return HttpResponse(200, json.dumps({"statusCode": 200, "body": []}).encode(), {})

    def stream(self, url: str, headers: Mapping[str, str] | None = None) -> tuple[int, Iterator[bytes]]:
        raise AssertionError("never streams")


@pytest.fixture
def engine() -> Iterator[Engine]:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    built = make_engine(sqlalchemy_url(databases.build_with_alembic(_DATABASE)))
    try:
        yield built
    finally:
        built.dispose()
        databases.drop(_DATABASE)


def test_a_status_pass_requests_two_feeds_and_a_repeat_stores_nothing(engine: Engine) -> None:
    fetcher = _Fetcher()
    with engine.begin() as conn:
        first = run_capture_status(conn, Tank01Client(fetcher, "key"), _eastern(25, 11, 15), SEASON)
        second = run_capture_status(conn, Tank01Client(fetcher, "key"), _eastern(25, 11, 30), SEASON)
    assert [url.rsplit("/", 1)[-1] for url in fetcher.asked] == [
        path.removeprefix("/") for path in (Paths.INJURIES_BY_DATE, Paths.INACTIVES) * 2
    ]
    assert {(o.source, o.status) for o in first.feeds} == {
        ("tank01_injuries_by_date", "captured"),
        ("tank01_inactives", "captured"),
    }
    assert {o.status for o in second.feeds} == {"unchanged"}


def test_the_last_status_pass_of_each_weekday_is_the_schedules_last_fire() -> None:
    for day in (19, 20, 21, 22, 23, 24, 25, 26):
        fires = _status_fires(_eastern(day, 0))
        at = _eastern(day, 12)
        weekday = at.isoweekday()
        if not fires:
            assert weekday not in LAST_STATUS_PASS
            continue
        assert LAST_STATUS_PASS[weekday] == fires[-1].time()
        assert is_last_status_pass(fires[-1]) and not is_last_status_pass(fires[-2])


def _sheet_kicking_off(name: str, kickoff: datetime | None) -> WeekSheet:
    base = starter()
    game = None if kickoff is None or base.game is None else replace(base.game, kickoff=kickoff)
    return replace(base, player_id=name, name=name, game=game)


def test_due_reads_of_an_hourly_pass_run_soonest_kickoff_first_and_the_left_ones_name_the_next(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sheets = (
        _sheet_kicking_off("late", _eastern(25, 16, 25)),
        _sheet_kicking_off("bye", None),
        _sheet_kicking_off("early-b", _eastern(25, 13)),
        _sheet_kicking_off("early-a", _eastern(25, 13)),
    )
    monkeypatch.setattr(week_reads, "due_reason", lambda *_a, **_k: "status")
    night = week_reads._Night(sheets, {}, 7, None)  # type: ignore[arg-type]
    hourly = [s.name for s, _ in week_reads._due(night, _eastern(25, 11), hourly=True)]
    nightly = [s.name for s, _ in week_reads._due(night, _eastern(25, 11), hourly=False)]
    assert hourly == ["early-b", "early-a", "late", "bye"]  # board order within a kickoff, no game last
    assert nightly == ["late", "bye", "early-b", "early-a"]
    due = week_reads._due(night, _eastern(25, 11), hourly=True)
    assert week_reads.left_unread(due, 0) is None
    assert week_reads.left_unread(due, 2) == "2 reads left unread, the next kickoff among them Sun 15:25 Central"


def test_only_the_last_passs_own_quarter_hour_is_the_last_pass() -> None:
    assert is_last_status_pass(_eastern(26, 20, 15)) and is_last_status_pass(_eastern(26, 20, 29))
    assert not is_last_status_pass(_eastern(26, 20, 30)) and not is_last_status_pass(_eastern(26, 23))


def test_the_alert_filter_matches_the_warning_the_pass_logs() -> None:
    script = (REPO_ROOT / "infra" / "research-alerts.sh").read_text()
    assert f'textPayload : "{week_reads.WARNING_MARKER}"' in script
    assert week_reads.WARNING_MARKER.startswith(week_reads.STEP)


def _stub_night(monkeypatch: pytest.MonkeyPatch, spent: bool) -> week_reads._Night:
    sheets = (_sheet_kicking_off("a", _eastern(25, 13)), _sheet_kicking_off("b", _eastern(25, 16, 25)))
    night = week_reads._Night(sheets, {}, 7, SimpleNamespace(ready=True, line=lambda: "ready"))  # type: ignore[arg-type]
    monkeypatch.setenv("AI_GATEWAY_API_KEY", "k")
    monkeypatch.setattr(week_reads, "_budget_usd", lambda *_a: 0.0 if spent else 0.05)
    monkeypatch.setattr(week_reads, "_read_night", lambda *_a: night)
    monkeypatch.setattr(week_reads, "due_reason", lambda *_a, **_k: "status")
    return night


def _step(last_pass: bool, hourly: bool = True) -> list[str]:
    lines: list[str] = []
    week_reads.run_week_read_step(None, _eastern(25, 20, 45), lines.append, None, hourly=hourly, last_pass=last_pass)  # type: ignore[arg-type]
    return lines


def test_a_spent_day_at_the_windows_last_pass_logs_the_warning(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub_night(monkeypatch, spent=True)
    (line,) = _step(last_pass=True)
    assert line.startswith(week_reads.WARNING_MARKER) and "2 reads left unread" in line
    assert _step(last_pass=False) == []
    assert _step(last_pass=True, hourly=False) == []


def test_left_unread_is_clamped_to_the_reads_due() -> None:
    due = [(_sheet_kicking_off("a", _eastern(25, 13)), "status")]
    assert week_reads.left_unread(due, 5) == "1 reads left unread, the next kickoff among them Sun 12:00 Central"
