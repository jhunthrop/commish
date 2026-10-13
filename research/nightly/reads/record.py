"""THE RECORD: the prospective register's served board against the season so far, against ADP.

Read from the register as the in-season job writes it (`model.register`): each week's latest freeze
of the served board, and its latest grading. A week's line grades our order and ADP's on the same
players (the frozen players with an ADP and a stat line that week), all of them and position by
position, each with the register's own statistics (`model.register.grade.score_columns`): Spearman's
rank correlation with what the players scored, and the mean distance in places between the order
and the finish. The season to date is the register's running score (`runningScoreboard`): the mean
of the graded weeks' numbers, over every player any graded week counted.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final

from sqlalchemy import Connection, text

from research.model.backtest import Observation, spearman, sum_left
from research.model.register.freeze import SERVED_SOURCE
from research.model.register.grade import average_outcome_ranks, ordinal_ranks

RECORD_POSITIONS: Final = ("QB", "RB", "WR", "TE", "K", "DST")
ALL: Final = "All"
STATISTIC: Final = {"agreement": "agreement with the finish", "placesOff": "places off, typical player"}
METHOD: Final = (
    "Each week our PPR board is frozen before the week's first kickoff and graded after its games against how its "
    "players scored, with ADP graded the same way on the same players."
)


@dataclass(frozen=True, slots=True)
class Score:
    graded: int
    agreement: float | None
    places_off: float | None


@dataclass(frozen=True, slots=True)
class Line:
    position: str
    ours: Score
    adp: Score


@dataclass(frozen=True, slots=True)
class Week:
    week: int
    frozen_at: datetime
    board_as_of: datetime
    graded_at: datetime | None
    population: int
    lines: tuple[Line, ...]


def _score(entries: Sequence[tuple[str, float, float]]) -> Score:
    """One order's score over (player, stance, points): its ordinal ranks against the finish."""
    if not entries:
        return Score(0, None, None)
    ranks = ordinal_ranks([(pid, stance) for pid, stance, _ in entries])
    outcome = average_outcome_ranks([(pid, points) for pid, _, points in entries])
    error = sum_left([abs(ranks[pid] - outcome[pid]) for pid, _, _ in entries]) / len(entries)
    agreement = spearman([Observation(-ranks[pid], points) for pid, _, points in entries])
    return Score(len(entries), agreement, error)


def week_lines(rows: Sequence[Mapping[str, Any]]) -> tuple[Line, ...]:
    """All players, then each position present, on the players both orders rank."""
    both = [row for row in rows if row["adp"] is not None]
    lines = []
    for position in (ALL, *RECORD_POSITIONS):
        subset = both if position == ALL else [row for row in both if row["position"] == position]
        if not subset:
            continue
        ours = _score([(row["player_id"], row["board_points"], row["actual_points"]) for row in subset])
        adp = _score([(row["player_id"], -row["adp"], row["actual_points"]) for row in subset])
        lines.append(Line(position, ours, adp))
    return tuple(lines)


def _mean(values: Sequence[float]) -> float | None:
    return None if not values else sum_left(values) / len(values)


def _pooled(scores: Sequence[Score], players: int) -> Score:
    return Score(
        players,
        _mean([s.agreement for s in scores if s.agreement is not None]),
        _mean([s.places_off for s in scores if s.places_off is not None]),
    )


def to_date(weeks: Sequence[Week], rows_by_week: Mapping[int, Sequence[Mapping[str, Any]]]) -> tuple[Line, ...]:
    """The running score: per position, the mean of each graded week's numbers."""
    graded = [week for week in weeks if week.graded_at is not None]
    lines = []
    for position in (ALL, *RECORD_POSITIONS):
        found = [line for week in graded for line in week.lines if line.position == position]
        if not found:
            continue
        players = {
            row["player_id"]
            for week in graded
            for row in rows_by_week[week.week]
            if row["adp"] is not None and (position == ALL or row["position"] == position)
        }
        ours = _pooled([line.ours for line in found], len(players))
        lines.append(Line(position, ours, _pooled([line.adp for line in found], len(players))))
    return tuple(lines)


_FREEZES: Final = """
select week, max(frozen_at) as frozen_at from research.register_freeze_rows
where season = :s and board_source = :source group by week order by week
"""
_GRADED: Final = """
select g.player_id, g.actual_points, g.graded_at, f.board_points, f.adp, f.board_as_of,
       case when p.position in ('DEF', 'DST') then 'DST' else p.position end as position
from research.register_grade_rows g
join research.register_freeze_rows f on f.season = g.season and f.week = g.week and f.frozen_at = g.frozen_at
  and f.board_source = g.board_source and f.player_id = g.player_id
join research.players p on p.id = g.player_id
where g.season = :s and g.week = :w and g.frozen_at = :f and g.board_source = :source
  and g.graded_at = (select max(graded_at) from research.register_grade_rows
                     where season = :s and week = :w and frozen_at = :f and board_source = :source)
"""


def read_record(conn: Connection, season: int) -> tuple[list[Week], dict[int, list[Mapping[str, Any]]]]:
    """Every week the served board was frozen for, with its latest grading's lines."""
    weeks: list[Week] = []
    rows_by_week: dict[int, list[Mapping[str, Any]]] = {}
    for freeze in conn.execute(text(_FREEZES), {"s": season, "source": SERVED_SOURCE}):
        params = {"s": season, "w": freeze.week, "f": freeze.frozen_at, "source": SERVED_SOURCE}
        rows: list[Mapping[str, Any]] = [row._asdict() for row in conn.execute(text(_GRADED), params)]
        board_as_of = conn.execute(
            text(
                "select max(board_as_of) from research.register_freeze_rows "
                "where season = :s and week = :w and frozen_at = :f and board_source = :source"
            ),
            params,
        ).scalar_one()
        rows_by_week[freeze.week] = rows
        graded_at = max((row["graded_at"] for row in rows), default=None)
        weeks.append(Week(freeze.week, freeze.frozen_at, board_as_of, graded_at, len(rows), week_lines(rows)))
    return weeks, rows_by_week
