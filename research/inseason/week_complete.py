"""WHEN A FROZEN WEEK IS COMPLETE, AND THE FIRST PASS THAT CAN GRADE IT (Lane 244).

A week's grade is final (the pass never regrades), so a week grades only once the store holds every
one of its games whole, as of the pass, read from the same rows the grade reads:

- **The week's games** are nflverse's game table (`nflverse_games`, regular season), which the
  pass's `game-table` step refreshes before its `grade` step. A game moved into the week is checked;
  a game moved out leaves it. A game cancelled but kept in `games.csv` with no result, or dropped from
  it and left as a stale row, never completes and holds the week until the overdue alarm fails the
  pass, which names it and the command that voids it (Lane 249, B255, `game_voids`): a game voided as
  of the pass is skipped, its clubs need no result or lines for it, and the check names it once.
- **Each club of each game** must hold its final result (the nflverse `game_result` the stats step
  writes with the lines) dated at or before the pass, and a stat line for one of its players: the
  lines `grade_week` reads (`stat_lines_as_of`, stat fields only, so a zero-usage participation row
  never counts), placed with his club that week by `player_week_teams`.

The store dates a week's lines from its last game (the end of that game's Eastern day plus
`PUBLICATION_LAG_HOURS`, `ingest._week_as_of`), so a Monday night week is first complete at Tuesday
20:00 Eastern (`earliest_grade`), and the first pass at or after that (`GRADING_PASSES`) is the one
the record names (`grades_from`).
"""

import logging
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Final
from zoneinfo import ZoneInfo

from sqlalchemy import Connection, text

from research.inseason.game_voids import voids_in_week
from research.model.instants import js_iso, ms_instant
from research.model.reads.observations import ObservationQuery, stat_lines_as_of
from research.model.reads.teams import player_teams_as_of
from research.pipeline.nflverse.config import PUBLICATION_LAG_HOURS, SEASON_TYPE
from research.pipeline.nflverse.schedule import ScheduleMetric, ScheduleSource, kickoff_as_of

LOG: Final = logging.getLogger(__name__)
EASTERN: Final = ZoneInfo("America/New_York")
# A backstop, not the usual wait: while the store dates a game's lines a day past its Eastern day,
# completeness never comes this soon. It keeps a pass from grading a game half ingested if that
# dating is ever shortened, or a source is read whose stamps sit close to the final whistle.
GRADE_FLOOR: Final = timedelta(hours=6)


@dataclass(frozen=True, slots=True)
class PassSlot:
    """A weekly pass's time in Eastern, the weekday as cron numbers it (0 Sunday to 6 Saturday)."""

    cron_weekday: int
    hour: int
    minute: int


# The `research-season-week-*` jobs in `infra/research-schedule.sh`; a test holds the two equal.
GRADING_PASSES: Final = (
    PassSlot(2, 8, 0),
    PassSlot(2, 20, 30),
    PassSlot(3, 18, 0),
    PassSlot(4, 14, 0),
)
_DAYS_SCANNED: Final = 8

_GAMES: Final = """
select game_id, away_team, home_team, kickoff_at from research.nflverse_games
where season = :s and week = :w and game_type = :game_type
order by kickoff_at nulls last, game_id
"""

_RESULTS: Final = """
select team, min(as_of) as dated from research.team_week_observations
where season = :s and week = :w and source = :source and metric = :metric
group by team
"""


@dataclass(frozen=True, slots=True)
class WeekState:
    """The week's last kickoff and every game the store does not hold whole as of the pass: each named
    with what it lacks (`incomplete`), the ids of those with a club holding no final (`unresulted`, the
    games a void may be the fix for), and the games voided as of the pass, which are not checked."""

    last_kickoff: datetime
    games: int
    incomplete: tuple[str, ...]
    unresulted: tuple[str, ...] = ()
    voided: tuple[str, ...] = ()


def _club_lacks(club: str, results: dict[str, datetime], lined: set[str], now: datetime) -> list[str]:
    dated = results.get(club)
    lacks = []
    if dated is None:
        lacks.append(f"{club} no final")
    elif dated > now:
        lacks.append(f"{club} result dated {js_iso(dated)}")
    if club not in lined:
        lacks.append(f"{club} no stat lines")
    return lacks


def _lined_clubs(conn: Connection, season: int, week: int, now: datetime) -> set[str]:
    holders = {line.line.player_id for line in stat_lines_as_of(conn, ObservationQuery(season, week, now))}
    return {edge.team for edge in player_teams_as_of(conn, season, week, now) if edge.player_id in holders}


def week_state(conn: Connection, season: int, week: int, now: datetime) -> WeekState | None:
    """The week's games as the game table lists them, each club checked as of `now`; None when the
    table holds no game of the week with a kickoff."""
    params = {"s": season, "w": week}
    games = list(conn.execute(text(_GAMES), {**params, "game_type": SEASON_TYPE}))
    kickoffs = [ms_instant(game.kickoff_at) for game in games if game.kickoff_at is not None]
    if not kickoffs:
        return None
    voids = voids_in_week(conn, season, week, now)
    # A voided game's stale kickoff never moves the floor or the overdue clock (Lane 249 review L1); a
    # week with no kickoff left outside its voids keeps the last of them all.
    counted = [ms_instant(g.kickoff_at) for g in games if g.kickoff_at is not None and g.game_id not in voids]
    last_kickoff = max(counted or kickoffs)
    result_params = {**params, "source": ScheduleSource.KICKOFF, "metric": ScheduleMetric.GAME_RESULT}
    results = {row.team: ms_instant(row.dated) for row in conn.execute(text(_RESULTS), result_params)}
    lined = _lined_clubs(conn, season, week, now)
    incomplete, unresulted, voided = [], [], []
    for game in games:
        label = f"{game.away_team} at {game.home_team}"
        if game.game_id in voids:
            void = voids[game.game_id]
            # Debug: every nightly reads each played week's state for the draft record, and the grade
            # step names the voided games in its own detail line (Lane 250 review L3).
            LOG.debug(
                "week %s of %s: %s (%s) is voided, not checked: %s", week, season, label, game.game_id, void.reason
            )
            voided.append(f"{label} ({game.game_id})")
            continue
        lacks = [*_club_lacks(game.away_team, results, lined, now), *_club_lacks(game.home_team, results, lined, now)]
        if lacks:
            incomplete.append(f"{label} ({', '.join(lacks)})")
        if game.away_team not in results or game.home_team not in results:
            unresulted.append(game.game_id)
    return WeekState(last_kickoff, len(games), tuple(incomplete), tuple(unresulted), tuple(voided))


def is_complete(state: WeekState | None, now: datetime) -> bool:
    """The grade's rule for a whole week as of `now`: games on file, none lacking a final or a club's
    lines, and the last kickoff `GRADE_FLOOR` behind. The grade step says why a week waits; the draft
    record counts a week by this alone (Lane 250, B254)."""
    return state is not None and not state.incomplete and now >= state.last_kickoff + GRADE_FLOOR


def earliest_grade(last_kickoff: datetime) -> datetime:
    """The first instant a week can be complete: its lines are dated from its last game, the end of
    that game's Eastern day plus `PUBLICATION_LAG_HOURS` (`kickoff_as_of`), never sooner than
    `GRADE_FLOOR`. A Monday night week's is Tuesday 20:00 Eastern."""
    gameday = last_kickoff.astimezone(EASTERN).date().isoformat()
    return max(last_kickoff + GRADE_FLOOR, kickoff_as_of(gameday, PUBLICATION_LAG_HOURS))


def _slots_on(day: date) -> list[datetime]:
    cron_weekday = (day.weekday() + 1) % 7
    return [
        datetime.combine(day, time(slot.hour, slot.minute), EASTERN)
        for slot in GRADING_PASSES
        if slot.cron_weekday == cron_weekday
    ]


def first_pass_at_or_after(at: datetime) -> datetime:
    """The first `GRADING_PASSES` slot at or after an instant, in UTC."""
    start = at.astimezone(EASTERN).date()
    for offset in range(_DAYS_SCANNED):
        slots = [slot for slot in _slots_on(start + timedelta(days=offset)) if slot >= at]
        if slots:
            return min(slots).astimezone(at.tzinfo)
    raise ValueError(f"no grading pass within {_DAYS_SCANNED} days of {js_iso(at)}")


def grades_from(last_kickoff: datetime) -> datetime:
    """The pass a week ending at this kickoff grades on when its stats are in on time: the first pass
    at or after `earliest_grade`. A Monday night week reads Tuesday 20:30, a Sunday-ending week the
    Tuesday 08:00 pass (no pass runs on a Monday)."""
    return first_pass_at_or_after(earliest_grade(last_kickoff))
