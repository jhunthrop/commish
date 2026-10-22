"""THE KICKING AND TEAM-DEFENSE WEEKS AND THE KICK PLAYS, AS THE INPUT RULE ADMITS THEM (Amendment 7
item 3 of the round 4 preregistration; Lane 156).

Three read kinds, each selecting exactly its admitted pairs (`admitted.py`) and passed through the
recording wrapper (`admit_read`), so a week-W row of any of them is refused with `InputRuleError`:

- `kicking`: a kicker's week (`nflverse_kicking_weeks`), field goals made and missed by distance and
  extra points, of weeks before W;
- `team_defense`: a defense's week (`nflverse_team_defense_weeks`), its sacks, takeaways, touchdowns,
  safeties, blocks, the yards it allowed and the points it allowed, of weeks before W;
- `kicks`: the play table's kick columns (revision 0020) of weeks before W, stamped per game as item 7
  stamps the plays.

THE STAMPS (item 3a). The two week tables hold the current state of each week, rewritten when nflverse
restates it, with no instant of their own. In replay a week's rows are stamped at the in-season pass of
the Wednesday 18:00 New York after the week's last game, as item 8 stamps NGS and PFR (`charted.py`,
`week_passes`), whatever was stored: a week whose pass is after t_g is not yet read, and a week with no
kickoff is refused. Live, the same facts are read where the in-season pass wrote them, the
`nflverse_kdef_week` stat lines, at their stored stamp (`live_kicking_lines`, `live_defense_lines`).

Clubs are spelled as the season spelled them (`team_eras.season_code`), as `reads.py` spells the plays.
"""

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from types import MappingProxyType
from typing import Any, Final

from sqlalchemy import Connection, text

from research.model.instants import ms_instant
from research.model.weekly3.ledger import InputRuleError, ReadKind, Stamp
from research.model.weekly4.features.admitted import (
    DEFENSE_SELECTED,
    DEFENSE_WEEKS,
    KICK_SELECTED,
    KICKING_SELECTED,
    KICKING_WEEKS,
    LIVE_DEFENSE_METRICS,
    LIVE_KICKING_METRICS,
    PLAYS,
    Pair,
    admit_observations,
    admit_read,
)
from research.pipeline.nflverse.kdef_lines import KDEF_LINE_SOURCE
from research.pipeline.nflverse.pbp_plays import KICK_COLUMNS
from research.pipeline.nflverse.team_eras import season_code
from research.pipeline.observations import PlayerWeekObservation

# The club columns of each read, respelled to the season's code.
_CLUB_COLUMNS: Final[Mapping[str, tuple[str, ...]]] = MappingProxyType(
    {
        KICKING_WEEKS: ("team",),
        DEFENSE_WEEKS: ("team", "opponent_team"),
        PLAYS: ("posteam", "defteam", "td_team", "return_team"),
    }
)
_ANY_KICK: Final = " or ".join(f"{column} is not null" for column in KICK_COLUMNS)

KICKING_QUERY: Final = (
    f"select {', '.join(KICKING_SELECTED)} from research.{KICKING_WEEKS} "
    "where season = :season and week < :week order by week, player_id"
)
DEFENSE_QUERY: Final = (
    f"select {', '.join(DEFENSE_SELECTED)} from research.{DEFENSE_WEEKS} "
    "where season = :season and week < :week order by week, team"
)
KICKS_QUERY: Final = (
    f"select {', '.join(KICK_SELECTED)} from research.{PLAYS} "
    f"where season = :season and week < :week and as_of <= :moment and ({_ANY_KICK}) "
    "order by week, game_id, play_id"
)
# The newest stored version of each live line of weeks before W at or before t_g.
LIVE_LINES_QUERY: Final = (
    "select distinct on (week, player_id, metric) season, week, player_id, source, metric, value, as_of "
    "from research.player_week_observations where season = :season and week < :week and as_of <= :moment "
    "and source = :source and metric = any(:metrics) "
    "order by week asc, player_id asc, metric asc, as_of desc"
)


@dataclass(frozen=True, slots=True)
class WeekRow:
    """One stored row of a week table, before the pass stamps it: its values by selected column."""

    table: str
    season: int
    week: int
    values: Mapping[str, Any]


@dataclass(frozen=True, slots=True)
class StampedRow:
    """One row of a week table or of the play table: its season, week and admitted stamp, and its values
    by column (the selected columns only)."""

    table: str
    season: int
    week: int
    as_of: datetime
    values: Mapping[str, Any]


def _respelled(table: str, season: int, values: dict[str, Any]) -> dict[str, Any]:
    for column in _CLUB_COLUMNS[table]:
        if values.get(column) is not None:
            values[column] = season_code(season, values[column])
    return values


def restamp_weeks(rows: Iterable[WeekRow], passes: Mapping[int, datetime], moment: datetime) -> list[StampedRow]:
    """Each week-table row stamped at its week's Wednesday pass (item 3a), kept if that pass is at or
    before t_g; a week with no kickoff has no pass and is refused."""
    found = list(rows)
    missing = sorted({row.week for row in found} - set(passes))
    if missing:
        raise InputRuleError(
            f"kicking or defense rows of weeks {missing} have no kickoff, so no Wednesday pass admits them"
        )
    stamped = [StampedRow(row.table, row.season, row.week, passes[row.week], row.values) for row in found]
    return [row for row in stamped if row.as_of <= moment]


def _pairs(table: str, columns: Sequence[str]) -> list[Pair]:
    return [(table, column) for column in columns]


@dataclass(frozen=True, slots=True)
class WeekTable:
    kind: ReadKind
    table: str
    query: str
    columns: tuple[str, ...]


KICKING_READ: Final = WeekTable("kicking", KICKING_WEEKS, KICKING_QUERY, KICKING_SELECTED)
DEFENSE_READ: Final = WeekTable("team_defense", DEFENSE_WEEKS, DEFENSE_QUERY, DEFENSE_SELECTED)


def _week_table(conn: Connection, read: WeekTable, season: int, week: int) -> list[WeekRow]:
    """A week table's rows of weeks before W, as stored."""
    return [
        WeekRow(
            read.table,
            int(row["season"]),
            int(row["week"]),
            _respelled(read.table, season, {c: row[c] for c in read.columns}),
        )
        for row in conn.execute(text(read.query), {"season": season, "week": week}).mappings()
    ]


def week_table_at(  # noqa: PLR0913, PLR0917 - a read's every coordinate, named
    conn: Connection, read: WeekTable, season: int, week: int, moment: datetime, passes: Mapping[int, datetime]
) -> tuple[list[StampedRow], Stamp]:
    """Replay: a week table's rows of the season before W, each at its Wednesday pass, as read at t_g."""
    rows = restamp_weeks(_week_table(conn, read, season, week), passes, moment)
    return rows, admit_read(read.kind, _pairs(read.table, read.columns), rows, season, week, moment)


def kicking_weeks_at(
    conn: Connection, season: int, week: int, moment: datetime, passes: Mapping[int, datetime]
) -> tuple[list[StampedRow], Stamp]:
    """Replay: the kickers' weeks before W (field goals by distance, extra points)."""
    return week_table_at(conn, KICKING_READ, season, week, moment, passes)


def defense_weeks_at(
    conn: Connection, season: int, week: int, moment: datetime, passes: Mapping[int, datetime]
) -> tuple[list[StampedRow], Stamp]:
    """Replay: the defenses' weeks before W, points allowed among them."""
    return week_table_at(conn, DEFENSE_READ, season, week, moment, passes)


def kicks_at(conn: Connection, season: int, week: int, moment: datetime) -> tuple[list[StampedRow], Stamp]:
    """The season's kick plays (any kick column set) of weeks before W stamped at or before t_g."""
    rows: list[StampedRow] = []
    params = {"season": season, "week": week, "moment": moment}
    for found in conn.execute(text(KICKS_QUERY), params).mappings():
        values = _respelled(PLAYS, season, {column: found[column] for column in KICK_SELECTED})
        values["as_of"] = ms_instant(values["as_of"])
        rows.append(StampedRow(PLAYS, int(found["season"]), int(found["week"]), values["as_of"], values))
    return rows, admit_read("kicks", _pairs(PLAYS, KICK_SELECTED), rows, season, week, moment)


def _live_lines(  # noqa: PLR0913, PLR0917 - a read's every coordinate, named
    conn: Connection,
    kind: ReadKind,
    metrics: Sequence[str],
    season: int,
    week: int,
    moment: datetime,
) -> tuple[list[PlayerWeekObservation], Stamp]:
    params = {"season": season, "week": week, "moment": moment, "source": KDEF_LINE_SOURCE, "metrics": list(metrics)}
    rows = [
        PlayerWeekObservation(r[0], r[1], r[2], r[3], r[4], float(r[5]), ms_instant(r[6]))
        for r in conn.execute(text(LIVE_LINES_QUERY), params)
    ]
    return rows, admit_observations(kind, rows, season, week, moment)


def live_kicking_lines(
    conn: Connection, season: int, week: int, moment: datetime
) -> tuple[list[PlayerWeekObservation], Stamp]:
    """Live: the kickers' `nflverse_kdef_week` lines of weeks before W at their stored stamp."""
    return _live_lines(conn, "kicking", LIVE_KICKING_METRICS, season, week, moment)


def live_defense_lines(
    conn: Connection, season: int, week: int, moment: datetime
) -> tuple[list[PlayerWeekObservation], Stamp]:
    """Live: the defenses' `nflverse_kdef_week` lines of weeks before W, points allowed among them."""
    return _live_lines(conn, "team_defense", LIVE_DEFENSE_METRICS, season, week, moment)
