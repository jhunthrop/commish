"""The ingest's capture line names why a feed failed (Lane 62: the 2026-10-16T05 night said only
"failed: tank01_betting_odds", and the reason the client raised was lost)."""

from contextlib import nullcontext
from datetime import UTC, datetime
from typing import Any, cast

import pytest

from research.nightly import steps
from research.nightly.steps import IngestContext
from research.pipeline.tank01.capture import CaptureResult, FeedOutcome

REFUSAL = "Tank01 refused /getNFLBettingOdds: no games on this date"


def test_a_failed_feed_is_named_with_its_reason(monkeypatch: pytest.MonkeyPatch) -> None:
    result = CaptureResult(
        [FeedOutcome("tank01_news", "captured", 1), FeedOutcome("tank01_betting_odds", "failed", 1, REFUSAL)]
    )
    monkeypatch.setattr(steps, "run_capture_harvest", lambda *args: result)
    engine = cast("Any", type("E", (), {"begin": lambda self: nullcontext(object())})())
    context = IngestContext(engine, cast("Any", None), datetime(2026, 10, 16, 5, tzinfo=UTC), {"TANK01_API_KEY": "k"})
    assert steps._capture(context) == f"2 feeds, 2 requests, failed: tank01_betting_odds ({REFUSAL})"


def test_a_long_reason_keeps_its_first_line_within_the_cap() -> None:
    database = "(psycopg.errors.Unknown) " + "x" * 400 + "\n[SQL: insert into capture_snapshots ...]"
    short = steps._short_reason(database)
    assert len(short) == steps.CAPTURE_REASON_CHARS
    assert "\n" not in short and "SQL" not in short
    assert steps._short_reason(None) == "no reason given"
