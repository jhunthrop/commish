"""THE WEEKLY RECORD: our weekly rankings against the weekly experts (Lane 114, Amendment 5).

From the first week a freeze kept the order the site ships (`SHIPPED_SOURCE`, week 7 of 2026), each
week's set order graded on the week's points beside the weekly yardsticks the freeze kept on the same
players: ESPN's own projection (`espn_points`, its public PPR projection read before the order was set)
and the week's published projection (`published_points`). ADP is not a weekly yardstick: it stays in
the register's stored rows for the research record and is graded only on the draft record
(`draft_record`). Weeks before the first such week shipped the draft board and are graded there.

The players graded are the shipped order's frozen players with a stat line that week (no ADP needed),
every yardstick on the same rows under the fill rule (`record.filled_ranks`). The measures are the
record's own (`record.score_entries`): order matched, places off and starters right in the standard
12-team lineup. The season to date pools each yardstick over the weeks that graded it, with ours pooled
again over those weeks beside it, like with like.

ESPN's read is said beside its comparison when it was not the read the order was set with (Amendment 6,
Lane 146): a freeze whose ESPN read failed takes the first read after it and before the week's first
kickoff (`espn_read_at` later than the freeze), and a week no read before kickoff reached is graded
against the published projection alone; a week with neither yardstick says it is graded on its own order
alone (Lane 148). A week whose freeze kept ESPN's read says nothing.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Final

from sqlalchemy import Connection, text

from research.inseason.season_week import GRADE_AFTER, last_kickoffs_by_week
from research.model.reads.teams import kickoff_instants_by_week
from research.model.register.freeze import SERVED_SOURCE, SHIPPED_SOURCE
from research.model.register.grade import ordinal_ranks
from research.nightly.reads.record import (
    ALL,
    RECORD_POSITIONS,
    Score,
    entries_of,
    graded_rows,
    pooled,
    score_entries,
    starters_words,
    trail_clauses,
)
from research.season import REGULAR_SEASON_WEEKS

# The weekly yardsticks, in the order the page draws them: their key on the run, the freeze column
# holding the stance, and their name in the honest sentence. Yahoo is not among them: its Fantasy API
# documents no player projection (Lane 114 report), so no read keeps one.
YARDSTICKS: Final = (
    ("espn", "espn_points", "ESPN"),
    ("published", "published_points", "The published projection"),
)
_STANCE: Final = "board_points"
# The order every set week of the weekly record graded (`recordWeekSchema.order`).
SHIPPED_ORDER: Final = "rest_of_season"
MISSED_NOTE: Final = "Our weekly rankings were not set before kickoff that week."
_METHOD: Final = (
    "From week {week} we set our weekly rankings before each week's first kickoff and graded them on the "
    "week's points{beside}."
)
# Beside the ESPN comparison of a graded week (Amendment 6): the read came after the order was set, no
# read before kickoff reached the week, or neither yardstick did (Lane 148).
ESPN_READ_AFTER_NOTE: Final = (
    "ESPN's projection this week was read after our weekly rankings were set, still before the first kickoff."
)
ESPN_UNREAD_NOTE: Final = (
    "ESPN's projection was not read before this week's first kickoff, so the week is graded against the "
    "week's published projection alone."
)
NO_YARDSTICK_NOTE: Final = (
    "No yardstick was read before this week's first kickoff, so the week is graded on its own order alone."
)
_BESIDE_NAMES: Final = {"espn": "ESPN's projection", "published": "the week's published projection"}


@dataclass(frozen=True, slots=True)
class WeeklyLine:
    position: str
    ours: Score
    # Each yardstick's score on the same rows, None where the week's freeze kept none of it.
    yardsticks: Mapping[str, Score | None]
    # The season to date only: ours over the weeks that graded each yardstick (like with like).
    ours_on: Mapping[str, Score | None] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class WeeklyPlaced:
    """A graded player's place in each order among the week's graded players (None with no stance on
    him) and in the finish: the page counts a league's own starters from these."""

    position: str
    ours: int | None
    yardsticks: Mapping[str, int | None]
    finish: int


@dataclass(frozen=True, slots=True)
class WeeklyWeek:
    week: int
    status: str
    at: datetime | None
    board_as_of: datetime | None
    graded_at: datetime | None
    population: int
    lines: tuple[WeeklyLine, ...]
    grades_from: datetime | None = None
    placed: tuple[WeeklyPlaced, ...] = ()
    # The sentence beside a graded week's ESPN comparison (`espn_note`), None when there is nothing to say.
    espn_note: str | None = None


@dataclass(frozen=True, slots=True)
class WeeklyRecord:
    # The first week of weekly rankings: the first freeze that kept the shipped order, else the next
    # week to be set.
    from_week: int
    weeks: tuple[WeeklyWeek, ...]
    to_date: tuple[WeeklyLine, ...]


def week_lines(rows: Sequence[Mapping[str, Any]]) -> tuple[WeeklyLine, ...]:
    """All players, then each position present: ours and every yardstick the freeze kept for any of
    them, on the same rows."""
    lines = []
    for position in (ALL, *RECORD_POSITIONS):
        subset = list(rows) if position == ALL else [row for row in rows if row["position"] == position]
        if not subset:
            continue
        beside = {
            key: score_entries(entries_of(subset, column))
            if any(row.get(column) is not None for row in subset)
            else None
            for key, column, _ in YARDSTICKS
        }
        lines.append(WeeklyLine(position, score_entries(entries_of(subset, _STANCE)), beside))
    return tuple(lines)


def placed_players(rows: Sequence[Mapping[str, Any]]) -> tuple[WeeklyPlaced, ...]:
    """The week's graded players in the finish's order, each order's ordinal place among them."""
    finished = sorted(rows, key=lambda row: (-row["actual_points"], row["player_id"]))

    def places(column: str) -> dict[str, int]:
        return ordinal_ranks([(pid, held) for pid, held, _, _ in entries_of(rows, column) if held is not None])

    ours = places(_STANCE)
    beside = {key: places(column) for key, column, _ in YARDSTICKS}
    return tuple(
        WeeklyPlaced(
            row["position"],
            ours.get(row["player_id"]),
            {key: placed.get(row["player_id"]) for key, placed in beside.items()},
            place,
        )
        for place, row in enumerate(finished, start=1)
    )


def to_date(
    weeks: Sequence[WeeklyWeek], rows_by_week: Mapping[int, Sequence[Mapping[str, Any]]]
) -> tuple[WeeklyLine, ...]:
    """Per position, the mean of each graded week's numbers, the starters summed; each yardstick over
    the weeks that graded it, ours again over the same weeks."""
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
            if position == ALL or row["position"] == position
        }
        beside: dict[str, Score | None] = {}
        ours_on: dict[str, Score | None] = {}
        for key, _, _ in YARDSTICKS:
            shared = [line for line in found if line.yardsticks.get(key) is not None]
            theirs = [score for line in shared if (score := line.yardsticks.get(key)) is not None]
            most = max((score.graded for score in theirs), default=0)
            beside[key] = pooled(theirs, most) if theirs else None
            ours_on[key] = pooled([line.ours for line in shared], most) if shared else None
        lines.append(WeeklyLine(position, pooled([line.ours for line in found], len(players)), beside, ours_on))
    return tuple(lines)


def drawn(to_date_lines: Sequence[WeeklyLine]) -> tuple[str, ...]:
    """The yardsticks a graded week carries, in page order: the page draws a column only for these."""
    return tuple(key for key, _, _ in YARDSTICKS if any(line.yardsticks.get(key) is not None for line in to_date_lines))


def starters_basis(to_date_lines: Sequence[WeeklyLine]) -> str | None:
    """What starters right counts, from the positions graded; None before a week is graded."""
    return starters_words({line.position for line in to_date_lines if line.ours.starters_of > 0})


def method(from_week: int, to_date_lines: Sequence[WeeklyLine]) -> str:
    """How the weekly record is kept, naming only the yardsticks drawn."""
    names = [_BESIDE_NAMES[key] for key in drawn(to_date_lines)]
    beside = "" if not names else f", beside {' and '.join(names)} on the same players"
    return _METHOD.format(week=from_week, beside=beside)


_STARTERS: Final = (
    "{name} had more of the week's starters right in the standard lineup, {theirs} of {of} against our {ours}"
)


def honest_line(to_date_lines: Sequence[WeeklyLine]) -> str | None:
    """The sentence the page prints when a yardstick called the graded weeks better than our order on
    any figure, all positions together, each compared with ours over its own weeks; None otherwise."""
    line = next((line for line in to_date_lines if line.position == ALL), None)
    if line is None:
        return None
    clauses: list[str] = []
    for key, _, name in YARDSTICKS:
        theirs, ours = line.yardsticks.get(key), line.ours_on.get(key)
        if theirs is not None and ours is not None:
            clauses += trail_clauses(ours, theirs, name, _STARTERS)
    if not clauses:
        return None
    return " ".join(f"{clause[0].upper()}{clause[1:]}." for clause in clauses)


_FREEZES: Final = """
select week, max(frozen_at) as frozen_at from research.register_freeze_rows
where season = :s and board_source = :source group by week order by week
"""


def _kept_shipped(conn: Connection, season: int, freezes: Mapping[int, datetime]) -> set[int]:
    """The weeks whose latest freeze kept the order the site ships."""
    rows = conn.execute(
        text(
            "select distinct week, frozen_at from research.register_freeze_rows where season = :s and board_source = :source"
        ),
        {"s": season, "source": SHIPPED_SOURCE},
    )
    return {int(row.week) for row in rows if freezes.get(int(row.week)) == row.frozen_at}


def first_week(shipped: set[int], kickoffs: Mapping[int, datetime], as_of: datetime) -> int | None:
    """The weekly record's first week: the first whose latest freeze kept the shipped order, else the
    first week whose first kickoff is still ahead (the next to be set); None after the season."""
    if shipped:
        return min(shipped)
    ahead = [week for week, kickoff in kickoffs.items() if kickoff > as_of]
    return min(ahead) if ahead else None


def espn_note(rows: Sequence[Mapping[str, Any]], frozen_at: datetime) -> str | None:
    """What a graded week says of ESPN's read (Amendment 6): read after the order was set when any row's
    figure came from a read later than the freeze, unread when no row carries one but the published
    projection is there to grade against alone, no yardstick when neither is; None when the freeze kept
    ESPN's own read."""
    if any(row.get("espn_points") is not None and _later(row.get("espn_read_at"), frozen_at) for row in rows):
        return ESPN_READ_AFTER_NOTE
    if rows and all(row.get("espn_points") is None for row in rows):
        published = any(row.get("published_points") is not None for row in rows)
        return ESPN_UNREAD_NOTE if published else NO_YARDSTICK_NOTE
    return None


def _later(read_at: datetime | None, frozen_at: datetime) -> bool:
    return read_at is not None and read_at > frozen_at


def _set_week(
    conn: Connection, season: int, week: int, frozen_at: datetime, grades_from: datetime | None
) -> tuple[WeeklyWeek, list[Mapping[str, Any]]]:
    rows, board_as_of = graded_rows(conn, season, week, frozen_at, SHIPPED_SOURCE)
    graded_at = max((row["graded_at"] for row in rows), default=None)
    if graded_at is None:
        return WeeklyWeek(week, "frozen", frozen_at, board_as_of, None, len(rows), (), grades_from), rows
    built = WeeklyWeek(
        week,
        "graded",
        frozen_at,
        board_as_of,
        graded_at,
        len(rows),
        week_lines(rows),
        None,
        placed_players(rows),
        espn_note(rows, frozen_at),
    )
    return built, rows


def read_weekly(
    conn: Connection, season: int, as_of: datetime
) -> tuple[WeeklyRecord | None, dict[int, list[Mapping[str, Any]]]]:
    """Every week from the first week of weekly rankings to the end of the regular season: set and
    graded, set and waiting, missed (its first kickoff passed with no shipped order set) or upcoming.
    None after the season with no week of weekly rankings."""
    freezes = {
        int(row.week): row.frozen_at for row in conn.execute(text(_FREEZES), {"s": season, "source": SERVED_SOURCE})
    }
    kickoffs = kickoff_instants_by_week(conn, season)
    shipped = _kept_shipped(conn, season, freezes)
    start = first_week(shipped, kickoffs, as_of)
    if start is None:
        return None, {}
    ends = last_kickoffs_by_week(conn, season)
    weeks: list[WeeklyWeek] = []
    rows_by_week: dict[int, list[Mapping[str, Any]]] = {}
    for week in range(start, max([REGULAR_SEASON_WEEKS, *freezes]) + 1):
        kickoff = kickoffs.get(week)
        if week in shipped:
            grades_from = None if week not in ends else ends[week] + GRADE_AFTER
            built, rows = _set_week(conn, season, week, freezes[week], grades_from)
            weeks.append(built)
            rows_by_week[week] = rows
        elif kickoff is not None and kickoff <= as_of:
            weeks.append(WeeklyWeek(week, "missed", None, None, None, 0, ()))
        else:
            weeks.append(WeeklyWeek(week, "upcoming", kickoff, None, None, 0, ()))
    return WeeklyRecord(start, tuple(weeks), to_date(weeks, rows_by_week)), rows_by_week
