"""THE NIGHTLY RUN'S PARTS: its isolated steps, the held-out scores, the manifest, the faces.

Each step runs isolated: one that raises becomes a failed `StepRecord` naming the error, and the run
goes on to write its report (the oracle's `runStep`). The capsule step's gate is then judged on what
is stored, so a crashed sweep still gates the board as it stands.
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final

from sqlalchemy import Engine

from research.capsules.sweep import FactsPassMemo
from research.db.code_digest import code_digest
from research.db.read_cache import ReadCache, snapshot
from research.db.value_codec import ValueCodec
from research.model.arithmetic import model_version
from research.model.artifacts import read_artifact
from research.model.backtest import HeldOutScore, held_out_scores
from research.model.instants import js_iso
from research.model.ros.live import FIRST_MODEL_WEEK, SeasonPlayer, load_ros_priors, season_players
from research.model.ros.raw_line import RawLine, latest_raw_line, raw_generation
from research.nightly.assemble import Assembled
from research.nightly.build.ros import RosSetup
from research.nightly.build.season import format_json
from research.nightly.capsule_demotion import Demotion, demotion_line
from research.nightly.capsule_gate import CapsuleGateResult, capsule_gate, span_rules
from research.nightly.capsule_step import (
    CapsuleSpend,
    CapsuleStepError,
    CapsuleStepPlan,
    night_facts,
    run_capsule_step,
)
from research.nightly.config import HELD_OUT_BASELINE_KEY, IMPLEMENTATION
from research.nightly.page_findings import page_findings
from research.nightly.publish import read_json
from research.nightly.reads.schedule import slates_by_club, weeks_left_at
from research.nightly.register_log import FrozenBy, carried_note, last_pass
from research.nightly.run_store import RunStore
from research.nightly.steps import IngestContext, StepRecord, ingest_step, run_fit_step
from research.nightly.week_reads import STEP as WEEK_READS
from research.nightly.week_reads import run_week_read_step
from research.pipeline.http import Fetcher
from research.season import PRODUCT_SEASON

Json = dict[str, Any]
Log = Callable[[str], None]
# The held-out scores move only when the served board or a held-out season's outcomes do, so the
# nightly reads them through the read cache (`db.read_cache`): about 30 MB of outcomes a night
# before, the statements' fingerprints after.
HELD_OUT_CODEC: Final = ValueCodec((HeldOutScore,))
HELD_OUT_CACHE: Final = "nightly/held-out-scores"
# The rest-of-season model's prior, the season's raw board, moves only when a new generation is
# written, so it is read through the cache too (one statement, its fingerprint on later nights).
ROS_CODEC: Final = ValueCodec((RawLine, SeasonPlayer))
ROS_RAW_CACHE: Final = "nightly/ros-raw-line"


@dataclass(frozen=True, slots=True)
class StepOutcome:
    record: StepRecord
    capsule_gate: CapsuleGateResult | None = None
    page_reasons: tuple[str, ...] = ()
    spend: CapsuleSpend | None = None
    demoted: tuple[Demotion, ...] = ()
    # The instant the step judged at (the week-reads step's, which the assembly judges the roll-over at).
    at: datetime | None = None


def _isolated(name: str, body: Callable[[], StepOutcome], log: Log) -> StepOutcome:
    try:
        outcome = body()
    except Exception as error:
        outcome = StepOutcome(StepRecord(name, "failed", f"{type(error).__name__}: {error}"))
    log(f"{name}: {outcome.record.status}, {outcome.record.summary}")
    return outcome


def _capsules(  # noqa: PLR0913, PLR0917 - the step's parts
    engine: Engine, clock: Callable[[], datetime], log: Log, skip: bool, plan: CapsuleStepPlan, facts: FactsPassMemo
) -> StepOutcome:
    if not skip:
        try:
            result = run_capsule_step(engine, clock(), plan, log, facts)
        except CapsuleStepError as failed:
            # The step failed part way; what it spent still rides on the run's report.
            return StepOutcome(StepRecord("capsules", "failed", f"{failed}, {failed.spend.line()}"), spend=failed.spend)
        status = "ran" if result.wrote else "skipped"
        demoted = "" if not result.demoted else f"; {demotion_line(result.demoted)}"
        summary = f"{result.spend.line()}{demoted}; {result.gate.summary()}"
        record = StepRecord("capsules", status, summary, tuple(d.json() for d in result.demoted))
        return StepOutcome(record, result.gate, tuple(result.findings.reasons), result.spend, result.demoted)
    at = clock()  # one instant for the gate, the span rules and the page findings: one facts pass
    with engine.connect() as conn:
        gate = capsule_gate(conn, at, span_rules(conn, at, facts))
        findings = page_findings(conn, at, facts)
    return StepOutcome(
        StepRecord("capsules", "skipped", "skipped by --skip; the gate judges what is stored"),
        gate,
        tuple(findings.reasons),
    )


def held_clock(clock: Callable[[], datetime]) -> Callable[[], datetime]:
    """A clock that reads `clock` once, on its first call, and returns that instant from then on."""
    held: list[datetime] = []

    def read() -> datetime:
        if not held:
            held.append(clock())
        return held[0]

    return read


def run_steps(  # noqa: PLR0913, PLR0917 - the steps' shared dependencies
    engine: Engine,
    fetcher: Fetcher,
    environ: Mapping[str, str],
    clock: Callable[[], datetime],
    log: Log,
    skip: frozenset[str],
    plan: CapsuleStepPlan,
) -> list[StepOutcome]:
    skipped = StepOutcome(StepRecord("ingest", "skipped", "skipped by --skip"))
    # One facts pass for the capsule step and every gate after it (`FactsPassMemo`).
    facts = night_facts(engine)
    # The capsule step's instant, held from its first read, so the fallback gate below reads the facts
    # pass the step already holds rather than a second one (`FactsPassMemo` keys on the instant).
    capsule_clock = held_clock(clock)
    steps = [
        _isolated("ingest", lambda: skipped if "ingest" in skip else StepOutcome(ingest_step(IngestContext(engine, fetcher, clock(), environ))), log),
        _isolated("fit", lambda: StepOutcome(StepRecord("fit", "skipped", "skipped by --skip") if "fit" in skip else run_fit_step(engine, clock())), log),
        _isolated("capsules", lambda: _capsules(engine, capsule_clock, log, "capsules" in skip, plan, facts), log),
    ]  # fmt: skip
    capsule = steps[-1]
    if capsule.capsule_gate is None:
        # The step raised: the gate still judges the board as stored.
        at = capsule_clock()
        with engine.connect() as conn:
            gate = capsule_gate(conn, at, span_rules(conn, at, facts))
            findings = page_findings(conn, at, facts)
        steps[-1] = StepOutcome(capsule.record, gate, tuple(findings.reasons))
    # The week-ahead reads, on the capsule step's instant and facts pass (Lane 72); advisory to the verdict.
    steps.append(_isolated(WEEK_READS, lambda: _week_reads(engine, capsule_clock(), log, facts, WEEK_READS in skip), log))  # fmt: skip
    return steps


def _week_reads(engine: Engine, at: datetime, log: Log, facts: FactsPassMemo, skipped: bool) -> StepOutcome:
    """The week-reads step's outcome with the instant it judged the roll-over at (Lane 265, L5)."""
    record = (
        StepRecord(WEEK_READS, "skipped", "skipped by --skip")
        if skipped
        else run_week_read_step(engine, at, log, facts)
    )
    return StepOutcome(record, at=at)


def rollover_instant(steps: Sequence[StepOutcome]) -> datetime | None:
    """The instant the week-reads step judged the roll-over at, for the assembly's promise; None when it raised."""
    return next((s.at for s in steps if s.record.name == WEEK_READS and s.at is not None), None)


def held_out(engine: Engine, store: RunStore) -> tuple[list[HeldOutScore], Mapping[int, float] | None]:
    cache = ReadCache(engine, HELD_OUT_CODEC, code_digest("research.model.backtest"))
    # One snapshot for the read and its fingerprints, so the cache may keep it (`db.read_cache`).
    with snapshot(engine) as conn:
        seasons = [int(s) for s in read_artifact(conn, "model/weekly-priors").payload["heldOutSeasons"]]
        scores = cache.through(conn, HELD_OUT_CACHE, [seasons], None, lambda: held_out_scores(conn, seasons))
    baseline = read_json(store, HELD_OUT_BASELINE_KEY)
    previous = (
        None if baseline is None else {int(s["season"]): float(s["rankCorrelation"]) for s in baseline["heldOut"]}
    )
    return scores, previous


def ros_setup(engine: Engine, instant: datetime, log: Log) -> RosSetup:
    """The rest-of-season model's stored inputs: the pinned artifact, the raw line the fit step kept
    (through the read cache), and, once the switch week is reached by the stored schedule, the season's
    players with a line. A read that fails leaves the artifact missing, so the boards stay preseason
    and say why."""
    cache = ReadCache(engine, ROS_CODEC, code_digest("research.model.ros.raw_line"), log)
    try:
        with snapshot(engine) as conn:
            priors = load_ros_priors(conn)
            moment = raw_generation(conn, PRODUCT_SEASON)
            raw = (
                None
                if moment is None
                else cache.through(
                    conn,
                    ROS_RAW_CACHE,
                    [PRODUCT_SEASON, js_iso(moment.at)],
                    None,
                    lambda: latest_raw_line(conn, PRODUCT_SEASON, moment),
                )
            )
            weeks = weeks_left_at(conn, PRODUCT_SEASON, slates_by_club(conn, PRODUCT_SEASON), instant)
            switched = priors is not None and bool(weeks) and min(weeks) >= FIRST_MODEL_WEEK
            players = season_players(conn, PRODUCT_SEASON, instant) if switched else ()
    except Exception as error:
        why = f"{type(error).__name__}: {error}"
        log(f"rest of season: the model's inputs could not be read ({why})")
        return RosSetup(None, None, unread=why)
    return RosSetup(priors, raw, players)


def manifest_of(  # noqa: PLR0913, PLR0917 - every field the manifest names
    run_id: str, finished: datetime, assembled: Assembled, status: str, store: RunStore, frozen_by: FrozenBy
) -> Json:
    note = carried_note(frozen_by, PRODUCT_SEASON, run_id)
    notes = [] if note is None else [note]
    return {
        "runId": run_id,
        "runAt": js_iso(finished),
        "season": PRODUCT_SEASON,
        "implementation": IMPLEMENTATION,
        "standIn": False,
        "formats": [
            format_json(f, PRODUCT_SEASON, assembled.rest if f.id in assembled.rest_formats else None)
            for f in assembled.formats
        ],
        "players": len(assembled.people),
        "sources": list(assembled.sources),
        # Past the web's schema, which reads only the fields above: who made the numbers, the
        # verdict, and the register's last weekly pass (a failed freeze shows here too).
        "modelVersion": ", ".join(assembled.model_versions),
        "codeVersion": model_version(),
        "status": status,
        "register": last_pass(store),
        "registerNotes": notes,
    }
