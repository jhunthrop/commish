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
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Final
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import Engine

from research.db.engine import make_engine
from research.db.url import sqlalchemy_url
from research.parity import databases
from research.pipeline.http import HttpResponse
from research.pipeline.kickoff_slots import LEAD, Slot, kickoff_slots
from research.pipeline.kickoffs import TeamKickoff
from research.pipeline.tank01.capture import (
    CAPTURE_HARVEST_REQUEST_BUDGET,
    CAPTURE_STATUS_REQUEST_BUDGET,
    CaptureContext,
    run_capture_status,
    status_feeds,
)
from research.pipeline.tank01.client import Paths, Tank01Client

REPO_ROOT: Final = Path(__file__).resolve().parents[2]
_EASTERN: Final = ZoneInfo("America/New_York")
_DATABASE: Final = "parity_test_game_day_status"
SEASON: Final = 2026
STEP: Final = timedelta(minutes=15)
# The plan's requests a day (memory: tank01-paid-tier-approved) and the self-imposed monthly ceiling.
DAILY_QUOTA: Final = 15_000
MONTHLY_CEILING: Final = 30_000
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


def test_a_weeks_extra_requests_stay_inside_the_daily_quota_and_the_monthly_ceiling() -> None:
    per_day = [len(_status_fires(_eastern(day, 0))) * CAPTURE_STATUS_REQUEST_BUDGET for day in range(19, 26 + 1)]
    extra_a_week = sum(per_day[:7])
    busiest = max(per_day)
    harvest_a_day = HARVEST_PASSES_A_DAY * CAPTURE_HARVEST_REQUEST_BUDGET
    assert (busiest, extra_a_week) == (66, 100)
    assert busiest + harvest_a_day <= DAILY_QUOTA
    assert DAYS_A_MONTH * harvest_a_day + extra_a_week * 5 <= MONTHLY_CEILING


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
