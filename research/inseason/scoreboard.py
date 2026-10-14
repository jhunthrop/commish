"""THE RUNNING SCOREBOARD the weekly pass prints, ported from `register/grade.ts` (`runningScoreboard`,
`latestGradeRowsByWeek`, `formatScoreboard`).

Each week counts its latest grading only. Per board, per column, the score is the mean over graded
weeks of that week's Spearman and mean absolute rank error (`score_columns`). The served board
contributes all four columns; a shadow board contributes only its own.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import Connection, text

from research.model.backtest import mean_or_none
from research.model.register.freeze import SERVED_SOURCE
from research.model.register.grade import REGISTER_COLUMNS, score_columns


@dataclass(frozen=True, slots=True)
class CumulativeScore:
    board_source: str
    column: str
    weeks: int
    spearman: float | None
    mean_absolute_rank_error: float | None


def latest_grade_rows_by_week(rows: Sequence[Mapping[str, Any]]) -> dict[int, list[Mapping[str, Any]]]:
    """`latestGradeRowsByWeek`: each week's rows from its newest grading."""
    latest: dict[int, datetime] = {}
    for row in rows:
        held = latest.get(row["week"])
        if held is None or row["graded_at"] > held:
            latest[row["week"]] = row["graded_at"]
    grouped: dict[int, list[Mapping[str, Any]]] = {}
    for row in rows:
        if row["graded_at"] == latest[row["week"]]:
            grouped.setdefault(row["week"], []).append(row)
    return grouped


def grade_rows_for(conn: Connection, season: int) -> list[Mapping[str, Any]]:
    return [
        row._asdict()
        for row in conn.execute(
            text(
                "select * from research.register_grade_rows where season = :s "
                "order by week, graded_at, board_source, player_id"
            ),
            {"s": season},
        )
    ]


def running_scoreboard(conn: Connection, season: int) -> list[CumulativeScore]:
    by_week = latest_grade_rows_by_week(grade_rows_for(conn, season))
    sources = sorted(
        {row["board_source"] for rows in by_week.values() for row in rows}, key=lambda s: (s != SERVED_SOURCE, s)
    )
    scores: list[CumulativeScore] = []
    for source in sources:
        per_week = [
            score_columns(week_rows)
            for week in sorted(by_week)
            if (week_rows := [row for row in by_week[week] if row["board_source"] == source])
        ]
        columns = REGISTER_COLUMNS if source == SERVED_SOURCE else ("board",)
        for column in columns:
            graded = [s for week in per_week for s in week if s.column == column and s.graded > 0]
            scores.append(
                CumulativeScore(
                    source,
                    column,
                    len(graded),
                    mean_or_none([s.spearman for s in graded if s.spearman is not None]),
                    mean_or_none(
                        [s.mean_absolute_rank_error for s in graded if s.mean_absolute_rank_error is not None]
                    ),
                )
            )
    return scores


def _show(value: float | None, digits: int) -> str:
    return "n/a" if value is None else f"{value:.{digits}f}"


def scoreboard_lines(conn: Connection, season: int) -> list[str]:
    """The scoreboard as printable lines, every board and column named even when it has nothing."""
    scores = running_scoreboard(conn, season)
    if not scores:
        return ["no graded weeks yet"]
    return [
        f"{score.board_source} {score.column}: {score.weeks} weeks, Spearman {_show(score.spearman, 3)}, "
        f"mean absolute rank error {_show(score.mean_absolute_rank_error, 1)}"
        for score in scores
    ]
