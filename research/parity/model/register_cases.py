"""THE REGISTER CASES: freezing and grading, the oracle and the port on the same scratch copy.

The freeze rows each side writes carry `implementation` and (the port's) `model_version`; those are
excluded from the comparison because they say which process wrote the row, which is the one thing
that differs by design. Every other field is compared exactly, and a refusal is compared whole
(after the declared wording map, `grade.REFUSAL_WORDING`).
"""

from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from types import MappingProxyType
from typing import Any, Final

from research.model.instants import js_iso
from research.model.register.freeze import take_freeze
from research.model.register.grade import REFUSAL_WORDING, grade_week
from research.parity.model.compare import Diff, diff_rows
from research.parity.model.outcome import CaseResult, Claim, keyed_by, refusals, source_rows
from research.parity.model.sides import run_oracle
from research.parity.model.store import ScratchPair, oracle_fits, scratch_pair_at

WEEK_TWO_FREEZE: Final = datetime(2026, 9, 10, 18, 0, 17, 177000, tzinfo=UTC)
AFTER_KICKOFF: Final = datetime(2026, 10, 12, 12, 0, tzinfo=UTC)
WEEK_TWO_MODELS: Final = MappingProxyType(
    {"commish_board_v9_ppr_12": "research-ts@7af71283", "commish_board_v7_ppr_12": "research-ts@6603c2ac"}
)
# The held-out grade: 2024 week 2 kicked off 2024-09-13T00:15Z; the store holds its boards, its
# kickoffs and its outcomes, so a freeze two days before and a grade today exercise every field.
HELD_OUT_FREEZE: Final = datetime(2024, 9, 10, 12, 0, tzinfo=UTC)
HELD_OUT_MODELS: Final = MappingProxyType(
    {
        "commish_board_v9_ppr_12": "research-ts@5240ed99",
        "commish_board_v7_ppr_12": "research-ts@5b0a0ddd",
    }
)
_ONE_MS: Final = timedelta(milliseconds=1)
_FREEZE_FIELDS: Final = (
    ("boardAsOf", "board_as_of"),
    ("boardPoints", "board_points"),
    ("boardRank", "board_rank"),
    ("boardValueRank", "board_value_rank"),
    ("adpRank", "adp"),
    ("ecrRank", "ecr"),
    ("propsPoints", "props_points"),
    ("propsMarkets", "props_markets"),
)
_GRADE_FIELDS: Final = (
    ("frozenAt", "frozen_at"),
    ("gradedAt", "graded_at"),
    ("actualPoints", "actual_points"),
    ("actualRank", "actual_rank"),
    ("boardRank", "board_rank"),
    ("adpRank", "adp_rank"),
    ("ecrRank", "ecr_rank"),
    ("propsRank", "props_rank"),
)


def _ours(row: Mapping[str, Any], fields: tuple[tuple[str, str], ...]) -> dict[str, Any]:
    return {theirs: js_iso(row[ours]) if isinstance(row[ours], datetime) else row[ours] for theirs, ours in fields}


def _theirs(row: Mapping[str, Any], fields: tuple[tuple[str, str], ...]) -> dict[str, Any]:
    return {theirs: row[theirs] for theirs, _ in fields}


def _oracle_rows(lines: list[Any], fields: tuple[tuple[str, str], ...]) -> dict[str, Mapping[str, Any]]:
    rows = [row for line in lines for row in line["rows"]]
    return {f"{row['boardSource']}|{row['playerId']}": _theirs(row, fields) for row in rows}


def _freeze_both(
    pair: ScratchPair, season: int, week: int, now: datetime
) -> tuple[Diff, list[dict[str, Any]], str | None]:
    oracle = run_oracle(pair.legacy_url, "freeze", str(season), str(week), js_iso(now))
    engine = pair.research_engine()
    with engine.begin() as conn:
        port_rows = take_freeze(conn, season, week, now).rows
    engine.dispose()
    port = {key: _ours(row, _FREEZE_FIELDS) for key, row in keyed_by(port_rows, "board_source", "player_id").items()}
    return (
        diff_rows(f"{season} week {week} freeze, oracle vs port", _oracle_rows(oracle.lines, _FREEZE_FIELDS), port),
        port_rows,
        oracle.error,
    )


def _grade_both(
    pair: ScratchPair, season: int, week: int, now: datetime
) -> tuple[Diff, list[dict[str, Any]], bool, list[str]]:
    oracle = run_oracle(pair.legacy_url, "grade", str(season), str(week), js_iso(now))
    engine = pair.research_engine()
    try:
        with engine.begin() as conn:
            port_rows = grade_week(conn, season, week, now)
        port_error = None
    except ValueError as refusal:
        port_rows, port_error = [], f"Error: {refusal}"
    engine.dispose()
    agree, notes = refusals(f"{season} week {week} grade", oracle.error, port_error, REFUSAL_WORDING)
    port = {key: _ours(row, _GRADE_FIELDS) for key, row in keyed_by(port_rows, "board_source", "player_id").items()}
    diff = diff_rows(
        f"{season} week {week} grade, oracle vs port",
        _oracle_rows(oracle.lines, _GRADE_FIELDS),
        port,
        may_be_empty=True,
    )
    return diff, port_rows, agree, notes


def register_freeze_week_two() -> CaseResult:
    pair = scratch_pair_at(WEEK_TWO_FREEZE - _ONE_MS, "freeze", oracle_fits())
    oracle_diff, port_rows, oracle_error = _freeze_both(pair, 2026, 2, WEEK_TWO_FREEZE)
    stored_rows = source_rows(
        "select * from public.register_freeze_rows where season = 2026 and week = 2 and frozen_at = %s",
        (WEEK_TWO_FREEZE,),
    )
    stored = {
        key: _ours({**row, "adp": row["adp_rank"], "ecr": row["ecr_rank"]}, _FREEZE_FIELDS)
        for key, row in keyed_by(stored_rows, "board_source", "player_id").items()
    }
    port = {key: _ours(row, _FREEZE_FIELDS) for key, row in keyed_by(port_rows, "board_source", "player_id").items()}
    models = {row["board_source"]: row["model_version"] for row in port_rows}
    return CaseResult(
        "register-freeze-week2",
        [diff_rows("stored week-2 freeze vs port", stored, port), oracle_diff],
        [
            "implementation and model_version excluded: they name the process that wrote the row",
            f"port model versions: {dict(sorted(models.items()))}",
        ],
        oracle_error is None,
        [Claim("each port row quotes its board's model", models == WEEK_TWO_MODELS)],
    )


def register_grade_live() -> CaseResult:
    pair = scratch_pair_at(AFTER_KICKOFF, "grade", oracle_fits())
    diffs: list[Diff] = []
    notes: list[str] = []
    agree = True
    for week in (1, 2):
        diff, _, week_agrees, week_notes = _grade_both(pair, 2026, week, AFTER_KICKOFF)
        diffs.append(diff)
        notes += week_notes
        agree = agree and week_agrees
    return CaseResult("register-grade", diffs, notes, agree)


def register_grade_held_out() -> CaseResult:
    pair = scratch_pair_at(AFTER_KICKOFF, "grade2024", oracle_fits())
    freeze_diff, freeze_rows, freeze_error = _freeze_both(pair, 2024, 2, HELD_OUT_FREEZE)
    grade_diff, grade_rows, agree, notes = _grade_both(pair, 2024, 2, AFTER_KICKOFF)
    freeze_models = {row["board_source"]: row["model_version"] for row in freeze_rows}
    claims = [
        Claim("the freeze froze rows", bool(freeze_rows)),
        Claim("the grade graded rows", bool(grade_rows)),
        Claim("each freeze row quotes its board's model", freeze_models == HELD_OUT_MODELS),
        Claim(
            "each grade row carries implementation python and its freeze row's model",
            all(
                row["implementation"] == "python" and row["model_version"] == freeze_models[row["board_source"]]
                for row in grade_rows
            ),
        ),
    ]
    notes.append(f"freeze: oracle {freeze_error or 'froze'}")
    return CaseResult(
        "register-grade-2024-week2", [freeze_diff, grade_diff], notes, agree and freeze_error is None, claims
    )
