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

from research.model.backtest import Observation, mean_or_none, spearman, sum_left
from research.model.reads.teams import kickoff_instants_by_week
from research.model.register.freeze import SERVED_SOURCE
from research.model.register.grade import average_outcome_ranks, ordinal_ranks
from research.season import REGULAR_SEASON_WEEKS

# The one sentence a missed week prints. The 2026 misses (weeks 3 to 5) were the old weekly register
# job failing on every pass, not a nightly run (phase D review L1); from cutover a missed freeze fails
# the in-season job (`inseason`) and alerts.
MISSED_NOTE: Final = "Our weekly freeze failed that week."
RECORD_POSITIONS: Final = ("QB", "RB", "WR", "TE", "K", "DST")
ALL: Final = "All"
STATISTIC: Final = {"agreement": "agreement with the finish", "placesOff": "places off, typical player"}
# Graded against the preseason board in season too: freezing and grading the rest-of-season board is
# a later lane's (the coordinator's ruling of 2026-10-14), so the line says which board it grades.
METHOD: Final = (
    "Graded against our preseason board: each week our preseason PPR board is frozen before the week's first "
    "kickoff and graded after its games against how its players scored, with ADP graded the same way on the same "
    "players."
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
    """One week of the season as the record shows it (`recordWeekSchema`): graded, frozen, missed (its
    first kickoff passed with no freeze) or upcoming (`at` is then its first kickoff, if known)."""

    week: int
    status: str
    at: datetime | None
    board_as_of: datetime | None
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


def _pooled(scores: Sequence[Score], players: int) -> Score:
    return Score(
        players,
        mean_or_none([s.agreement for s in scores if s.agreement is not None]),
        mean_or_none([s.places_off for s in scores if s.places_off is not None]),
    )


def to_date(weeks: Sequence[Week], rows_by_week: Mapping[int, Sequence[Mapping[str, Any]]]) -> tuple[Line, ...]:
    """The running score: per position, the mean of each graded week's numbers."""
    graded = [week for week in weeks if week.status == "graded"]
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


def _frozen_week(conn: Connection, season: int, week: int, frozen_at: datetime) -> tuple[Week, list[Mapping[str, Any]]]:
    params = {"s": season, "w": week, "f": frozen_at, "source": SERVED_SOURCE}
    rows: list[Mapping[str, Any]] = [row._asdict() for row in conn.execute(text(_GRADED), params)]
    board_as_of = conn.execute(
        text(
            "select max(board_as_of) from research.register_freeze_rows "
            "where season = :s and week = :w and frozen_at = :f and board_source = :source"
        ),
        params,
    ).scalar_one()
    graded_at = max((row["graded_at"] for row in rows), default=None)
    status = "frozen" if graded_at is None else "graded"
    return Week(week, status, frozen_at, board_as_of, graded_at, len(rows), week_lines(rows)), rows


def read_record(
    conn: Connection, season: int, as_of: datetime
) -> tuple[list[Week], dict[int, list[Mapping[str, Any]]]]:
    """Every week of the regular season in order: each frozen week with its latest grading's lines,
    each week whose first kickoff passed with no freeze as missed, the rest upcoming."""
    freezes = {
        int(row.week): row.frozen_at for row in conn.execute(text(_FREEZES), {"s": season, "source": SERVED_SOURCE})
    }
    kickoffs = kickoff_instants_by_week(conn, season)
    last = max([REGULAR_SEASON_WEEKS, *freezes])
    weeks: list[Week] = []
    rows_by_week: dict[int, list[Mapping[str, Any]]] = {}
    for week in range(1, last + 1):
        kickoff = kickoffs.get(week)
        if week in freezes:
            built, rows = _frozen_week(conn, season, week, freezes[week])
            weeks.append(built)
            rows_by_week[week] = rows
        elif kickoff is not None and kickoff <= as_of:
            weeks.append(Week(week, "missed", None, None, None, 0, ()))
        else:
            weeks.append(Week(week, "upcoming", kickoff, None, None, 0, ()))
    return weeks, rows_by_week


def frozen_weeks(conn: Connection, season: int) -> dict[int, str]:
    """Each week the served board was frozen for, with the implementation of its latest freeze."""
    rows = conn.execute(
        text(
            "select distinct on (week) week, implementation from research.register_freeze_rows "
            "where season = :s and board_source = :source order by week, frozen_at desc"
        ),
        {"s": season, "source": SERVED_SOURCE},
    )
    return {int(row.week): str(row.implementation) for row in rows}
