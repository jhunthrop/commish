"""THE NIGHTLY'S INGEST AND FIT STEPS, ported from `research-ts/src/nightly/steps.ts`.

INGEST: the provider capture the capsules read facts from (injuries, news, depth charts, inactives,
game lines; skipped by name without TANK01_API_KEY), tonight's ADP in every format the run carries
(the three scoring formats, and two-quarterback drafts for the superflex board), the pre-kickoff
props snapshot and the published win totals (both no-ops once the product season has kicked off,
and the props skipped by name without ODDS_API_KEY). Each part runs in its own transaction, so one
failed feed keeps the others. The step fails only when the PPR ADP capture failed, the one every
page reads.

The fantasy hosts' player ids (`pipeline.host_ids`) are refreshed beside them, so a Sleeper draft
or a MyFantasyLeague league joins the universe on tonight's map.

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
from research.model.priors import ModelArtifacts, load_model_artifacts
from research.model.reads.teams import first_kickoff_for
from research.model.ros.raw_line import keep_raw_line
from research.pipeline import vegas
from research.pipeline.host_ids import ingest_host_ids
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
    # The capsule step's demoted pages (`capsule_demotion.Demotion.json`), carried beside its summary.
    demoted: tuple[Mapping[str, str], ...] | None = None

    def json(self) -> dict[str, object]:
        record: dict[str, object] = {"name": self.name, "status": self.status, "summary": self.summary}
        return record if self.demoted is None else {**record, "demoted": [dict(d) for d in self.demoted]}


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


def _host_ids(context: IngestContext) -> str:
    with context.engine.begin() as conn:
        return str(ingest_host_ids(conn, context.fetcher))


def ingest_step(context: IngestContext) -> StepRecord:
    lines = []
    adp_failed = False
    parts = (
        ("capture", _capture),
        ("adp", _adp),
        ("host ids", _host_ids),
        ("props", _props),
        ("win totals", _win_totals),
    )
    for name, body in parts:
        line, failed = _guarded(name, body, context)
        lines.append(line)
        adp_failed = adp_failed or (name == "adp" and failed)
    return StepRecord("ingest", "failed" if adp_failed else "ran", "; ".join(lines))


def run_fit_step(engine: Engine, now: datetime) -> StepRecord:
    """The board's check, and every unported fit named: re-runnable, or the seasons it still lacks."""
    with engine.begin() as conn:
        artifacts = load_model_artifacts(conn)
        record = fit_step(conn, now, artifacts, ARM64_BOARDS)
        readiness = fit_readiness(conn)
    raw = _raw_line(engine, now, artifacts)
    ready = [fit for fit, reason in readiness.items() if reason is None]
    blocked = [f"{fit} ({reason})" for fit, reason in readiness.items() if reason is not None]
    fits = f"unported fits with every input held: {', '.join(ready) or 'none'}" + (
        f"; blocked: {'; '.join(blocked)}" if blocked else ""
    )
    checked = " The board was not checked tonight, which is not a pass." if record.status == "skipped" else ""
    return StepRecord("fit", record.status, f"{record.summary}.{checked} {fits}; {raw}")


def _raw_line(engine: Engine, now: datetime, artifacts: ModelArtifacts) -> str:
    """Once the product season has kicked off, the served raw board's line for the rest-of-season
    model (`model.ros.raw_line`), kept once per generation and code. Its failure is a line in the
    summary, never the step's: without it the boards stay preseason and the report says why."""
    try:
        with engine.begin() as conn:
            kickoff = first_kickoff_for(conn, PRODUCT_SEASON)
            if kickoff is None or now < kickoff:
                return "raw line: the season has not kicked off"
            return keep_raw_line(conn, PRODUCT_SEASON, now, artifacts, ARM64_BOARDS)
    except Exception as error:
        return f"raw line: not kept ({type(error).__name__}: {error})"
