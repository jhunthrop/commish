"""THE NIGHTLY RUN (spec §4): ingest, fit, capsules, then every artifact of spec §2.1 under one run id,
the validation gates, the headshots, the report, and the manifest last.

A run that passes every gate (and whose steps did not fail) becomes the early-access run at once
and public an hour later (`publish`). A run that fails is written and kept for diagnosis, its report
naming every failed gate's reasons, and no pointer moves, so the site keeps building from the last
clean run. The held-out baseline moves whenever the backtest gate passed, so another gate failing
tonight never stalls it (`research-ts/src/nightly/publish.ts`).
"""

from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any

import httpx
from sqlalchemy import Engine

from research.model.arithmetic import model_version
from research.model.artifacts import read_artifact
from research.model.backtest import HeldOutScore, held_out_scores
from research.model.instants import js_iso
from research.nightly import gates
from research.nightly.assemble import Assembled, AssemblyError, assemble
from research.nightly.build.season import format_json
from research.nightly.capsule_gate import CapsuleGateResult, capsule_gate
from research.nightly.capsule_step import CapsuleSpend, CapsuleStepPlan, run_capsule_step
from research.nightly.config import HELD_OUT_BASELINE_KEY, IMPLEMENTATION, PRODUCT_SEASON
from research.nightly.headshots import Face, mirror_headshots
from research.nightly.page_findings import PageFindings, page_findings
from research.nightly.publish import ArtifactWriter, encode, promote_early, read_json, take_run_id
from research.nightly.run_store import RunStore
from research.nightly.steps import IngestContext, StepRecord, ingest_step, run_fit_step
from research.pipeline.http import Fetcher

STEPS = ("ingest", "fit", "capsules", "headshots")
Json = dict[str, Any]


@dataclass(frozen=True, slots=True)
class RunOptions:
    skip: frozenset[str] = frozenset()
    capsules: CapsuleStepPlan = field(default_factory=CapsuleStepPlan)


@dataclass(frozen=True, slots=True)
class RunDeps:
    engine: Engine
    store: RunStore
    http: httpx.Client
    fetcher: Fetcher
    environ: Mapping[str, str]
    clock: Callable[[], datetime]
    log: Callable[[str], None]


@dataclass(frozen=True, slots=True)
class RunOutcome:
    run_id: str
    passed: bool
    summary: str


def _held_out(deps: RunDeps) -> tuple[list[HeldOutScore], Mapping[int, float] | None]:
    with deps.engine.connect() as conn:
        seasons = [int(s) for s in read_artifact(conn, "model/weekly-priors").payload["heldOutSeasons"]]
        scores = held_out_scores(conn, seasons)
    baseline = read_json(deps.store, HELD_OUT_BASELINE_KEY)
    previous = (
        None if baseline is None else {int(s["season"]): float(s["rankCorrelation"]) for s in baseline["heldOut"]}
    )
    return scores, previous


def _steps(
    deps: RunDeps, options: RunOptions
) -> tuple[list[StepRecord], tuple[CapsuleGateResult, PageFindings, CapsuleSpend | None]]:
    records: list[StepRecord] = []
    if "ingest" in options.skip:
        records.append(StepRecord("ingest", "skipped", "skipped by --skip"))
    else:
        records.append(ingest_step(IngestContext(deps.engine, deps.fetcher, deps.clock(), deps.environ)))
    deps.log(f"ingest: {records[-1].status}, {records[-1].summary}")
    records.append(
        StepRecord("fit", "skipped", "skipped by --skip")
        if "fit" in options.skip
        else run_fit_step(deps.engine, deps.clock())
    )
    deps.log(f"fit: {records[-1].status}, {records[-1].summary}")
    if "capsules" in options.skip:
        with deps.engine.connect() as conn:
            gate = capsule_gate(conn, deps.clock())
            findings = page_findings(conn, deps.clock())
        records.append(StepRecord("capsules", "skipped", "skipped by --skip; the gate judges what is stored"))
        return records, (gate, findings, None)
    result = run_capsule_step(deps.engine, deps.clock(), options.capsules, deps.log)
    status = "ran" if result.wrote else "skipped"
    records.append(StepRecord("capsules", status, f"{result.spend.line()}; {result.gate.summary()}"))
    return records, (result.gate, result.findings, result.spend)


def _headshots(deps: RunDeps, assembled: Assembled, skip: bool) -> tuple[Json, str]:
    if skip:
        return {}, "skipped by --skip"
    faces = [Face(p.id, p.headshot) for p in assembled.people if p.headshot]
    result = mirror_headshots(deps.http, deps.store, faces)
    counts = ", ".join(f"{count} {outcome}" for outcome, count in sorted(result.counts.items()))
    return result.by_player, f"{len(faces)} faces: {counts}"


def _manifest(run_id: str, finished: datetime, assembled: Assembled, status: str) -> Json:
    return {
        "runId": run_id,
        "runAt": js_iso(finished),
        "season": PRODUCT_SEASON,
        "implementation": IMPLEMENTATION,
        "standIn": False,
        "formats": [format_json(f, PRODUCT_SEASON) for f in assembled.formats],
        "players": len(assembled.people),
        "sources": list(assembled.sources),
        # Past the web's schema, which reads only the fields above: who made the numbers and the verdict.
        "modelVersion": ", ".join(assembled.model_versions),
        "codeVersion": model_version(),
        "status": status,
    }


def run_nightly(deps: RunDeps, options: RunOptions) -> RunOutcome:
    started = deps.clock()
    run_id = take_run_id(deps.store, started)
    deps.log(f"run {run_id}: season {PRODUCT_SEASON}, writing to {deps.store.locate(f'runs/{run_id}')}")
    steps, (capsule_result, findings, spend) = _steps(deps, options)
    as_of = deps.clock()
    writer = ArtifactWriter(deps.store, run_id, [])
    try:
        with deps.engine.connect() as conn:
            assembled = assemble(conn, as_of)
    except AssemblyError as error:
        failure: Json = {"runId": run_id, "status": "failed", "steps": [s.json() for s in steps], "error": str(error)}
        writer.write("report.json", failure)
        deps.log(f"run {run_id} FAILED: {error}")
        return RunOutcome(run_id, False, str(error))
    files = assembled.files
    for line in assembled.dropped:
        deps.log(f"format not carried tonight, {line}")
    held_out, previous = _held_out(deps)
    record_set = [
        gates.held_out_gate(held_out, previous),
        gates.depth_gate(assembled.formats, {f.id: files[f"boards/{f.id}.json"] for f in assembled.formats}),
        gates.capsule_gate(capsule_result, findings.reasons),
        gates.adp_gate(assembled.formats, files["adp.json"]),
    ]
    finished = deps.clock()
    draft = _manifest(run_id, finished, assembled, "pending")
    players = [files[f"players/{p.id}.json"] for p in assembled.people]
    record_set += [
        gates.basis_gate(draft, files["adp.json"], files["record.json"], files["schedule.json"]),
        gates.contract_gate(draft, files["index.json"], players, files["clubs.json"], files["schedule.json"]),
    ]
    for gate in record_set:
        deps.log(f"gate {gate.gate}: {'passed' if gate.passed else 'FAILED'}, {gate.summary}")
    headshots, headshot_line = _headshots(deps, assembled, "headshots" in options.skip)
    deps.log(f"headshots: {headshot_line}")
    passed = all(g.passed for g in record_set) and all(s.status != "failed" for s in steps)
    for path, value in files.items():
        writer.write(path, value)
    writer.write("headshots.json", headshots)
    manifest = _manifest(run_id, finished, assembled, "passed" if passed else "failed")
    report: Json = {
        "runId": run_id,
        "status": manifest["status"],
        "startedAt": js_iso(started),
        "finishedAt": js_iso(finished),
        "steps": [s.json() for s in steps],
        "gates": [g.json() for g in record_set],
        "heldOut": [
            {"season": s.season, "rankCorrelation": s.rank_correlation, "sampleSize": s.sample_size} for s in held_out
        ],
        "capsuleSpend": None if spend is None else asdict(spend),
        "headshots": headshot_line,
        "formatsNotCarried": list(assembled.dropped),
        "artifacts": writer.records,
    }
    writer.write("report.json", report)
    writer.write("manifest.json", manifest)
    if record_set[0].passed:
        baseline = {"runId": run_id, "heldOut": report["heldOut"]}
        deps.store.put(HELD_OUT_BASELINE_KEY, encode(baseline), "application/json")
    line = (
        f"run {run_id} {manifest['status'].upper()}: {len(assembled.formats)} boards, {len(assembled.people)} players, "
        f"{sum(1 for p in players if p['capsule'] is not None)} capsules, {len(writer.records)} files"
    )
    if passed:
        public_at = promote_early(deps.store, run_id, finished)
        line += f"; early access now, public at {js_iso(public_at)}"
    else:
        failed = [g.gate for g in record_set if not g.passed] + [s.name for s in steps if s.status == "failed"]
        line += f"; failed: {', '.join(failed)}"
    deps.log(line)
    return RunOutcome(run_id, passed, line)
