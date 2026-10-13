"""GRADING A WEEK: the latest pre-kickoff freeze against what the week then produced.

Ported from `research-ts/src/projections/register/grade.ts`. Each tracked board in the freeze is
graded on the players who have a stat line: their actual points (twelve-team PPR, the register's
own scoring), each column's ordinal rank of its stance, and the running scoreboard over weeks.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final

from sqlalchemy import Connection, text

from research.model.backtest import Observation, spearman, sum_left
from research.model.domain import PPR_SCORING, Position, StatLine, compute_fantasy_points
from research.model.instants import js_iso, ms_instant
from research.model.jsmath import js_sorted, locale_compare
from research.model.reads.observations import ObservationQuery, stat_lines_as_of
from research.model.register.freeze import SERVED_SOURCE

REGISTER_COLUMNS: Final = ("board", "adp", "ecr", "props")


def _stance(row: Mapping[str, Any], column: str) -> float | None:
    if column == "board":
        return float(row["board_points"])
    if column == "adp":
        return None if row["adp"] is None else -float(row["adp"])
    if column == "ecr":
        return None if row["ecr"] is None else -float(row["ecr"])
    return None if row["props_points"] is None else float(row["props_points"])


def ordinal_ranks(entries: Sequence[tuple[str, float]]) -> dict[str, int]:
    """`ordinalRanks`: highest value first, ties by id."""
    ordered = js_sorted(entries, lambda a, b: (b[1] - a[1]) or locale_compare(a[0], b[0]))
    return {key: index + 1 for index, (key, _) in enumerate(ordered)}


def average_outcome_ranks(entries: Sequence[tuple[str, float]]) -> dict[str, float]:
    """`averageOutcomeRanks`: highest first, ties share their average rank."""
    ordered = js_sorted(entries, lambda a, b: b[1] - a[1])
    ranks: dict[str, float] = {}
    position = 0
    while position < len(ordered):
        end = position
        while end + 1 < len(ordered) and ordered[end + 1][1] == ordered[position][1]:
            end += 1
        shared = (position + end) / 2 + 1
        for index in range(position, end + 1):
            ranks[ordered[index][0]] = shared
        position = end + 1
    return ranks


def scoring_position_for(nflverse_position: str) -> Position:
    """`scoringPositionFor`: only TE and DEF change how a line scores."""
    if nflverse_position == "TE":
        return "TE"
    if nflverse_position in ("DEF", "DST"):
        return "DEF"
    return "RB"


@dataclass(frozen=True, slots=True)
class ColumnScore:
    column: str
    graded: int
    spearman: float | None
    mean_absolute_rank_error: float | None


def score_columns(rows: Sequence[Mapping[str, Any]]) -> list[ColumnScore]:
    """`scoreColumns`."""
    scores: list[ColumnScore] = []
    for column in REGISTER_COLUMNS:
        covered = [row for row in rows if row[f"{column}_rank"] is not None]
        if not covered:
            scores.append(ColumnScore(column, 0, None, None))
            continue
        outcome = average_outcome_ranks([(row["player_id"], row["actual_points"]) for row in covered])
        error = sum_left([abs(row[f"{column}_rank"] - outcome[row["player_id"]]) for row in covered]) / len(covered)
        correlation = spearman([Observation(-row[f"{column}_rank"], row["actual_points"]) for row in covered])
        scores.append(ColumnScore(column, len(covered), correlation, error))
    return scores


def _grade_board(  # noqa: PLR0913, PLR0917 - the oracle's own parameters, in its order, for a line-by-line read
    key: tuple[int, int, datetime],
    graded_at: datetime,
    source: str,
    graded: Sequence[Mapping[str, Any]],
    positions: Mapping[str, str],
    lines: Mapping[str, StatLine],
) -> list[dict[str, Any]]:
    season, week, frozen_at = key
    actual: dict[str, float] = {}
    for row in graded:
        position = positions.get(row["player_id"])
        if position is None:
            raise ValueError(
                f"{row['player_id']} is frozen for {season} week {week} but carries no players row, so his outcome cannot be scored."
            )
        actual[row["player_id"]] = compute_fantasy_points(
            lines[row["player_id"]], scoring_position_for(position), PPR_SCORING
        )
    actual_ranks = ordinal_ranks([(row["player_id"], actual[row["player_id"]]) for row in graded])
    by_column = {
        column: ordinal_ranks(
            [(row["player_id"], value) for row in graded if (value := _stance(row, column)) is not None]
        )
        for column in REGISTER_COLUMNS
    }
    return [
        {
            "season": season,
            "week": week,
            "frozen_at": frozen_at,
            "graded_at": graded_at,
            "board_source": source,
            "player_id": row["player_id"],
            "actual_points": actual[row["player_id"]],
            "actual_rank": actual_ranks[row["player_id"]],
            "board_rank": by_column["board"][row["player_id"]],
            "adp_rank": by_column["adp"].get(row["player_id"]),
            "ecr_rank": by_column["ecr"].get(row["player_id"]),
            "props_rank": by_column["props"].get(row["player_id"]),
        }
        for row in graded
    ]


def latest_freeze_for(conn: Connection, season: int, week: int) -> datetime | None:
    value = conn.execute(
        text("select max(frozen_at) from research.register_freeze_rows where season = :s and week = :w"),
        {"s": season, "w": week},
    ).scalar()
    return None if value is None else ms_instant(value)


def grade_week(conn: Connection, season: int, week: int, now: datetime, write: bool = True) -> list[dict[str, Any]]:
    """`gradeWeek`: grade the latest freeze of the week, served board first; refuse an empty served grade."""
    frozen_at = latest_freeze_for(conn, season, week)
    if frozen_at is None:
        raise ValueError(f"The register holds no freeze for {season} week {week}, so there is nothing to grade.")
    frozen = [
        row._asdict()
        for row in conn.execute(
            text(
                "select * from research.register_freeze_rows where season = :s and week = :w and frozen_at = :f order by board_source asc, player_id asc"
            ),
            {"s": season, "w": week, "f": frozen_at},
        )
    ]
    graded_at = ms_instant(now)
    lines = {row.line.player_id: row.line for row in stat_lines_as_of(conn, ObservationQuery(season, week, graded_at))}
    if not lines:
        raise ValueError(
            f"The store holds no outcomes for {season} week {week} at or before {js_iso(graded_at)}, so it cannot be graded yet."
        )
    ids = [row["player_id"] for row in frozen]
    positions = {
        row.id: row.position
        for row in conn.execute(text("select id, position from research.players where id = any(:ids)"), {"ids": ids})
    }
    sources = js_sorted(
        sorted({row["board_source"] for row in frozen}),
        lambda a, b: ((a != SERVED_SOURCE) - (b != SERVED_SOURCE)) or locale_compare(a, b),
    )
    rows: list[dict[str, Any]] = []
    for source in sources:
        graded = [row for row in frozen if row["board_source"] == source and row["player_id"] in lines]
        if not graded:
            if source == SERVED_SOURCE:
                raise ValueError(
                    f"No served-board player for {season} week {week} has a stat line. Refusing to grade an empty intersection."
                )
            continue
        rows.extend(_grade_board((season, week, frozen_at), graded_at, source, graded, positions, lines))
    if write:
        _record(conn, rows)
    return rows


def _record(conn: Connection, rows: Sequence[Mapping[str, Any]]) -> None:
    statement = text(
        "insert into research.register_grade_rows (season, week, frozen_at, graded_at, board_source, player_id, actual_points, actual_rank, "
        "board_rank, adp_rank, ecr_rank, props_rank) values (:season, :week, :frozen_at, :graded_at, :board_source, :player_id, "
        ":actual_points, :actual_rank, :board_rank, :adp_rank, :ecr_rank, :props_rank)"
    )
    for row in rows:
        conn.execute(statement, row)
