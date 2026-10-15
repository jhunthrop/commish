"""THE INSTANT AND THE SCHEDULE KNOWLEDGE: each game's t_g, its home field and its pairing.

Preregistration section 3: for a player on club c in week W, t_g is the `as_of` of c's week-W
`kickoff_instant` row (`nflverse_kickoff`, stamped at the kickoff itself) minus one millisecond.
Three schedule facts for week W are read as schedule knowledge, not as stamped observations
(section 2, "The input rule"): the kickoff row, the `home_field` row (stamped at the schedule's
release) and the pairing. The pairing is `nflverse_team_defense_weeks` read for its four pairing
columns only (`PAIRING_QUERY`, held by a guard test); G5 exempts all three by name.
"""

import bisect
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from types import MappingProxyType
from typing import Final

from sqlalchemy import Connection, text

from research.model.instants import ms_instant
from research.pipeline.nflverse.schedule import ScheduleMetric, ScheduleSource

ONE_MS: Final = timedelta(milliseconds=1)
PAIRING_COLUMNS: Final = ("season", "week", "team", "opponent_team")
PAIRING_QUERY: Final = (
    "select season, week, team, opponent_team from research.nflverse_team_defense_weeks where season = :season"
)
_SCHEDULE_ROWS: Final = text(
    "select week, team, as_of, value from research.team_week_observations "
    "where season = :season and source = :source and metric = :metric"
)

ClubWeek = tuple[int, str]  # (week, club)


def game_instant(kickoff: datetime) -> datetime:
    """t_g: one millisecond before the game's own kickoff."""
    return kickoff - ONE_MS


@dataclass(frozen=True, slots=True)
class Schedule:
    """One season's kickoffs, home field and pairing, by (week, club)."""

    season: int
    kickoffs: Mapping[ClubWeek, datetime]
    home_field: Mapping[ClubWeek, float]
    pairing: Mapping[ClubWeek, str]

    def instant(self, week: int, club: str | None) -> datetime | None:
        kickoff = None if club is None else self.kickoffs.get((week, club))
        return None if kickoff is None else game_instant(kickoff)

    def moments(self, week: int) -> tuple[datetime, ...]:
        """Every distinct instant of the week (one per kickoff slot), earliest first."""
        return tuple(sorted({game_instant(k) for (w, _), k in self.kickoffs.items() if w == week}))

    def first_moment(self, week: int) -> datetime:
        return self.moments(week)[0]

    def opponent(self, week: int, club: str) -> str | None:
        return self.pairing.get((week, club))

    def home(self, week: int, club: str) -> float | None:
        return self.home_field.get((week, club))

    def club_weeks(self, club: str, before: int) -> tuple[int, ...]:
        """The weeks before `before` in which the club played, from the pairing, in order."""
        weeks = sorted(w for (w, c) in self.pairing if c == club)
        return tuple(weeks[: bisect.bisect_left(weeks, before)])


def _rows(conn: Connection, season: int, source: str, metric: str) -> list[tuple[int, str, datetime, float]]:
    found = conn.execute(_SCHEDULE_ROWS, {"season": season, "source": source, "metric": metric})
    return [(int(r.week), str(r.team), ms_instant(r.as_of), float(r.value)) for r in found]


def read_schedule(conn: Connection, season: int) -> Schedule:
    """The season's kickoff and home-field rows and its pairing (schedule knowledge, exempt from the
    input rule by name: section 5, G5)."""
    kickoffs = {
        (w, c): as_of for w, c, as_of, _ in _rows(conn, season, ScheduleSource.KICKOFF, ScheduleMetric.KICKOFF_INSTANT)
    }
    home = {(w, c): value for w, c, _, value in _rows(conn, season, ScheduleSource.SCHEDULE, ScheduleMetric.HOME_FIELD)}
    pairing = {
        (int(r.week), str(r.team)): str(r.opponent_team) for r in conn.execute(text(PAIRING_QUERY), {"season": season})
    }
    return Schedule(season, MappingProxyType(kickoffs), MappingProxyType(home), MappingProxyType(pairing))
