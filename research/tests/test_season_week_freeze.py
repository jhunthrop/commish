"""The season-week freeze step's verdict: an already-frozen week is ok, a historical miss is listed
but never fails the pass, and only a coming week that could not be frozen fails it."""

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import cast

import pytest
from sqlalchemy import Connection, Engine

from research.inseason import season_week
from research.inseason.season_week import STEPS, SeasonWeekContext, run_season_week
from research.inseason.step_result import StepResult
from research.model.register.freeze import FreezeResult
from research.pipeline.http import Fetcher

_SEASON = 2026
_NOW = datetime(2026, 10, 14, 22, 0, tzinfo=UTC)
_KICKOFFS = {
    3: datetime(2026, 9, 25, 0, 15, tzinfo=UTC),
    4: datetime(2026, 10, 2, 0, 15, tzinfo=UTC),
    5: datetime(2026, 10, 9, 0, 15, tzinfo=UTC),
    6: datetime(2026, 10, 16, 0, 15, tzinfo=UTC),
}
_FROZEN_AT = datetime(2026, 10, 13, 12, 0, 17, 450000, tzinfo=UTC)
_ONLY_FREEZE = frozenset(STEPS) - {"freeze"}


class _FakeEngine:
    """Stands in for the engine: every read and write below is monkeypatched, so no SQL runs."""

    @contextmanager
    def connect(self) -> Iterator[Connection]:
        yield cast(Connection, None)

    @contextmanager
    def begin(self) -> Iterator[Connection]:
        yield cast(Connection, None)


def _context() -> SeasonWeekContext:
    return SeasonWeekContext(
        engine=cast(Engine, _FakeEngine()),
        fetcher=cast(Fetcher, None),
        now=_NOW,
        season=_SEASON,
        environ={},
        skip=_ONLY_FREEZE,
    )


def _store(monkeypatch: pytest.MonkeyPatch, frozen: list[int], latest: datetime | None) -> None:
    monkeypatch.setattr(season_week, "kickoff_instants_by_week", lambda conn, season: dict(_KICKOFFS))
    monkeypatch.setattr(season_week, "_frozen_and_graded", lambda conn, season: (frozen, set()))
    monkeypatch.setattr(season_week, "latest_freeze_for", lambda conn, season, week: latest)


def _freeze_step(results: list[StepResult]) -> StepResult:
    return next(result for result in results if result.step == "freeze")


def test_an_already_frozen_week_with_historical_misses_passes(monkeypatch: pytest.MonkeyPatch) -> None:
    _store(monkeypatch, frozen=[1, 2, 6], latest=_FROZEN_AT)
    results = run_season_week(_context())
    step = _freeze_step(results)
    assert step.status == "ok"
    assert step.summary == "week 6 already frozen at 2026-10-13T12:00:17.450Z"
    assert step.detail == (
        "week 3: MISSED, no freeze before its first kickoff 2026-09-25T00:15:00.000Z",
        "week 4: MISSED, no freeze before its first kickoff 2026-10-02T00:15:00.000Z",
        "week 5: MISSED, no freeze before its first kickoff 2026-10-09T00:15:00.000Z",
    )
    assert all(result.status != "failed" for result in results)


def test_a_miss_inside_the_week_does_not_fail_the_step(monkeypatch: pytest.MonkeyPatch) -> None:
    _store(monkeypatch, frozen=[1, 2, 3, 4, 6], latest=_FROZEN_AT)
    step = _freeze_step(run_season_week(_context()))
    assert _NOW - _KICKOFFS[5] < timedelta(days=7)
    assert step.status == "ok"
    assert step.detail == ("week 5: MISSED, no freeze before its first kickoff 2026-10-09T00:15:00.000Z",)


def test_a_failed_freeze_of_the_coming_week_fails_the_step(monkeypatch: pytest.MonkeyPatch) -> None:
    _store(monkeypatch, frozen=[1, 2], latest=None)

    def refuse(conn: Connection, season: int, week: int, now: datetime) -> None:
        raise RuntimeError(f"week {week} has no served board")

    monkeypatch.setattr(season_week, "take_freeze", refuse)
    step = _freeze_step(run_season_week(_context()))
    assert step.status == "failed"
    assert step.summary == "week 6 has no served board"


_THURSDAY_PASS = datetime(2026, 10, 15, 18, 0, tzinfo=UTC)  # Thursday 14:00 New York, week 6's kickoff 20:15


def _taken(monkeypatch: pytest.MonkeyPatch) -> list[datetime]:
    taken: list[datetime] = []

    def take(conn: Connection, season: int, week: int, now: datetime) -> FreezeResult:
        taken.append(now)
        return FreezeResult(season, week, now, _KICKOFFS[week], [], {})

    monkeypatch.setattr(season_week, "take_freeze", take)
    return taken


def test_the_final_pass_sets_the_weeks_order_over_an_early_freeze(monkeypatch: pytest.MonkeyPatch) -> None:
    """Lane 93 (B37): the pass inside `FINAL_FREEZE_BEFORE` of the first kickoff freezes again, so the
    order is set once, on the Thursday pass, and the Tuesday freeze stays only as the fallback."""
    _store(monkeypatch, frozen=[1, 2, 6], latest=_FROZEN_AT)
    taken = _taken(monkeypatch)
    step = _freeze_step(run_season_week(replace(_context(), now=_THURSDAY_PASS)))
    assert taken == [_THURSDAY_PASS]
    assert step.status == "ok"
    assert step.summary.endswith(
        "(0 on the served board, 0 on the order shipped), superseding the early freeze at "
        "2026-10-13T12:00:17.450Z, implementation python"
    )


def test_a_freeze_inside_the_final_window_is_not_taken_again(monkeypatch: pytest.MonkeyPatch) -> None:
    _store(monkeypatch, frozen=[1, 2, 6], latest=_THURSDAY_PASS)
    taken = _taken(monkeypatch)
    later = _THURSDAY_PASS + timedelta(hours=1)
    step = _freeze_step(run_season_week(replace(_context(), now=later)))
    assert taken == []
    assert step.summary == "week 6 already frozen at 2026-10-15T18:00:00.000Z"


def test_the_final_window_is_the_hours_before_the_first_kickoff() -> None:
    kickoff = _KICKOFFS[6]
    assert season_week.is_final_pass(kickoff, kickoff - season_week.FINAL_FREEZE_BEFORE)
    assert season_week.is_final_pass(kickoff, _THURSDAY_PASS)
    assert not season_week.is_final_pass(kickoff, _NOW)  # Wednesday 18:00 New York, 26 hours before
    assert not season_week.is_final_pass(kickoff, kickoff)
