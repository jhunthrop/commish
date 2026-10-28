"""THE NIGHTLY RUN (spec §4): ingest, fit, capsules, then every artifact of spec §2.1 under one run id,
the validation gates, the report, and the manifest last. The faces are our copies (`research.headshots`).

The run is first written to a local staging directory, where the web's own reader checks it (the
`schema` gate); only then is it copied to the store, artifacts first, `report.json` and
`manifest.json` last. A run that passes every gate (and whose steps did not fail) becomes the
early-access run at once and public an hour later (`publish`). A run that fails is written and kept
for diagnosis, its report naming every failed gate's reasons, and no pointer moves, so the site
keeps building from the last clean run. Every step is isolated: one that raises is a failed step in
the report, never a run that dies without one. The held-out baseline moves whenever the backtest
gate passed (`research-ts/src/nightly/publish.ts`).
"""

import tempfile
from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass, field, replace
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import Engine

from research.model.backtest import HeldOutScore
from research.model.instants import js_iso
from research.nightly import gates
from research.nightly.assemble import Assembled, assemble
from research.nightly.capsule_demotion import DEMOTED_KEY, carried_demotions
from research.nightly.capsule_step import CapsuleSpend, CapsuleStepPlan
from research.nightly.config import HELD_OUT_BASELINE_KEY
from research.nightly.held_pages import HeldPage, alert_line, hold_refused_pages
from research.nightly.publish import ArtifactWriter, encode, promote_early, read_json, run_key, take_run_id
from research.nightly.reads.record import frozen_weeks
from research.nightly.register_log import FrozenBy, carry_forward, read_frozen_by, save_frozen_by
from research.nightly.run_parts import (
    StepOutcome,
    held_out,
    manifest_of,
    rollover_instant,
    ros_setup,
    run_steps,
)
from research.nightly.run_store import LocalRunStore, RunStore
from research.nightly.week_reads import ADVISORY
from research.nightly.week_reads import STEP as WEEK_READS
from research.pipeline.http import Fetcher
from research.season import PRODUCT_SEASON
from research.web_contract import contract_dir

STEPS = ("ingest", "fit", "capsules", WEEK_READS)
Json = dict[str, Any]


@dataclass(frozen=True, slots=True)
class RunOptions:
    skip: frozenset[str] = frozenset()
    capsules: CapsuleStepPlan = field(default_factory=CapsuleStepPlan)


@dataclass(frozen=True, slots=True)
class RunDeps:
    engine: Engine
    store: RunStore
    fetcher: Fetcher
    environ: Mapping[str, str]
    clock: Callable[[], datetime]
    log: Callable[[str], None]


@dataclass(frozen=True, slots=True)
class RunOutcome:
    run_id: str
    passed: bool
    summary: str


def _copy_run(staging: LocalRunStore, store: RunStore, run_id: str, paths: list[str]) -> None:
    """Every staged file into the store, the report and the manifest last."""
    last = ("report.json", "manifest.json")
    for path in [*(p for p in paths if p not in last), *(p for p in last if p in paths)]:
        body = staging.get(run_key(run_id, path))
        if body is None:
            raise FileNotFoundError(f"{path} was not staged")
        store.put(run_key(run_id, path), body, "application/json")


def carry_demotions(store: RunStore, plan: CapsuleStepPlan, log: Callable[[str], None]) -> CapsuleStepPlan:
    """Tonight's capsule plan with the last night's demotions (`DEMOTED_KEY`), written first tonight. A
    list that cannot be read is named and carries nothing: it is an aid to the writer, never the night."""
    try:
        carried = carried_demotions(read_json(store, DEMOTED_KEY))
    except Exception as error:
        # A malformed list (ValueError) or a store read that failed: named, and the night goes on.
        log(f"capsules: the last night's demotions were not read ({error})")
        return plan
    if carried:
        pages = "page" if len(carried) == 1 else "pages"
        slugs = ", ".join(d.slug for d in carried)
        log(f"capsules: {len(carried)} {pages} demoted last night is written first tonight: {slugs}")
    return replace(plan, carried=carried)


def keep_demotions(store: RunStore, run_id: str, steps: list[StepOutcome]) -> None:
    """The capsule step's demotions, kept for the next night whenever the step wrote (an empty list
    clears the last one); a night that did not write leaves the last list for the next that does."""
    capsule = next((s for s in steps if s.record.name == "capsules"), None)
    if capsule is None or capsule.record.status != "ran":
        return
    body = {"runId": run_id, "demoted": [d.json() for d in capsule.demoted]}
    store.put(DEMOTED_KEY, encode(body), "application/json")


def _failed(deps: RunDeps, run_id: str, steps: list[StepOutcome], error: BaseException) -> RunOutcome:
    """A run that could not be assembled: its report alone, no pointer moved."""
    report = {"runId": run_id, "status": "failed", "steps": [s.record.json() for s in steps], "error": str(error)}
    try:
        deps.store.put(run_key(run_id, "report.json"), encode(report), "application/json")
    except Exception as unwritten:
        # The bucket itself may be what failed; the log line below still carries the error.
        deps.log(f"run {run_id}: the failure report could not be written ({unwritten})")
    deps.log(f"run {run_id} FAILED: {error}")
    return RunOutcome(run_id, False, str(error))


@dataclass(frozen=True, slots=True)
class Judged:
    gates: list[gates.GateRecord]
    held_out: list[HeldOutScore]
    # The pages the schema gate held back (Lane 136), none on a run that failed it.
    held: tuple[HeldPage, ...] = ()


def _judge(deps: RunDeps, assembled: Assembled, steps: list[StepOutcome], draft: Json) -> Judged:
    files = assembled.files
    scores, previous = held_out(deps.engine, deps.store)
    capsule = next(s for s in steps if s.record.name == "capsules")
    if capsule.capsule_gate is None:
        raise RuntimeError("run_steps always judges the capsules; the capsule step carries no gate")
    records = [
        gates.held_out_gate(scores, previous),
        gates.depth_gate(assembled.formats, {f.id: files[f"boards/{f.id}.json"] for f in assembled.formats}),
        gates.capsule_gate(capsule.capsule_gate, capsule.page_reasons),
        gates.adp_gate(assembled.formats, files["adp.json"]),
        gates.basis_gate(draft, files["adp.json"], files["record.json"], files["schedule.json"]),
        gates.club_gate([files[f"players/{who.id}.json"] for who in assembled.people]),
    ]
    return Judged(records, scores)


def with_reach(manifest: Json, reach: Json | None) -> Json:
    """The final manifest with the run's season reach the schema gate's reader counted (Lane 205), which
    the web build and the API read rather than count again; as it was when the gate refused the run and
    counted none. The staged manifest the gate reads never carries it."""
    return manifest if reach is None else {**manifest, "reach": reach}


def _stage(run_id: str, files: Mapping[str, Any], staging: LocalRunStore) -> ArtifactWriter:
    writer = ArtifactWriter(staging, run_id, [])
    for path, value in files.items():
        writer.write(path, value)
    return writer


def run_nightly(deps: RunDeps, options: RunOptions) -> RunOutcome:
    started = deps.clock()
    run_id = take_run_id(deps.store, started)
    deps.log(f"run {run_id}: season {PRODUCT_SEASON}, writing to {deps.store.locate(f'runs/{run_id}')}")
    plan = carry_demotions(deps.store, options.capsules, deps.log)
    steps = run_steps(deps.engine, deps.fetcher, deps.environ, deps.clock, deps.log, options.skip, plan)
    try:
        keep_demotions(deps.store, run_id, steps)
    except Exception as unkept:
        # An aid to the next night's writer, never this night's verdict: named, and the run goes on.
        deps.log(f"capsules: tonight's demotions were not kept for the next night ({unkept})")
    try:
        with deps.engine.connect() as conn:
            frozen_by = carry_forward(
                read_frozen_by(deps.store), PRODUCT_SEASON, frozen_weeks(conn, PRODUCT_SEASON), run_id
            )
            instant = deps.clock()
            ros = ros_setup(deps.engine, instant, deps.log)
            assembled = assemble(conn, instant, frozen_by, ros, rollover_instant(steps))
    except Exception as error:
        return _failed(deps, run_id, steps, error)
    for line in assembled.dropped:
        deps.log(f"format not carried tonight, {line}")
    deps.log(f"boards: {assembled.rest_status}")
    try:
        with tempfile.TemporaryDirectory(prefix="nightly-") as root:
            return _finish(deps, options, run_id, started, steps, assembled, frozen_by, Path(root))
    except Exception as error:
        # Review N11: a held-out read or the copy to the bucket that raises fails the
        # run with its report, as an assembly error does; no pointer has moved.
        return _failed(deps, run_id, steps, error)


def _finish(  # noqa: PLR0913, PLR0917 - the run's parts, handed on from `run_nightly`
    deps: RunDeps,
    options: RunOptions,
    run_id: str,
    started: datetime,
    steps: list[StepOutcome],
    assembled: Assembled,
    frozen_by: FrozenBy,
    root: Path,
) -> RunOutcome:
    staging = LocalRunStore(root)
    finished = deps.clock()
    judged = _judge(deps, assembled, steps, manifest_of(run_id, finished, assembled, "pending", deps.store, frozen_by))
    writer = _stage(run_id, assembled.files, staging)
    staging.put(
        run_key(run_id, "manifest.json"),
        encode(manifest_of(run_id, finished, assembled, "pending", deps.store, frozen_by)),
        "application/json",
    )
    schema = hold_refused_pages(
        root, run_id, contract_dir(dict(deps.environ)), deps.store, len(assembled.people), deps.log
    )
    judged = replace(judged, gates=[*judged.gates, schema.record], held=schema.held)
    for path, value in schema.files().items():
        writer.write(path, value)
    for gate in judged.gates:
        deps.log(f"gate {gate.gate}: {'passed' if gate.passed else 'FAILED'}, {gate.summary}")
    # An advisory step's failure is in the report and never holds the board back (`week_reads.ADVISORY`).
    passed = all(g.passed for g in judged.gates) and all(
        s.record.status != "failed" for s in steps if s.record.name not in ADVISORY
    )
    manifest = with_reach(
        manifest_of(run_id, finished, assembled, "passed" if passed else "failed", deps.store, frozen_by),
        schema.reach,
    )
    report: Json = {
        "runId": run_id,
        "status": manifest["status"],
        "startedAt": js_iso(started),
        "finishedAt": js_iso(finished),
        "steps": [s.record.json() for s in steps],
        "gates": [g.json() for g in judged.gates],
        "heldOut": [{"season": s.season, "rankCorrelation": s.rank_correlation, "sampleSize": s.sample_size} for s in judged.held_out],
        "capsuleSpend": next((asdict(s.spend) for s in steps if isinstance(s.spend, CapsuleSpend)), None),
        "formatsNotCarried": list(assembled.dropped),
        "restOfSeason": assembled.rest_status,
        "held": [h.json() for h in judged.held],
        "artifacts": writer.records,
    }  # fmt: skip
    writer.write("report.json", report)
    writer.write("manifest.json", manifest)
    _copy_run(staging, deps.store, run_id, [r["path"] for r in writer.records])
    if judged.gates[0].passed:
        deps.store.put(
            HELD_OUT_BASELINE_KEY, encode({"runId": run_id, "heldOut": report["heldOut"]}), "application/json"
        )
    return _promote(deps, run_id, finished, passed, judged, steps, assembled, frozen_by)


def _promote(  # noqa: PLR0913, PLR0917 - the verdict and what it moves
    deps: RunDeps,
    run_id: str,
    finished: datetime,
    passed: bool,
    judged: Judged,
    steps: list[StepOutcome],
    assembled: Assembled,
    frozen_by: FrozenBy,
) -> RunOutcome:
    pages = sum(1 for path, page in assembled.files.items() if path.startswith("players/") and page["capsule"])
    line = (
        f"run {run_id} {'PASSED' if passed else 'FAILED'}: {len(assembled.formats)} boards, "
        f"{len(assembled.people)} players, {pages} capsules, {len(assembled.files) + 3} files"
    )
    if passed:
        save_frozen_by(deps.store, frozen_by, PRODUCT_SEASON)
        line += f"; early access now, public at {js_iso(promote_early(deps.store, run_id, finished))}"
        if judged.held:
            deps.log(alert_line(run_id, judged.held))
    else:
        failed = [g.gate for g in judged.gates if not g.passed] + [
            s.record.name for s in steps if s.record.status == "failed" and s.record.name not in ADVISORY
        ]
        line += f"; failed: {', '.join(failed)}"
    deps.log(line)
    return RunOutcome(run_id, passed, line)
