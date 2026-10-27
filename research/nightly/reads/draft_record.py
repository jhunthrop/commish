"""THE DRAFT RECORD: our draft board against ADP, on the season's points so far (Lane 114).

The board a member drafted from is the preseason order the register set before the season's first
kickoff: the earliest freeze of the served board (`SERVED_SOURCE`), with ADP as it stood then. It is
graded on each player's season points to date (twelve-team PPR, the register's own scoring,
`model.register.grade`), over the season's complete weeks from week 1 on, a week complete as the
grade counts it (`week_complete.is_complete`: every game's final and both clubs' lines in as of the run,
Lane 250, B254), refreshed each night with the weekly stats. This is the only record that grades
against ADP.

Every measure is graded within a position (fix round 1): our board's order among the quarterbacks
against the season's quarterback finishers, ADP's order among them likewise, and so on; the All line is
the position lines combined, weighted by players graded (`combined`), never raw points pooled across
positions. The players graded are the season's finishers both orders rank: frozen on the board, with an ADP, and
with a stat line in a counted week, at quarterback, running back, receiver and tight end (the board's
kickers and defenses follow the draft market's order, so grading them against it says nothing). The
measures are the record's (`record.score_entries`): order matched, places off, and the season's top 12
QBs, 24 RBs, 36 WRs and 12 TEs so far that the order also named in its top 12, 24, 36 and 12 (the
starters a 12-team league's draft fills). `progress` is the All line's order matched for both orders
after each counted week, the chart's points.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final

from sqlalchemy import Connection, text

from research.inseason.season_week import last_kickoffs_by_week
from research.inseason.week_complete import is_complete, week_state
from research.model.domain import PPR_SCORING, compute_fantasy_points
from research.model.reads.observations import ObservationQuery, WeekRange, stat_lines_as_of
from research.model.register.freeze import SERVED_SOURCE
from research.model.register.grade import scoring_position_for
from research.nightly.reads.record import (
    ALL,
    LEAGUE_TEAMS,
    STARTERS_A_TEAM,
    Entry,
    Score,
    score_entries,
    trail_clauses,
)

DRAFT_POSITIONS: Final = ("QB", "RB", "WR", "TE")
_WORDS: Final = {"QB": "QBs", "RB": "RBs", "WR": "WRs", "TE": "TEs"}
_NAMED_CLAUSE: Final = "{name} named more of the season's top players so far, {theirs} of {of} against our {ours}"


@dataclass(frozen=True, slots=True)
class DraftLine:
    position: str
    ours: Score
    adp: Score


@dataclass(frozen=True, slots=True)
class DraftPoint:
    """Order matched on the season's points through one week, All positions."""

    week: int
    ours: float | None
    adp: float | None


@dataclass(frozen=True, slots=True)
class DraftRecord:
    set_at: datetime
    board_as_of: datetime
    # The last complete week counted, None before the first.
    through_week: int | None
    lines: tuple[DraftLine, ...]
    progress: tuple[DraftPoint, ...]


_BOARD: Final = """
select f.player_id, f.board_points, f.adp, f.frozen_at, f.board_as_of,
       case when p.position in ('DEF', 'DST') then 'DST' else p.position end as position
from research.register_freeze_rows f
join research.players p on p.id = f.player_id
where f.season = :s and f.board_source = :source and f.adp is not null and p.position = any(:positions)
  and f.frozen_at = (select min(frozen_at) from research.register_freeze_rows where season = :s and board_source = :source)
"""


def draft_board(conn: Connection, season: int) -> list[Mapping[str, Any]]:
    """The board the season was drafted from: the first freeze's served rows with an ADP, at the four
    graded positions. Empty before the season's first freeze."""
    params = {"s": season, "source": SERVED_SOURCE, "positions": list(DRAFT_POSITIONS)}
    return [row._asdict() for row in conn.execute(text(_BOARD), params)]


def complete_weeks(conn: Connection, season: int, as_of: datetime) -> list[int]:
    """The season's weeks complete as of the run, in order, up to the first that is not: "through week
    N" counts every week to N, so a later week never counts past one still waiting on its stats."""
    weeks: list[int] = []
    for week in sorted(last_kickoffs_by_week(conn, season)):
        if not is_complete(week_state(conn, season, week, as_of), as_of):
            break
        weeks.append(week)
    return weeks


def weekly_points(
    conn: Connection, season: int, weeks: Sequence[int], as_of: datetime, positions: Mapping[str, str]
) -> dict[int, dict[str, float]]:
    """Each counted week's points per board player with a stat line that week, scored as the register
    grades a week."""
    if not weeks:
        return {}
    query = ObservationQuery(season, WeekRange(min(weeks), max(weeks)), as_of, player_ids=tuple(sorted(positions)))
    out: dict[int, dict[str, float]] = {week: {} for week in weeks}
    for row in stat_lines_as_of(conn, query):
        line = row.line
        if line.week in out:
            position = scoring_position_for(positions[line.player_id])
            out[line.week][line.player_id] = compute_fantasy_points(line, position, PPR_SCORING)
    return out


def _season_to(points: Mapping[int, Mapping[str, float]], through: int) -> dict[str, float]:
    """Each player's points summed over the counted weeks up to `through`, only players with a line."""
    total: dict[str, float] = {}
    for week, by_player in points.items():
        if week > through:
            continue
        for pid, value in by_player.items():
            total[pid] = total.get(pid, 0.0) + value
    return total


def _entries(board: Sequence[Mapping[str, Any]], totals: Mapping[str, float], stance: str) -> list[Entry]:
    out: list[Entry] = []
    for row in board:
        if row["player_id"] not in totals:
            continue
        value = row[stance]
        held = -float(value) if stance == "adp" else float(value)
        out.append((row["player_id"], held, totals[row["player_id"]], row["position"]))
    return out


def _weighted(values: Sequence[tuple[float | None, int]]) -> float | None:
    """The mean of the figures held, each weighted by its players graded; None with none held."""
    held = [(value, n) for value, n in values if value is not None and n > 0]
    total = sum(n for _, n in held)
    return None if total == 0 else sum(value * n for value, n in held) / total


def combined(scores: Sequence[Score]) -> Score:
    """Position lines combined into the All line (Lane 114 fix round 1, H1): order matched and places
    off weighted by each position's players graded, top named summed. Never a grade of raw points pooled
    across positions, which ranks a board's points against ADP's cross-position pick order."""
    return Score(
        sum(s.graded for s in scores),
        _weighted([(s.agreement, s.graded) for s in scores]),
        _weighted([(s.places_off, s.graded) for s in scores]),
        sum(s.starters for s in scores),
        sum(s.starters_of for s in scores),
    )


def lines_for(board: Sequence[Mapping[str, Any]], totals: Mapping[str, float]) -> tuple[DraftLine, ...]:
    """Each position graded on its own (our board's order among its players against their finish, ADP's
    likewise), then All as those lines combined (`combined`), first."""
    lines = []
    for position in DRAFT_POSITIONS:
        subset = [row for row in board if row["position"] == position]
        ours, adp = _entries(subset, totals, "board_points"), _entries(subset, totals, "adp")
        if ours:
            lines.append(DraftLine(position, score_entries(ours), score_entries(adp)))
    if not lines:
        return ()
    every = DraftLine(ALL, combined([line.ours for line in lines]), combined([line.adp for line in lines]))
    return (every, *lines)


def read_draft(conn: Connection, season: int, as_of: datetime) -> DraftRecord | None:
    """The draft record at the run, None before the season's first freeze."""
    board = draft_board(conn, season)
    if not board:
        return None
    weeks = complete_weeks(conn, season, as_of)
    positions = {row["player_id"]: row["position"] for row in board}
    points = weekly_points(conn, season, weeks, as_of, positions)
    counted = [week for week in weeks if points.get(week)]
    through = counted[-1] if counted else None
    totals = {} if through is None else _season_to(points, through)
    progress = []
    for week in counted:
        line = next(iter(lines_for(board, _season_to(points, week))), None)
        if line is not None:
            progress.append(DraftPoint(week, line.ours.agreement, line.adp.agreement))
    first = board[0]
    return DraftRecord(first["frozen_at"], first["board_as_of"], through, lines_for(board, totals), tuple(progress))


def named_basis(lines: Sequence[DraftLine]) -> str | None:
    """What "top named" counts, from the positions graded: "Top named counts how many of the season's top
    12 QBs, 24 RBs, 36 WRs and 12 TEs so far the order also ranked that high." The tops are said once, so
    the sentence never ends on their list again (Lane 138). None before a week is counted."""
    graded = [p for p in DRAFT_POSITIONS if any(line.position == p and line.ours.starters_of > 0 for line in lines)]
    if not graded:
        return None
    counts = [f"{STARTERS_A_TEAM[p] * LEAGUE_TEAMS} {_WORDS[p]}" for p in graded]
    listed = counts[0] if len(counts) == 1 else f"{', '.join(counts[:-1])} and {counts[-1]}"
    return f"Top named counts how many of the season's top {listed} so far the order also ranked that high."


def honest_line(lines: Sequence[DraftLine]) -> str | None:
    """The sentence the page prints when ADP called the season so far better than our board on any
    figure, all positions together; None when ours leads or ties on every one."""
    line = next((line for line in lines if line.position == ALL), None)
    if line is None:
        return None
    clauses = trail_clauses(line.ours, line.adp, "ADP", _NAMED_CLAUSE)
    if not clauses:
        return None
    return " ".join(f"{clause[0].upper()}{clause[1:]}." for clause in clauses)
