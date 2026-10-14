"""THE NIGHTLY RUN'S PARTS: its isolated steps, the held-out scores, the manifest, the faces.

Each step runs isolated: one that raises becomes a failed `StepRecord` naming the error, and the run
goes on to write its report (the oracle's `runStep`). The capsule step's gate is then judged on what
is stored, so a crashed sweep still gates the board as it stands.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final

import httpx
from sqlalchemy import Engine

from research.capsules.sweep import FactsPassMemo
from research.db.code_digest import code_digest
from research.db.read_cache import ReadCache, snapshot
from research.db.value_codec import ValueCodec
from research.model.arithmetic import model_version
from research.model.artifacts import read_artifact
from research.model.backtest import HeldOutScore, held_out_scores
from research.model.instants import js_iso
from research.nightly.assemble import Assembled
from research.nightly.build.season import format_json
from research.nightly.capsule_gate import CapsuleGateResult, capsule_gate, span_rules
from research.nightly.capsule_step import CapsuleSpend, CapsuleStepPlan, night_facts, run_capsule_step
from research.nightly.config import HELD_OUT_BASELINE_KEY, IMPLEMENTATION
from research.nightly.headshots import Face, mirror_headshots
from research.nightly.page_findings import page_findings
from research.nightly.publish import read_json
from research.nightly.register_log import FrozenBy, carried_note, last_pass
from research.nightly.run_store import RunStore
from research.nightly.steps import IngestContext, StepRecord, ingest_step, run_fit_step
from research.pipeline.http import Fetcher
from research.season import PRODUCT_SEASON

Json = dict[str, Any]
Log = Callable[[str], None]
# The held-out scores move only when the served board or a held-out season's outcomes do, so the
# nightly reads them through the read cache (`db.read_cache`): about 30 MB of outcomes a night
# before, the statements' fingerprints after.
HELD_OUT_CODEC: Final = ValueCodec((HeldOutScore,))
HELD_OUT_CACHE: Final = "nightly/held-out-scores"


@dataclass(frozen=True, slots=True)
class StepOutcome:
    record: StepRecord
    capsule_gate: CapsuleGateResult | None = None
    page_reasons: tuple[str, ...] = ()
    spend: CapsuleSpend | None = None


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
        result = run_capsule_step(engine, clock(), plan, log, facts)
        status = "ran" if result.wrote else "skipped"
        record = StepRecord("capsules", status, f"{result.spend.line()}; {result.gate.summary()}")
        return StepOutcome(record, result.gate, tuple(result.findings.reasons), result.spend)
    with engine.connect() as conn:
        gate = capsule_gate(conn, clock(), span_rules(conn, clock(), facts))
        findings = page_findings(conn, clock(), facts)
    return StepOutcome(
        StepRecord("capsules", "skipped", "skipped by --skip; the gate judges what is stored"),
        gate,
        tuple(findings.reasons),
    )


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
    steps = [
        _isolated("ingest", lambda: skipped if "ingest" in skip else StepOutcome(ingest_step(IngestContext(engine, fetcher, clock(), environ))), log),
        _isolated("fit", lambda: StepOutcome(StepRecord("fit", "skipped", "skipped by --skip") if "fit" in skip else run_fit_step(engine, clock())), log),
        _isolated("capsules", lambda: _capsules(engine, clock, log, "capsules" in skip, plan, facts), log),
    ]  # fmt: skip
    capsule = steps[-1]
    if capsule.capsule_gate is None:
        # The step raised: the gate still judges the board as stored.
        with engine.connect() as conn:
            gate = capsule_gate(conn, clock(), span_rules(conn, clock(), facts))
            findings = page_findings(conn, clock(), facts)
        steps[-1] = StepOutcome(capsule.record, gate, tuple(findings.reasons))
    return steps


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


def mirror_faces(http: httpx.Client, store: RunStore, assembled: Assembled, skip: bool) -> tuple[Json, str]:
    if skip:
        return {}, "skipped by --skip"
    faces = [Face(p.id, p.headshot) for p in assembled.people if p.headshot]
    result = mirror_headshots(http, store, faces)
    counts = ", ".join(f"{count} {outcome}" for outcome, count in sorted(result.counts.items()))
    return result.by_player, f"{len(faces)} faces: {counts}"


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
        "formats": [format_json(f, PRODUCT_SEASON) for f in assembled.formats],
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
