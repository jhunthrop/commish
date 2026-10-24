"""THE ROUND'S COMMAND LINE: the development check and the one judgment of `commish_weekly_v5`.

    uv run python -m research.model.weekly5 check --database <lane70_ URL> --features <store dir>
    uv run python -m research.model.weekly5 judgment --database <lane70_ URL> --features <store dir>

Both run only on the coordinator's scratch copy on 5433 named `lane70_...` (6.3), in one read-only
transaction whose every statement binding a closed season is refused (2024 on for the check, 2025 on for
the judgment), on a clean tree whose HEAD descends from the lock (`decisions.LOCK`) and round 4's amendment
commits. Each is taken once: after its preconditions (R4 6.3's counts, the store's digests, round 3's 26
lines and round 4's components reproduced) it claims its own exclusive file before any row of its judged
season is read for this round's model, so a second run is refused even if the first died part way. The
records are written at the constants' paths only.

The check computes both candidates (2.8), every one of the 34 lines for each, makes the choice and applies
the stop rule to the chosen one. The judgment refuses unless the check's record exists, its stop rule did not
end the round and its choice is written; it computes only the chosen candidate.
"""

import json
import subprocess
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass, field, fields
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final, Literal, Protocol

import pandas as pd
from sqlalchemy import Connection, text

from research.cli import log_line
from research.db.engine import make_engine
from research.db.url import sqlalchemy_url
from research.errors import ConfigurationError
from research.model.arithmetic import model_version
from research.model.register.freeze import IMPLEMENTATION
from research.model.ros.outcomes import PRISTINE_SEASON
from research.model.ros.scratch import check_scratch_url
from research.model.weekly2.gates import GateLine
from research.model.weekly2.guard import guard_queries
from research.model.weekly2.judge import DOCS
from research.model.weekly4.files import build_report, load_store
from research.model.weekly4.system import Store
from research.model.weekly5 import decisions, gates
from research.model.weekly5.benchmarks import benchmark_values
from research.model.weekly5.board import CANDIDATES
from research.model.weekly5.gates import DEVELOPMENT_CHECK, GATE_LINES, ROUND_FIVE, RoundFive
from research.model.weekly5.judgment import Assessed, assess, choose, form_mismatches
from research.model.weekly5.preconditions import (
    DEPTH_RULE,
    component_mismatches,
    digest_mismatches,
    first_team_cells,
    share_mismatches,
)
from research.model.weekly5.reads import FitReads, JudgedReads, sources_of
from research.model.weekly5.reporting import fitted_payload, reported
from research.model.weekly5.system import Grids, Sources, fit_components, fit_rest, fit_shares, judged_board

Command = Literal["check", "judgment"]
_ROOT: Final = Path(__file__).resolve().parents[3]
PREREGISTRATION: Final = "docs/research/2026-10-26-weekly-projection-round5-preregistration.md"
# N9: round 4's amendment commits, Amendment 3's `b3796049` included (the commits that changed round 4's
# preregistration after its lock `b56c05d8`).
ROUND_FOUR_AMENDMENTS: Final = (
    "b56c05d8",
    "65cc5b96",
    "6364b50f",
    "f358f375",
    "42d0f440",
    "b3796049",
    "bd7b7356",
    "ed6e6029",
    "db3534f6",
    "e5cec482",
    "91fa5cd3",
    "95adfeb3",
)
CHECK_RECORD: Final = DOCS / "2026-10-26-weekly-projection-round5-dev-check.json"
CHECK_CLAIM: Final = DOCS / "2026-10-26-weekly-projection-round5-dev-check-taken.json"
JUDGMENT_RECORD: Final = DOCS / "2026-10-26-weekly-projection-round5-results.json"
JUDGMENT_CLAIM: Final = DOCS / "2026-10-26-weekly-projection-round5-judgment-taken.json"
SCRATCH_PREFIXES: Final = ("lane70_",)  # 6.3: "The round's scratch guard admits only a `lane70_` database on 5433"
ARTIFACT_PREFIX: Final = "weekly5/"  # this round's own `model_artifacts` keys (G5)
ISOLATED: Final = (
    "preseason_projections",
    "preseason_board_reasons",
    "published_boards",
    "register_freeze_rows",
    "register_grade_rows",
)
PROVISIONAL: Final = (
    "2024 is read as provisional (preregistration section 5): this judgment is not a selection, its thresholds "
    "are fixed, it runs once and no variant is chosen on 2024, but it is one more confirmatory read of a season "
    "several reads have eroded; the test that cannot be eroded is the 2026 register's two fixed looks (3.3)."
)
EXPOSURE: Final = (
    "2024's exposure (section 5): R4 section 5's items 6, 1, 2, 3, 4, 5, 7 and 8 carried (item 8: round 3's number "
    "is computed on 2024 here as G7's benchmark, and none of its numbers carries a verdict for round 3); (9) round "
    "4's development check read no 2024 to 2026 outcome and round 4 never ran its judgment; (10) the kicker and "
    "team-defense sub-round's 2024 judgment was refused by its stop rule and never ran, and this round reads none "
    "of its kick columns or archives; (11) the design draft, round 4's results and its credibility review hold no "
    "2024 number; (12) no 2026 grade of Amendments 4 to 6 enters any fit, tuning step, gate or choice."
)


class RefusedError(ConfigurationError):
    """The run may not start, or may not go on."""


class Environment(Protocol):
    """The database-bound steps of a run (the real ones in `environment.py`; the tests' on synthetic
    seasons)."""

    def preconditions(self, conn: Connection, t: RoundFive) -> tuple[list[str], dict[str, Any]]: ...

    def round_three(self, conn: Connection, t: RoundFive) -> object: ...

    def judged(self, conn: Connection, t: RoundFive, reproduced: object) -> tuple[JudgedReads, object]: ...

    def fit_reads(self, conn: Connection, t: RoundFive, fit: object) -> FitReads: ...

    def digests(self, conn: Connection) -> dict[str, str]: ...

    def round_four_record(self) -> Mapping[str, Any]: ...


def table_digests(conn: Connection) -> dict[str, str]:
    """G5's tables, each digested whole, `model_artifacts` outside this round's keys."""
    found: dict[str, str] = {}
    queries = {name: f"select * from research.{name}" for name in ISOLATED}
    queries["model_artifacts"] = f"select * from research.model_artifacts where name not like '{ARTIFACT_PREFIX}%'"
    for name, query in queries.items():
        row = conn.execute(
            text(
                f"select count(*) as n, md5(coalesce(string_agg(md5(t::text), '' order by md5(t::text)), '')) as d from ({query}) t"
            )
        ).one()
        found[name] = f"{row.n}:{row.d}"
    return found


def commits_absent(commits: Sequence[str]) -> list[str]:
    absent = []
    for commit in commits:
        found = subprocess.run(
            ["git", "merge-base", "--is-ancestor", commit, "HEAD"], cwd=_ROOT, capture_output=True, check=False
        )
        if found.returncode != 0:
            absent.append(commit)
    return absent


def tree_status() -> list[str]:
    found = subprocess.run(["git", "status", "--porcelain"], cwd=_ROOT, capture_output=True, text=True, check=True)
    return found.stdout.splitlines()


def head_commit() -> str:
    return subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=_ROOT, capture_output=True, text=True, check=True
    ).stdout.strip()


@dataclass(frozen=True, slots=True)
class Setup:
    """Everything a run is bound to; the command line binds the preregistered ones."""

    command: Command
    t: RoundFive
    environment: Environment
    claim: Path
    record: Path  # this run's own record, written once
    check_record: Path = CHECK_RECORD  # the check's record, which the judgment reads
    lock: str | None = decisions.LOCK
    prefixes: tuple[str, ...] = SCRATCH_PREFIXES
    grids: Grids = field(default_factory=Grids)
    absent: Callable[[Sequence[str]], list[str]] = commits_absent
    status: Callable[[], list[str]] = tree_status
    head: Callable[[], str] = head_commit
    version: Callable[[], str] = model_version


def chosen_candidate(record: Mapping[str, Any] | None) -> str:
    """The candidate the check chose, or the refusal: no record, not a check's, the stop rule met, no choice."""
    if record is None:
        raise RefusedError("no development check record: the judgment runs only after the check")
    if record.get("command") != "check":
        raise RefusedError("the development check record is not a check's record")
    choice = record.get("choice") or {}
    chosen = choice.get("chosen")
    if chosen not in CANDIDATES:
        raise RefusedError("the development check record writes no candidate choice")
    lines = [GateLine(**line) for line in record.get("gates", [])]
    failed = gates.stopping(lines)
    if failed or record.get("stopped") is not False:
        raise RefusedError(
            f"the stop rule (3.2): the chosen candidate failed {' and '.join(failed) or 'the check'} on the check; "
            "the round ended and the judgment is not run"
        )
    return str(chosen)


def refusals(setup: Setup) -> tuple[str, ...]:
    """The candidates the run computes, or the refusal: no lock, a dirty tree, the lock or round 4's
    amendments absent, once taken, and for the judgment the check's record and its stop rule."""
    if setup.lock is None:
        raise RefusedError("no lock is recorded (decisions.LOCK); no run of this round before the lock")
    dirty = setup.status()
    if dirty:
        raise RefusedError(f"the tree is not clean ({len(dirty)} paths); the run is taken on a committed tree only")
    missing = setup.absent((setup.lock, *ROUND_FOUR_AMENDMENTS))
    if missing:
        raise RefusedError(f"the commits {missing} are not in this tree's history")
    for done in (setup.claim, setup.record):
        if done.exists():
            raise RefusedError(f"the {setup.command} was taken once ({done.name}); it is never rerun")
    if setup.command == "check":
        return CANDIDATES
    record = json.loads(setup.check_record.read_text()) if setup.check_record.exists() else None
    return (chosen_candidate(record),)


def claim(path: Path, command: str, version: str) -> None:
    """Created exclusively before any judged row is read for this round's model: a second claim is refused."""
    try:
        with path.open("x") as file:
            json.dump({"command": command, "claimed_at": datetime.now(UTC).isoformat(), "model_version": version}, file)
    except FileExistsError as error:
        raise RefusedError(f"the {command} was taken once ({path.name}); it is never rerun") from error


def _merge(a: Store, b: Store) -> Store:
    return Store(
        pd.concat([a.players, b.players], ignore_index=True),
        pd.concat([a.teams, b.teams], ignore_index=True),
        pd.concat([a.plays, b.plays], ignore_index=True),
        {**a.digests, **b.digests},
    )


def _store_rule(report: Mapping[str, Any]) -> None:
    rules = {s.get("depth_chart_rule") for s in report["seasons"]}
    if rules != {DEPTH_RULE}:
        raise RefusedError(
            f"the store's build carries depth chart rules {sorted(map(str, rules))}, not `--depth-chart week`"
        )


def store_clause(report: Mapping[str, Any], last_season: int) -> tuple[bool, str]:
    """The store's per-game clause over the seasons this run reads (its build's report): no broken read and
    every clause held. A reading: the build of a later season (2024's files beside the check's) read that
    season's outcomes for its own team rows; this run opens no file of it, so it is recorded, not failed."""
    seasons = [s for s in report["seasons"] if int(s["season"]) <= last_season]
    broken = sum(int(s["stamps"]["broken"]) for s in seasons)
    held = all(
        s["clause"]["team"]["holds"] and (s["clause"]["player"] is None or s["clause"]["player"]["holds"])
        for s in seasons
    )
    later = sorted(int(x) for x in report.get("outcome_seasons_read", []) if int(x) > last_season)
    detail = (
        f"the store: {broken} broken reads over {len(seasons)} seasons read, clauses {'held' if held else 'broken'}"
        + (f"; its build also read the outcomes of {later} for files this run does not open" if later else "")
    )
    return broken == 0 and held and bool(seasons), detail


def thresholds_payload(t: RoundFive) -> dict[str, Any]:
    found: dict[str, Any] = {}
    for f in fields(t):
        value = getattr(t, f.name)
        if f.name == "round_three":
            value = {
                "model_name": value.model_name,
                "fit_seasons": list(value.fit_seasons),
                "judgment_season": value.judgment_season,
            }
        elif hasattr(value, "items"):
            value = dict(value)
        found[f.name] = value
    return found


def decision(command: str, lines: Sequence[GateLine]) -> str:
    """The decision rule (3.2) for the judgment; the stop rule for the check."""
    if command == "judgment":
        if gates.verdict(lines) and len(lines) == GATE_LINES:
            return f"DECISION: all {GATE_LINES} lines pass; the weekly number ships (provisional, section 5)"
        return "DECISION: a line failed or cannot answer; nothing ships"
    failed = gates.stopping(lines)
    if failed:
        return f"STOP RULE: the chosen candidate fails {' and '.join(failed)} on the check; the round ends, no judgment"
    return f"DEVELOPMENT CHECK: {sum(g.passed for g in lines)} of {len(lines)} lines pass; G2 and G6 pooled pass, the judgment may run"


@dataclass(slots=True)
class Prepared:
    """What the run read and fitted before its claim."""

    report: Mapping[str, Any]
    store: Store
    preconditions: dict[str, Any]
    before: dict[str, str]
    components: Any
    reproduced: object
    fit: FitReads | None = None
    shares: Any = None


def _prepare(conn: Connection, setup: Setup, features: Path) -> Prepared:
    t, env = setup.t, setup.environment
    report = build_report(features)
    _store_rule(report)
    pre = [s for s in t.player_fit_seasons if s < t.judgment_season]
    store = load_store(features, range(t.team_fit_seasons[0], t.judgment_season), pre)  # 2016 on
    r4 = env.round_four_record()
    moved = digest_mismatches(store.digests, r4)
    if moved:
        raise RefusedError("the feature files differ from round 4's development check: " + "; ".join(moved[:3]))
    missing, counts = env.preconditions(conn, t)
    if missing:
        raise RefusedError("the round's preconditions are not met: " + "; ".join(missing))
    before = env.digests(conn)
    reproduced = env.round_three(conn, t)
    components = fit_components(store, t, setup.grids)
    unequal = component_mismatches(components, r4)
    if unequal:
        raise RefusedError("round 4's play and team models are not reproduced: " + "; ".join(unequal[:3]))
    prepared = Prepared(report, store, counts, before, components, reproduced)
    if setup.command == "check":
        prepared.fit = env.fit_reads(conn, t, reproduced)
        prepared.shares = fit_shares(store, _fit_sources(prepared.fit), t, setup.grids)
        unequal = share_mismatches(prepared.shares, r4)
        if unequal:
            raise RefusedError("round 4's share models are not reproduced: " + "; ".join(unequal[:3]))
    return prepared


def _fit_sources(fit: FitReads) -> Sources:
    return Sources(fit.rates, fit.lines, fit.forms, fit.fumbles)


def _isolation(
    setup: Setup, prepared: Prepared, judged: JudgedReads, fitted: Any, after: Mapping[str, str]
) -> tuple[GateLine, dict[str, tuple[int, ...]]]:
    t = setup.t
    fit = prepared.fit
    if fit is None:
        raise RefusedError("the fit seasons were not read")
    r3 = next((line for line in judged.lines if line.gate == "G5"), None)
    store_held = store_clause(prepared.report, t.judgment_season)
    held = (r3 is not None and r3.passed) and fit.clause[0] and store_held[0]
    r3_detail = "none" if r3 is None else r3.detail.split("per-game clause: ")[-1]
    detail = f"round 3's reads: {r3_detail}; the fit weeks' reads: {fit.clause[1]}; {store_held[1]}"
    served = {
        gates.PLAYS_AND_TEAMS: tuple(fitted.served["plays and teams"]),
        gates.PLAYERS: tuple(sorted({*fitted.served["players"], *fit.served, *judged.fit_served})),
        gates.JUDGED: tuple(sorted({*judged.served, t.judgment_season})),
    }
    return gates.isolation_line(served, prepared.before, after, (held, detail), t), served


def _assessed(fitted: Any, judged: JudgedReads, t: RoundFive, candidate: str) -> tuple[Assessed, pd.DataFrame]:
    scored = judged_board(fitted, t, candidate)
    data = fitted.data[t.judgment_season]
    positions = {
        str(k): str(v) for k, v in data.rows.drop_duplicates("player_id").set_index("player_id")["position"].items()
    }
    judged_lines = judged.season_lines[judged.season_lines["season"] == t.judgment_season]
    values, _ = benchmark_values(judged.rows, scored, judged_lines, data.teams, positions)
    return assess(scored, fitted.bands[candidate], judged.rows, values, t), scored


def execute(setup: Setup, url: str, features: Path) -> int:
    started = time.monotonic()
    candidates = refusals(setup)
    check_scratch_url(url, setup.prefixes)
    t, env = setup.t, setup.environment
    version = setup.version()
    engine = make_engine(sqlalchemy_url(url))
    try:
        with engine.connect() as conn:
            conn.execute(text("set transaction read only"))
            guard_queries(conn, frozenset(range(t.judgment_season + 1, PRISTINE_SEASON + 1)))
            prepared = _prepare(conn, setup, features)
            claim(setup.claim, setup.command, version)
            judged, fit_handle = env.judged(conn, t, prepared.reproduced)
            if prepared.fit is None:
                prepared.fit = env.fit_reads(conn, t, fit_handle)
                prepared.shares = fit_shares(prepared.store, _fit_sources(prepared.fit), t, setup.grids)
            store = _merge(prepared.store, load_store(features, (t.judgment_season,), (t.judgment_season,)))
            sources = sources_of(prepared.fit, judged)
            fitted = fit_rest(store, sources, t, prepared.components, prepared.shares, candidates, setup.grids)
            after = env.digests(conn)
    finally:
        engine.dispose()
    isolation, served = _isolation(setup, prepared, judged, fitted, after)
    found = {c: _assessed(fitted, judged, t, c) for c in candidates}
    lines_of = {c: [*a.lines, isolation] for c, (a, _) in found.items()}
    choice = choose({c: a for c, (a, _) in found.items()}) if setup.command == "check" else None
    chosen = choice.chosen if choice is not None else candidates[0]
    lines = lines_of[chosen]
    stopped = setup.command == "check" and bool(gates.stopping(lines))
    assessed, scored = found[chosen]
    rendered = [
        *([PROVISIONAL, EXPOSURE] if setup.command == "judgment" else []),
        f"fit seconds: {', '.join(f'{k} {v:.0f}' for k, v in fitted.seconds.items())}",
        *(
            f"{c}: {'PASS' if g.passed else 'FAIL'}  {g.gate} {g.subject:<40} {g.detail}"
            for c in candidates
            for g in lines_of[c]
        ),
        *([choice.rule] if choice is not None else []),
        decision(setup.command, lines),
    ]
    for line in rendered:
        log_line(line)
    record: dict[str, Any] = {
        "model": t.model_name,
        "command": setup.command,
        "implementation": IMPLEMENTATION,
        "model_version": version,
        "preregistration": {
            "path": PREREGISTRATION,
            "lock": setup.lock,
            "round_four_amendments": list(ROUND_FOUR_AMENDMENTS),
        },
        "head": setup.head(),
        "decisions": {"spreadsheets": t.spreadsheets, "form_margin": t.form_margin},
        "provisional": PROVISIONAL if setup.command == "judgment" else None,
        "exposure": EXPOSURE if setup.command == "judgment" else None,
        "thresholds": thresholds_payload(t),
        "features": {"directory": str(features), "digests": dict(store.digests), "depth_chart_rule": DEPTH_RULE},
        "preconditions": {
            "counts": prepared.preconditions,
            "round_four_reproduced": True,
            "round_three_reproduced": True,
            "first_team_model_cells": first_team_cells(prepared.components, t),
            "guard_five_rows_whose_rival_form_differs_from_g2": form_mismatches(
                judged.rows, sources.forms, t.judgment_season
            ),
        },
        "round_three": {"lines": [asdict(line) for line in judged.lines]},
        "fitted": fitted_payload(fitted),
        "outcome_seasons_read": {name: list(v) for name, v in served.items()},
        "candidates": {
            c: {
                "gates": [asdict(g) for g in lines_of[c]],
                "passed": gates.verdict(lines_of[c]),
                "numbers": dict(found[c][0].numbers),
            }
            for c in candidates
        },
        "choice": None
        if choice is None
        else {"chosen": choice.chosen, "values": dict(choice.values), "rule": choice.rule},
        "chosen": chosen,
        "gates": [asdict(g) for g in lines],
        "passed": gates.verdict(lines),
        "stopped": stopped if setup.command == "check" else None,
        "decision": decision(setup.command, lines),
        "reported": reported(fitted, t, chosen, scored, assessed.rows, judged.rows, judged=setup.command == "judgment"),
        "digests": {"before": prepared.before, "after": after},
        "seconds": {**fitted.seconds, "total": time.monotonic() - started},
        "report": rendered,
    }
    setup.record.write_text(json.dumps(record, indent=1, default=str))
    return 0 if setup.command == "check" or gates.verdict(lines) else 1


def setup_for(command: Command, environment: Environment) -> Setup:
    if command == "check":
        return Setup(command, DEVELOPMENT_CHECK, environment, CHECK_CLAIM, CHECK_RECORD)
    return Setup(command, ROUND_FIVE, environment, JUDGMENT_CLAIM, JUDGMENT_RECORD)
