"""The hourly capture's game facts (Lane 66a): the figures and the forecasts run after the harvest, each
in its own transaction, and a failure in either is named on its own line without undoing the capture."""

from contextlib import nullcontext
from datetime import UTC, datetime
from typing import Any, cast

import pytest

from research.inseason import __main__ as inseason
from research.nightly import steps
from research.nightly.steps import IngestContext
from research.pipeline.nws.forecast import ForecastOutcome, ForecastResult
from research.pipeline.tank01.capture import CaptureResult, FeedOutcome
from research.pipeline.tank01.lines import LinesResult

NOW = datetime(2026, 10, 20, 13, 0, tzinfo=UTC)
HARVEST = CaptureResult([FeedOutcome("tank01_betting_odds", "unchanged", 3)])
LINES = LinesResult(1, 16, 128, (), 2)


def _engine() -> Any:
    return cast("Any", type("E", (), {"begin": lambda self: nullcontext(object())})())


def _refused(*_args: object) -> None:
    raise RuntimeError("the capture's shape changed")


def test_the_nightly_capture_line_carries_the_figures_and_survives_their_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(steps, "run_capture_harvest", lambda *args: HARVEST)
    context = IngestContext(_engine(), cast("Any", None), NOW, {"TANK01_API_KEY": "k"})
    monkeypatch.setattr(steps, "lines_after_harvest", lambda *args: LINES)
    assert steps._capture(context) == f"1 feeds, 3 requests; game figures: {LINES.line()}"
    monkeypatch.setattr(steps, "lines_after_harvest", _refused)
    assert steps._capture(context) == "1 feeds, 3 requests; game figures FAILED, the capture's shape changed"


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
