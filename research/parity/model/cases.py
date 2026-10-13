"""THE MODEL CASES: each numeric entry point, the oracle and the port on the same stored inputs.

Every comparison is exact (tolerance 0, every bit) except where a case states a tolerance and the
cause beside it. The register comparisons compare the port with what the register actually holds.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Final

import psycopg

from research.db.engine import make_engine
from research.db.url import sqlalchemy_url
from research.model.artifacts import read_artifact
from research.model.backtest import held_out_scores
from research.model.fit_check import fit_step
from research.model.fits.game_variance import fit_skill_game_variance
from research.model.instants import js_iso
from research.model.priors import load_model_artifacts
from research.model.register.freeze import take_freeze
from research.model.register.grade import grade_week
from research.parity.model.compare import Diff, diff_rows, leg_diffs
from research.parity.model.numerics import run_numerics
from research.parity.model.sides import run_oracle, run_port_boards
from research.parity.model.store import ScratchPair, oracle_fits, scratch_pair_at, source_url

REGISTER_TOLERANCE: Final = 0.05
WEEK_ONE_BOARD: Final = datetime(2026, 9, 7, 21, 57, 33, 121000, tzinfo=UTC)
WEEK_TWO_BOARD: Final = datetime(2026, 9, 9, 2, 20, 29, 697000, tzinfo=UTC)
WEEK_TWO_FREEZE: Final = datetime(2026, 9, 10, 18, 0, 17, 177000, tzinfo=UTC)
AFTER_KICKOFF: Final = datetime(2026, 10, 12, 12, 0, tzinfo=UTC)
_ONE_MS: Final = timedelta(milliseconds=1)
_SERVED: Final = "commish_board_v9_ppr_12"


@dataclass(frozen=True, slots=True)
class CaseResult:
    name: str
    diffs: list[Diff]
    notes: list[str] = field(default_factory=list)
    refusals_agree: bool = True

    @property
    def matches(self) -> bool:
        return self.refusals_agree and all(diff.matches for diff in self.diffs)


@dataclass(frozen=True, slots=True)
class ModelCase:
    name: str
    summary: str
    needs_store: bool
    run: Callable[[], CaseResult]


def _numerics() -> CaseResult:
    result = run_numerics(100_000, 20261012)
    diffs = [
        Diff(f"numerics {kind}", count, count, (), (), result.differing[kind], 0.0, result.examples)
        for kind, count in sorted(result.checked.items())
    ]
    return CaseResult(
        "numerics", diffs, [f"fused multiply-add policy: {'arm64 contracted' if result.fused else 'unfused'}"]
    )


def _source_rows(sql: str, params: tuple[Any, ...]) -> list[dict[str, Any]]:
    with psycopg.connect(source_url()) as conn:
        conn.read_only = True
        cursor = conn.execute(sql, params)
        names = [column.name for column in cursor.description or ()]
        return [dict(zip(names, row, strict=True)) for row in cursor]


def _stored_generation(source: str, as_of: datetime) -> dict[str, Mapping[str, Any]]:
    rows = _source_rows(
        "select player_id, projected_points, floor_points, median_points, ceiling_points, expected_games, rank, value_rank "
        "from public.preseason_projections where season = 2026 and source = %s and as_of = %s",
        (source, as_of),
    )
    return {
        row["player_id"]: {
            "projectedPoints": row["projected_points"],
            "floorPoints": row["floor_points"],
            "medianPoints": row["median_points"],
            "ceilingPoints": row["ceiling_points"],
            "expectedGames": row["expected_games"],
            "rank": row["rank"],
            "valueRank": row["value_rank"],
        }
        for row in rows
    }


def _frozen(week: int) -> dict[str, Mapping[str, Any]]:
    rows = _source_rows(
        "select player_id, board_points, board_rank, board_value_rank from public.register_freeze_rows "
        "where season = 2026 and week = %s and board_source = %s",
        (week, _SERVED),
    )
    return {
        row["player_id"]: {
            "projectedPoints": row["board_points"],
            "rank": row["board_rank"],
            "valueRank": row["board_value_rank"],
        }
        for row in rows
    }


def _projected(line: Mapping[str, Any], columns: tuple[str, ...]) -> dict[str, Mapping[str, Any]]:
    return {row["playerId"]: {column: row[column] for column in columns} for row in line["rows"]}


def _boards(pair: ScratchPair, now: datetime) -> tuple[Any, Any]:
    oracle = run_oracle(pair.legacy_url, "board", "2026", js_iso(now))
    engine = pair.research_engine()
    with engine.connect() as conn:
        port = run_port_boards(conn, 2026, now, load_model_artifacts(conn))
    engine.dispose()
    return oracle, port


def _refusal_note(oracle_error: str | None, port_error: str | None) -> tuple[bool, list[str]]:
    agree = (oracle_error is None) == (port_error is None)
    notes = [f"oracle refused: {oracle_error}"] if oracle_error else []
    notes += [f"port refused: {port_error}"] if port_error else []
    return agree, notes


def _board_week_two() -> CaseResult:
    pair = scratch_pair_at(WEEK_TWO_BOARD, "board2", oracle_fits())
    oracle, port = _boards(pair, WEEK_TWO_BOARD)
    agree, notes = _refusal_note(oracle.error, port.error)
    diffs = leg_diffs(oracle.lines, port.lines, "2026 at 09-09T02:20:29.697Z")
    sources = {
        "ppr": _SERVED,
        "half": "commish_board_v9_half_12",
        "std": "commish_board_v9_std_12",
        "raw": "commish_board_v1_ppr_12",
    }
    columns = ("projectedPoints", "floorPoints", "medianPoints", "ceilingPoints", "expectedGames", "rank", "valueRank")
    for line in port.lines:
        stored = _stored_generation(sources[line["leg"]], WEEK_TWO_BOARD)
        diffs.append(diff_rows(f"port {line['leg']} against the stored generation", stored, _projected(line, columns)))
    served = next(line for line in port.lines if line["leg"] == "ppr")
    diffs.append(
        diff_rows(
            "port ppr against register 2026 week 2 (0.05 points)",
            _frozen(2),
            _projected(served, ("projectedPoints", "rank", "valueRank")),
            REGISTER_TOLERANCE,
        )
    )
    return CaseResult("board-2026-week2", diffs, notes, agree)


def _board_week_one() -> CaseResult:
    pair = scratch_pair_at(WEEK_ONE_BOARD, "board1", oracle_fits())
    oracle, port = _boards(pair, WEEK_ONE_BOARD)
    agree, notes = _refusal_note(oracle.error, port.error)
    diffs = leg_diffs(oracle.lines, port.lines, "2026 at 09-07T21:57:33.121Z")
    served = next((line for line in port.lines if line["leg"] == "ppr"), None)
    if served is not None:
        frozen_points = {
            player_id: {"projectedPoints": row["projectedPoints"]} for player_id, row in _frozen(1).items()
        }
        week_one = diff_rows(
            "port ppr against register 2026 week 1 (0.05 points)",
            frozen_points,
            _projected(served, ("projectedPoints",)),
            REGISTER_TOLERANCE,
        )
        notes.append(
            f"register week 1: {week_one.differing} of {week_one.left_rows} frozen board points differ past 0.05 (worst {week_one.worst:.2f}); "
            "cause: the week-1 board was taken by the 2026-09-07 model, before the 2026-09-08 availability re-fit, roster-status "
            "gate, per-format boards and designation cells; the oracle today, and the port, are the 2026-09-09 model"
        )
    return CaseResult("board-2026-week1", diffs, notes, agree)


def _register_freeze() -> CaseResult:
    pair = scratch_pair_at(WEEK_TWO_FREEZE - _ONE_MS, "freeze", oracle_fits())
    oracle = run_oracle(pair.legacy_url, "freeze", "2026", "2", js_iso(WEEK_TWO_FREEZE))
    engine = pair.research_engine()
    with engine.begin() as conn:
        port_rows = take_freeze(conn, 2026, 2, WEEK_TWO_FREEZE).rows
    engine.dispose()
    port = {f"{row['board_source']}|{row['player_id']}": _freeze_columns(row, "adp", "ecr") for row in port_rows}
    stored_rows = _source_rows(
        "select * from public.register_freeze_rows where season = 2026 and week = 2 and frozen_at = %s",
        (WEEK_TWO_FREEZE,),
    )
    stored = {
        f"{row['board_source']}|{row['player_id']}": _freeze_columns(row, "adp_rank", "ecr_rank") for row in stored_rows
    }
    oracle_rows = {
        f"{row['boardSource']}|{row['playerId']}": _oracle_freeze(row) for line in oracle.lines for row in line["rows"]
    }
    notes = ["implementation excluded: the port stamps python, the stored rows typescript"]
    if oracle.error:
        notes.append(f"oracle refused: {oracle.error}")
    return CaseResult(
        "register-freeze-week2",
        [
            diff_rows("port against the stored week-2 freeze", stored, port),
            diff_rows("port against the oracle's freeze", oracle_rows, port),
        ],
        notes,
        oracle.error is None,
    )


def _freeze_columns(row: Mapping[str, Any], adp: str, ecr: str) -> dict[str, Any]:
    return {
        "boardAsOf": js_iso(row["board_as_of"]),
        "boardPoints": row["board_points"],
        "boardRank": row["board_rank"],
        "boardValueRank": row["board_value_rank"],
        "adp": row[adp],
        "ecr": row[ecr],
        "propsPoints": row["props_points"],
        "propsMarkets": row["props_markets"],
    }


def _oracle_freeze(row: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "boardAsOf": row["boardAsOf"],
        "boardPoints": row["boardPoints"],
        "boardRank": row["boardRank"],
        "boardValueRank": row["boardValueRank"],
        "adp": row["adpRank"],
        "ecr": row["ecrRank"],
        "propsPoints": row["propsPoints"],
        "propsMarkets": row["propsMarkets"],
    }


def _register_grade() -> CaseResult:
    pair = scratch_pair_at(AFTER_KICKOFF, "grade", oracle_fits())
    notes: list[str] = []
    agree = True
    engine = pair.research_engine()
    for week in (1, 2):
        oracle = run_oracle(pair.legacy_url, "grade", "2026", str(week), js_iso(AFTER_KICKOFF))
        try:
            with engine.begin() as conn:
                grade_week(conn, 2026, week, AFTER_KICKOFF)
            port_error = None
        except ValueError as refusal:
            port_error = f"Error: {refusal}"
        agree = agree and _first_sentence(oracle.error) == _first_sentence(port_error)
        notes.append(f"week {week}: oracle {oracle.error or 'graded'}; port {port_error or 'graded'}")
    engine.dispose()
    return CaseResult("register-grade", [], notes, agree)


def _first_sentence(message: str | None) -> str | None:
    return None if message is None else message.split(", so ")[0]


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
        before = fit_step(conn, WEEK_TWO_BOARD + timedelta(hours=1), artifacts)
        after = fit_step(conn, AFTER_KICKOFF, artifacts)
    engine.dispose()
    notes = [f"before kickoff: {before.status}, {before.summary}", f"after kickoff: {after.status}, {after.summary}"]
    return CaseResult("fit-check", [], notes, before.status == "ran" and after.status == "skipped")


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
    ModelCase("numerics", "V8's log, exp, sin, pow, Math.round and mulberry32, bit for bit", False, _numerics),
    ModelCase(
        "board-2026-week2",
        "every leg of the 2026 board at its stored moment; against the store and the week-2 register",
        True,
        _board_week_two,
    ),
    ModelCase(
        "board-2026-week1",
        "every leg at the week-1 board's moment; against the week-1 register, by cause",
        True,
        _board_week_one,
    ),
    ModelCase(
        "register-freeze-week2",
        "the week-2 freeze retaken at its instant, against the stored freeze and the oracle",
        True,
        _register_freeze,
    ),
    ModelCase("register-grade", "grading weeks 1 and 2 on today's store", True, _register_grade),
    ModelCase("held-out-backtest", "the stored served board against outcomes in the held-out seasons", True, _held_out),
    ModelCase("fit-check", "the fit step's check: the live board before kickoff, the archive after", True, _fit_check),
    ModelCase(
        "fit-game-variance",
        "the per-game variance fit on 2023-2024, oracle against port, and the published v1",
        True,
        _fit_game_variance,
    ),
)
MODEL_CASES_BY_NAME: Final[Mapping[str, ModelCase]] = {case.name: case for case in MODEL_CASES}
