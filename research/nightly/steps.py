"""THE NIGHTLY'S INGEST AND FIT STEPS, ported from `research-ts/src/nightly/steps.ts`.

INGEST: the provider capture the capsules read facts from (injuries, news, depth charts, inactives,
game lines; skipped by name without TANK01_API_KEY), tonight's ADP in every format the run carries
(the three scoring formats, and two-quarterback drafts for the superflex board), the pre-kickoff
props snapshot and the published win totals (both no-ops once the product season has kicked off,
and the props skipped by name without ODDS_API_KEY). Each part runs in its own transaction, so one
failed feed keeps the others. The step fails only when the PPR ADP capture failed, the one every
page reads.

FIT: the board rebuilt and compared, check only (`model.fit_check.fit_step`).
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Final

from sqlalchemy import Engine

from research.model.arithmetic import ARM64_BOARDS
from research.model.fit_check import fit_step
from research.model.fit_inputs import fit_readiness
from research.model.priors import load_model_artifacts
from research.model.reads.teams import first_kickoff_for
from research.pipeline import vegas
from research.pipeline.http import Fetcher
from research.pipeline.odds.ingest import KickoffGate, run_props_preseason_snapshot
from research.pipeline.preseason.boards import ingest_adp_snapshot, ingest_superflex_adp_snapshot
from research.pipeline.tank01.capture import run_capture_harvest
from research.pipeline.tank01.client import API_KEY_ENV as TANK01_KEY
from research.pipeline.tank01.client import DEFAULT_SEASON, SEASON_ENV, Tank01Client
from research.season import PRODUCT_SEASON

ODDS_KEY: Final = "ODDS_API_KEY"


@dataclass(frozen=True, slots=True)
class StepRecord:
    name: str
    status: str  # "ran", "skipped", "failed"
    summary: str

    def json(self) -> dict[str, str]:
        return {"name": self.name, "status": self.status, "summary": self.summary}


@dataclass(frozen=True, slots=True)
class IngestContext:
    engine: Engine
    fetcher: Fetcher
    now: datetime
    environ: Mapping[str, str]


def _guarded(name: str, body: Callable[["IngestContext"], str], context: "IngestContext") -> tuple[str, bool]:
    """One part's line, and whether it failed; a failure is reported, the other parts still run."""
    try:
        return f"{name}: {body(context)}", False
    except Exception as error:
        return f"{name}: FAILED, {error}", True


def _capture(context: IngestContext) -> str:
    key = context.environ.get(TANK01_KEY, "").strip()
    if not key:
        return f"skipped, {TANK01_KEY} is not set"
    season = int(context.environ.get(SEASON_ENV, DEFAULT_SEASON))
    with context.engine.begin() as conn:
        result = run_capture_harvest(conn, Tank01Client(context.fetcher, key), context.now, season)
    if result.reason is not None:
        return f"refused, {result.reason}"
    failed = [feed.source for feed in result.feeds if feed.status == "failed"]
    return f"{len(result.feeds)} feeds, {sum(f.requests for f in result.feeds)} requests" + (
        f", failed: {', '.join(failed)}" if failed else ""
    )


def _adp(context: IngestContext) -> str:
    with context.engine.begin() as conn:
        formats = ingest_adp_snapshot(conn, context.fetcher, context.now)
        formats.append(ingest_superflex_adp_snapshot(conn, context.fetcher, context.now))
    return ", ".join(
        f"{f.format} {f.written} of {f.candidates_read}" + ("" if f.error is None else f" (FAILED {f.error})")
        for f in formats
    )


def _props(context: IngestContext) -> str:
    key = context.environ.get(ODDS_KEY, "").strip()
    with context.engine.begin() as conn:
        gate = KickoffGate(context.now, PRODUCT_SEASON, first_kickoff_for(conn, PRODUCT_SEASON))
        if gate.first_kickoff is not None and context.now >= gate.first_kickoff:
            return "the season has kicked off, the pre-kickoff window is closed (no network call made)"
        if not key:
            return f"skipped, {ODDS_KEY} is not set"
        return run_props_preseason_snapshot(conn, context.fetcher, key, gate, context.now)


def _win_totals(context: IngestContext) -> str:
    with context.engine.begin() as conn:
        return vegas.run_win_totals(
            conn, context.fetcher, PRODUCT_SEASON, context.now, first_kickoff_for(conn, PRODUCT_SEASON)
        )


def ingest_step(context: IngestContext) -> StepRecord:
    lines = []
    adp_failed = False
    for name, body in (("capture", _capture), ("adp", _adp), ("props", _props), ("win totals", _win_totals)):
        line, failed = _guarded(name, body, context)
        lines.append(line)
        adp_failed = adp_failed or (name == "adp" and failed)
    return StepRecord("ingest", "failed" if adp_failed else "ran", "; ".join(lines))


def run_fit_step(engine: Engine, now: datetime) -> StepRecord:
    """The board's check, and every unported fit named: re-runnable, or the seasons it still lacks."""
    with engine.begin() as conn:
        record = fit_step(conn, now, load_model_artifacts(conn), ARM64_BOARDS)
        readiness = fit_readiness(conn)
    ready = [fit for fit, reason in readiness.items() if reason is None]
    blocked = [f"{fit} ({reason})" for fit, reason in readiness.items() if reason is not None]
    fits = f"unported fits with every input held: {', '.join(ready) or 'none'}" + (
        f"; blocked: {'; '.join(blocked)}" if blocked else ""
    )
    checked = " The board was not checked tonight, which is not a pass." if record.status == "skipped" else ""
    return StepRecord("fit", record.status, f"{record.summary}.{checked} {fits}")
