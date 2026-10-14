"""THE MODEL CASES: each numeric entry point, the oracle and the port on the same stored inputs.

Every comparison is exact (tolerance 0, every bit). The board cases live in `board_cases`, the
register's in `register_cases`; this module holds the numerics, the backtest and the fits, and
the registry the harness runs.
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta
from types import MappingProxyType
from typing import Final

from research.db.engine import make_engine
from research.db.url import sqlalchemy_url
from research.model.arithmetic import ARM64_BOARDS
from research.model.artifacts import read_artifact
from research.model.backtest import held_out_scores
from research.model.fit_check import fit_step
from research.model.fits.game_variance import fit_skill_game_variance
from research.model.priors import load_model_artifacts
from research.parity.model.board_cases import WEEK_TWO_BOARD, board_week_one, board_week_two
from research.parity.model.compare import Diff, diff_rows
from research.parity.model.numerics import VectorCheck, run_committed, run_live
from research.parity.model.outcome import CaseResult, Claim
from research.parity.model.register_cases import (
    AFTER_KICKOFF,
    register_freeze_unknown_model,
    register_freeze_week_two,
    register_grade_held_out,
    register_grade_live,
)
from research.parity.model.sides import run_oracle
from research.parity.model.store import oracle_fits, scratch_pair_at, source_url
from research.parity.model.weekly_cases import weekly_fit, weekly_layers_2024, weekly_projection_2025
from research.parity.model.weekly_read_cases import weekly_fit_reads

_LIVE_COUNT: Final = 100_000
_LIVE_SEED: Final = 20261012


@dataclass(frozen=True, slots=True)
class ModelCase:
    name: str
    summary: str
    needs_store: bool
    run: Callable[[], CaseResult]


def _arm(fused: bool | None) -> str:
    return "no single arm" if fused is None else ("fused" if fused else "unfused")


def _vector_diffs(check: VectorCheck) -> list[Diff]:
    return [
        Diff(
            f"{check.source[2:]} {kind}", count, count, (), (), check.differing[kind], 0.0, check.examples.get(kind, ())
        )
        for kind, count in sorted(check.checked.items())
    ]


def _numerics() -> CaseResult:
    live = run_live(_LIVE_COUNT, _LIVE_SEED)
    committed = run_committed()
    checks = [live, *committed]
    claims = [
        Claim(
            f"the running node ({live.source[2:]}) matches exactly one arm: {_arm(live.fused)}", live.fused is not None
        ),
        *(
            Claim(
                f"{check.source[2:]}: the {_arm(check.fused)} arm matches, the other differs on {check.other_arm_differs} lines",
                check.other_arm_differs > 0 and not check.differing,
            )
            for check in committed
        ),
    ]
    notes = [
        f"{check.source[2:]}: {count} pow lines not judged (its `**` is not this host's libm)"
        for check in checks
        if (count := check.skipped["pow"])
    ]
    return CaseResult("numerics", [diff for check in checks for diff in _vector_diffs(check)], notes, True, claims)


def _held_out() -> CaseResult:
    oracle = run_oracle(source_url(), "held-out")
    engine = make_engine(sqlalchemy_url(source_url()))
    with engine.connect() as conn:
        seasons = [int(season) for season in read_artifact(conn, "model/weekly-priors").payload["heldOutSeasons"]]
        port = held_out_scores(conn, seasons)
    engine.dispose()
    theirs = {
        str(row["season"]): {"rho": row["rankCorrelation"], "n": row["sampleSize"]}
        for row in (oracle.lines[0] if oracle.lines else [])
    }
    mine = {str(score.season): {"rho": score.rank_correlation, "n": score.sample_size} for score in port}
    notes = [
        f"{score.season} rho {score.rank_correlation:.4f} n={score.sample_size}"
        for score in port
        if score.rank_correlation is not None
    ]
    return CaseResult("held-out-backtest", [diff_rows("held-out rho and n", theirs, mine)], notes, oracle.error is None)


def _fit_check() -> CaseResult:
    pair = scratch_pair_at(WEEK_TWO_BOARD, "fit", oracle_fits())
    engine = pair.research_engine()
    with engine.connect() as conn:
        artifacts = load_model_artifacts(conn)
        before = fit_step(conn, WEEK_TWO_BOARD + timedelta(hours=1), artifacts, ARM64_BOARDS)
        after = fit_step(conn, AFTER_KICKOFF, artifacts, ARM64_BOARDS)
    engine.dispose()
    notes = [f"before kickoff: {before.status}, {before.summary}", f"after kickoff: {after.status}, {after.summary}"]
    claims = [
        Claim("before kickoff the live board is rebuilt and matches", before.status == "ran"),
        Claim("after kickoff no archived board is rebuildable from the store", after.status == "skipped"),
    ]
    return CaseResult("fit-check", [], notes, True, claims)


def _fit_game_variance() -> CaseResult:
    oracle = run_oracle(source_url(), "fit-game-variance")
    engine = make_engine(sqlalchemy_url(source_url()))
    with engine.connect() as conn:
        port = fit_skill_game_variance(conn)
        published = read_artifact(conn, "preseason/game-variance-skill").payload
    engine.dispose()
    theirs = oracle.lines[0] if oracle.lines else {}
    against_published = diff_rows("port's refit against the published v1", published, port)
    notes = [
        f"published v1 against today's refit: {against_published.differing} cell(s) differ (worst {against_published.worst:.4f}); "
        "the 2023-2024 inputs moved after the fit was published on 2026-09-05, and the store kept no write stamp old enough to rebuild them"
    ]
    return CaseResult(
        "fit-game-variance",
        [diff_rows("game variance refit, oracle against port", theirs, port)],
        notes,
        oracle.error is None,
    )


MODEL_CASES: Final = (
    ModelCase(
        "numerics",
        "V8's log, exp, sin, pow, round, max/min, ordinal sort and mulberry32: the live node and arm64/x64 vectors",
        False,
        _numerics,
    ),
    ModelCase(
        "board-2026-week2",
        "the week-2 board: the tree that made it, today's oracle, and the port, against the store",
        True,
        board_week_two,
    ),
    ModelCase(
        "board-2026-week1",
        "the week-1 board: the tree that made it against the register, the cause of the residual, oracle vs port",
        True,
        board_week_one,
    ),
    ModelCase(
        "register-freeze-week2",
        "the week-2 freeze retaken at its instant, against the stored freeze and the oracle",
        True,
        register_freeze_week_two,
    ),
    ModelCase(
        "register-grade", "grading 2026 weeks 1 and 2 on today's store, refusals whole", True, register_grade_live
    ),
    ModelCase(
        "register-grade-2024-week2",
        "a scratch freeze and grade of 2024 week 2, every field, both sides",
        True,
        register_grade_held_out,
    ),
    ModelCase(
        "register-freeze-unknown-model",
        "the freeze refuses a board that names no model, and writes nothing",
        True,
        register_freeze_unknown_model,
    ),
    ModelCase("held-out-backtest", "the stored served board against outcomes in the held-out seasons", True, _held_out),
    ModelCase("fit-check", "the fit step's check: the live board before kickoff, the archive after", True, _fit_check),
    ModelCase(
        "fit-game-variance",
        "the per-game variance fit on 2023-2024, oracle against port, and the published v1",
        True,
        _fit_game_variance,
    ),
    ModelCase(
        "weekly-projection-2025",
        "the weekly model in four weeks of 2025: the oracle's replay against the port's reads and layers",
        True,
        weekly_projection_2025,
    ),
    ModelCase(
        "weekly-layers-2024",
        "the weekly model in four weeks of 2024, the port's reads handed to the oracle's layers",
        True,
        weekly_layers_2024,
    ),
    ModelCase("weekly-fit", "the four shipped weekly fits on 2021-2022, oracle against port", True, weekly_fit),
    ModelCase(
        "weekly-fit-reads",
        "the weekly fit's reads (usage, lines, club edges, team facts) on 2024-2025, oracle against port",
        True,
        weekly_fit_reads,
    ),
)
MODEL_CASES_BY_NAME: Final = MappingProxyType({case.name: case for case in MODEL_CASES})
