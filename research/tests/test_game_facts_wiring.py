"""The hourly capture's game facts (Lane 66a): the figures and the forecasts run after the harvest, each
in its own transaction, and a failure in either is named on its own line without undoing the capture."""

from collections.abc import Callable
from contextlib import nullcontext
from datetime import UTC, datetime
from typing import Any, cast

import pytest
from psycopg.errors import InsufficientPrivilege
from sqlalchemy.exc import OperationalError, ProgrammingError

from research.inseason import __main__ as inseason
from research.nightly import steps
from research.nightly.designation_dating import DatingOutcome
from research.nightly.designations import DesignationsError
from research.nightly.steps import IngestContext
from research.pipeline.nws.forecast import ForecastOutcome, ForecastResult
from research.pipeline.tank01.capture import CaptureResult, FeedOutcome
from research.pipeline.tank01.lines import LinesResult

NOW = datetime(2026, 10, 20, 13, 0, tzinfo=UTC)
HARVEST = CaptureResult([FeedOutcome("tank01_betting_odds", "unchanged", 3)])
LINES = LinesResult(1, 16, 128, (), 2)
DATED = DatingOutcome("designation-dating: the capture of 2026-10-20T12:00:00Z dated, 190 runs read in 900 ms", True)


def _engine() -> Any:
    return cast("Any", type("E", (), {"begin": lambda self: nullcontext(object())})())


def _refused(*_args: object) -> None:
    raise RuntimeError("the capture's shape changed")


def test_the_nightly_capture_line_carries_the_figures_and_survives_their_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(steps, "run_capture_harvest", lambda *args: HARVEST)
    monkeypatch.setattr(steps, "date_newest_capture", lambda *args: DATED)
    context = IngestContext(_engine(), cast("Any", None), NOW, {"TANK01_API_KEY": "k"})
    monkeypatch.setattr(steps, "lines_after_harvest", lambda *args: LINES)
    assert steps._capture(context) == f"1 feeds, 3 requests; {DATED.line}; game figures: {LINES.line()}"
    monkeypatch.setattr(steps, "lines_after_harvest", _refused)
    assert steps._capture(context) == (
        f"1 feeds, 3 requests; {DATED.line}; game figures FAILED, the capture's shape changed"
    )
    # The dating's failure is its own words on the line; the capture and the figures stand.
    monkeypatch.setattr(steps, "date_newest_capture", _refused)
    monkeypatch.setattr(steps, "lines_after_harvest", lambda *args: LINES)
    assert steps._capture(context) == (
        f"1 feeds, 3 requests; designation-dating FAILED, the capture's shape changed; game figures: {LINES.line()}"
    )


def _raising(error: BaseException) -> Callable[..., None]:
    def raise_it(*_args: object) -> None:
        raise error

    return raise_it


def test_the_hourly_job_dates_the_capture_and_fails_only_on_a_missing_grant(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(inseason, "date_newest_capture", lambda *args: DATED)
    assert inseason._date_designations(_engine(), NOW)
    assert f"  {DATED.line}" in capsys.readouterr().out
    # A missing grant fails every hour until an operator grants it: the job fails and alerts.
    denied = ProgrammingError("insert", {}, InsufficientPrivilege("permission denied for schema app"))
    monkeypatch.setattr(inseason, "date_newest_capture", _raising(denied))
    assert not inseason._date_designations(_engine(), NOW)
    assert (
        "designation-dating: FAILED, ProgrammingError: permission denied for schema app; "
        "the API dates the capture itself" in capsys.readouterr().out
    )
    # Anything else is logged on its own line and the hour goes on: the API dates the capture itself.
    for error in (
        OperationalError("select", {}, Exception("canceling statement due to statement timeout")),
        DesignationsError("none of the 5 newest injury captures tank01_injuries_by_date reads"),
        RuntimeError("a bug"),
    ):
        monkeypatch.setattr(inseason, "date_newest_capture", _raising(error))
        assert inseason._date_designations(_engine(), NOW)
        out = capsys.readouterr().out
        assert "designation-dating: FAILED, " in out and "the API dates the capture itself" in out


def test_the_hourly_job_reports_both_passes_and_fails_on_either(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    written = ForecastResult([ForecastOutcome("2026_07_NE_CHI", "written")], 1, 16)
    monkeypatch.setattr(inseason, "lines_after_harvest", lambda *args: LINES)
    monkeypatch.setattr(inseason, "run_forecast_pass", lambda *args: written)
    assert inseason._game_facts(_engine(), cast("Any", None), HARVEST, NOW)
    out = capsys.readouterr().out
    assert f"tank01_lines: {LINES.line()}" in out and f"nws_forecast: {written.line()}" in out
    failed = ForecastResult([ForecastOutcome("2026_07_NE_CHI", "failed", "HTTP 500")], 1, 0)
    monkeypatch.setattr(inseason, "run_forecast_pass", lambda *args: failed)
    assert not inseason._game_facts(_engine(), cast("Any", None), HARVEST, NOW)
    monkeypatch.setattr(inseason, "lines_after_harvest", _refused)
    monkeypatch.setattr(inseason, "run_forecast_pass", lambda *args: written)
    assert not inseason._game_facts(_engine(), cast("Any", None), HARVEST, NOW)
    assert "tank01_lines: FAILED, the capture's shape changed" in capsys.readouterr().out
