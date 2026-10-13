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

from sqlalchemy import text

from research.model.instants import js_iso
from research.model.register.freeze import RegisterRefusalError, take_freeze
from research.model.register.grade import REFUSAL_WORDING, WeekGrade, grade_week
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
_SERVED: Final = "commish_board_v9_ppr_12"
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


def _oracle_grade(lines: list[Any]) -> dict[str, Any]:
    return lines[0] if lines else {"rows": [], "boards": [], "skipped": [], "population": None}


def _scores(boards: list[Mapping[str, Any]]) -> dict[str, Mapping[str, Any]]:
    return {f"{board['boardSource']}|{score['column']}": score for board in boards for score in board["scores"]}


def _port_grade(grade: WeekGrade | None) -> dict[str, Any]:
    """The port's week grade in the oracle's shape: rows, per-board population and scores, skipped."""
    if grade is None:
        return {"rows": [], "boards": [], "skipped": [], "population": None}
    boards = [
        {
            "boardSource": board.board_source,
            "population": board.population,
            "scores": [
                {
                    "column": score.column,
                    "graded": score.graded,
                    "spearman": score.spearman,
                    "meanAbsoluteRankError": score.mean_absolute_rank_error,
                }
                for score in board.scores
            ],
        }
        for board in grade.boards
    ]
    skipped = [{"boardSource": board.board_source, "reason": board.reason} for board in grade.skipped]
    return {"rows": grade.rows, "boards": boards, "skipped": skipped, "population": grade.population}


def _grade_diffs(label: str, oracle: Mapping[str, Any], port: Mapping[str, Any]) -> list[Diff]:
    """Every output of a week grade: the rows, each board's population and order, its four column
    scores, the skipped boards with their reasons, and the served population."""
    rows = {key: _ours(row, _GRADE_FIELDS) for key, row in keyed_by(port["rows"], "board_source", "player_id").items()}
    return [
        diff_rows(f"{label} rows", _oracle_rows([oracle], _GRADE_FIELDS), rows, may_be_empty=True),
        diff_rows(
            f"{label} boards, in order, and populations",
            {
                str(i): {"boardSource": b["boardSource"], "population": b["population"]}
                for i, b in enumerate(oracle["boards"])
            },
            {
                str(i): {"boardSource": b["boardSource"], "population": b["population"]}
                for i, b in enumerate(port["boards"])
            },
            may_be_empty=True,
        ),
        diff_rows(f"{label} column scores", _scores(oracle["boards"]), _scores(port["boards"]), may_be_empty=True),
        diff_rows(
            f"{label} skipped boards and served population",
            {**keyed_by(oracle["skipped"], "boardSource"), "population": {"population": oracle["population"]}},
            {**keyed_by(port["skipped"], "boardSource"), "population": {"population": port["population"]}},
        ),
    ]


def _grade_both(
    pair: ScratchPair, season: int, week: int, now: datetime
) -> tuple[list[Diff], WeekGrade | None, bool, list[str]]:
    oracle = run_oracle(pair.legacy_url, "grade", str(season), str(week), js_iso(now))
    engine = pair.research_engine()
    grade: WeekGrade | None = None
    try:
        with engine.begin() as conn:
            grade = grade_week(conn, season, week, now)
        port_error = None
    except ValueError as refusal:
        port_error = f"Error: {refusal}"
    engine.dispose()
    agree, notes = refusals(f"{season} week {week} grade", oracle.error, port_error, REFUSAL_WORDING)
    label = f"{season} week {week} grade, oracle vs port:"
    return _grade_diffs(label, _oracle_grade(oracle.lines), _port_grade(grade)), grade, agree, notes


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
        week_diffs, _, week_agrees, week_notes = _grade_both(pair, 2026, week, AFTER_KICKOFF)
        diffs += week_diffs
        notes += week_notes
        agree = agree and week_agrees
    return CaseResult("register-grade", diffs, notes, agree)


def register_grade_held_out() -> CaseResult:
    pair = scratch_pair_at(AFTER_KICKOFF, "grade2024", oracle_fits())
    freeze_diff, freeze_rows, freeze_error = _freeze_both(pair, 2024, 2, HELD_OUT_FREEZE)
    grade_diffs, grade, agree, notes = _grade_both(pair, 2024, 2, AFTER_KICKOFF)
    grade_rows = [] if grade is None else grade.rows
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
        "register-grade-2024-week2", [freeze_diff, *grade_diffs], notes, agree and freeze_error is None, claims
    )


def register_freeze_unknown_model() -> CaseResult:
    """A board that names no model is refused by the freeze, and nothing is written."""
    pair = scratch_pair_at(AFTER_KICKOFF, "unknown", oracle_fits())
    engine = pair.research_engine()
    refusal: RegisterRefusalError | None = None
    with engine.begin() as conn:
        conn.execute(
            text("update research.preseason_projections set model_version = null where season = 2024 and source = :s"),
            {"s": _SERVED},
        )
        try:
            take_freeze(conn, 2024, 2, HELD_OUT_FREEZE)
        except RegisterRefusalError as error:
            refusal = error
        written = conn.execute(text("select count(*) from research.register_freeze_rows where season = 2024")).scalar()
    engine.dispose()
    expected = (
        f"2024 {_SERVED} at 2024-09-06T23:59:59.999Z names no model version, so its claim cannot be frozen as anyone's."
    )
    claims = [
        Claim("the freeze refused with code unknown_model", refusal is not None and refusal.code == "unknown_model"),
        Claim("the refusal names the board and its moment", refusal is not None and str(refusal) == expected),
        Claim("nothing was written", written == 0),
    ]
    return CaseResult("register-freeze-unknown-model", [], [f"refusal: {refusal}"], True, claims)
