"""EVERY READ OF THE SUB-ROUND, BEHIND ONE SEASON REFUSAL (Amendment 7 items 3 and 10, KD6; B132 L4).

Three kinds of read, each through `KdefReader`, which refuses a closed season before any statement runs
(2025 and the pristine 2026 for the judgment; 2024 on as well for the development check) and keeps the
seasons it served on its ledger, which KD6 reads:

- **inputs at t_g** (`season_inputs`): the kicking and team-defense weeks of weeks before W at their
  Wednesday passes, the kick plays and the plays (the passers' dropbacks) of weeks before W at their
  per-game stamps, the week-W depth chart and filings, and the season before read once at the season's
  first instant, every read through the input rule's
  recording wrapper (`kdef_weeks`, `admit_read`), so a week-W row is refused with `InputRuleError`;
- **outcomes** (`season_outcomes`): a season's week-W kicking and defense rows and its kick plays, the
  targets the fit seasons fit on and the realised points the judged weeks are graded on, never an input;
- **the benchmark** (`espn_archive`): ESPN's archived weekly projection of a judged season, never an input.

Under the reader the connection itself refuses any statement binding a closed season (round 2's
`guard_queries`), so a read that slipped past the reader would still be refused.
"""

from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from types import MappingProxyType
from typing import Any, Final

from sqlalchemy import Connection, text

from research.errors import ResearchError
from research.model.reads.observations import ObservationQuery, observations_as_of
from research.model.ros.outcomes import PRISTINE_SEASON
from research.model.weekly2.designation import WITHHELD, status_of_filing
from research.model.weekly3.instant import read_schedule
from research.model.weekly3.ledger import Stamp, admit
from research.model.weekly4.features import kdef_weeks
from research.model.weekly4.features.admitted import DEFENSE_SELECTED, KICK_SELECTED, KICKING_SELECTED
from research.model.weekly4.features.charted import week_passes
from research.model.weekly4.features.depth import DepthRule
from research.model.weekly4.features.kdef_weeks import DEFENSE_READ, KICK_PLAY_FILTER, KICKING_READ, StampedRow
from research.model.weekly_kdef.scrimmage import PlayView, SeasonPlays, plays_at, read_season_plays
from research.pipeline.nflverse.injury_reports import INJURY_SOURCE, InjuryMetric
from research.pipeline.nflverse.team_eras import season_code

FROZEN: Final = MappingProxyType
LAST_WEEK: Final = 17  # the regular-season weeks the sub-round fits and judges (design 6.1)
OUTCOME_DEFENSE: Final = (
    f"select {', '.join(DEFENSE_SELECTED)} from research.nflverse_team_defense_weeks "
    "where season = :season and week <= :last_week order by week, team"
)
OUTCOME_KICKING: Final = (
    f"select {', '.join(KICKING_SELECTED)} from research.nflverse_kicking_weeks "
    "where season = :season and week <= :last_week order by week, player_id"
)
OUTCOME_KICKS: Final = (
    f"select {', '.join(c for c in KICK_SELECTED if c != 'as_of')} from research.nflverse_pbp_plays "
    f"where season = :season and week <= :last_week and ({KICK_PLAY_FILTER}) order by week, game_id, play_id"
)
ESPN_ARCHIVE: Final = (
    "select distinct on (week, espn_id) season, week, espn_id, position, applied_total, stats "
    "from research.espn_kdef_archive_rows where season = :season order by week, espn_id, read_at desc"
)
ESPN_IDS: Final = "select id, espn_id from research.players where espn_id is not null"
_CLUBS: Final = FROZEN(
    {
        "nflverse_team_defense_weeks": ("team", "opponent_team"),
        "nflverse_kicking_weeks": ("team",),
        "nflverse_pbp_plays": ("posteam", "defteam", "td_team", "return_team"),
    }
)


class ClosedSeasonReadError(ResearchError):
    """A read of a season the run may not read."""


@dataclass(frozen=True, slots=True)
class KdefReader:
    """The one reader: `closed` refused, `served` the ledger of (read, season) it served."""

    closed: frozenset[int]
    served: tuple[tuple[str, int], ...] = ()

    def admit(self, read: str, season: int) -> "KdefReader":
        if season in self.closed or season >= PRISTINE_SEASON:
            raise ClosedSeasonReadError(f"the {read} read of {season} is refused: the run may not read {season}")
        return KdefReader(self.closed, (*self.served, (read, season)))

    def seasons(self, read: str) -> tuple[int, ...]:
        return tuple(sorted({s for name, s in self.served if name == read}))


def closed_after(last_season: int) -> frozenset[int]:
    """Every season after `last_season` through the pristine one."""
    return frozenset(range(last_season + 1, PRISTINE_SEASON + 1))


@dataclass(frozen=True, slots=True)
class MomentInputs:
    """What one instant of one week reads: rows of weeks before W, and the week-W filings."""

    kicking: tuple[StampedRow, ...]
    defense: tuple[StampedRow, ...]
    kicks: tuple[StampedRow, ...]
    withheld: frozenset[str]  # players whose week-W filing at t_g is Out or Doubtful
    filed: Mapping[str, datetime]  # players with a week-W filing at t_g that is not: its stamp
    plays: PlayView  # the passer, yards per play and fourth-down terms of every club


@dataclass(frozen=True, slots=True)
class SeasonInputs:
    season: int
    prior_kicking: tuple[StampedRow, ...]
    prior_defense: tuple[StampedRow, ...]
    prior_kicks: tuple[StampedRow, ...]
    moments: Mapping[tuple[int, datetime], MomentInputs]
    stamps: tuple[Stamp, ...]


def _filings(
    conn: Connection, season: int, week: int, moment: datetime
) -> tuple[frozenset[str], dict[str, datetime], Stamp]:
    filings = observations_as_of(
        conn, ObservationQuery(season, week, moment, INJURY_SOURCE, metrics=(InjuryMetric.REPORT_STATUS,))
    )
    stamp = admit(filings, season, week, moment, "filings")
    withheld = frozenset(r.player_id for r in filings if status_of_filing(r.value) == WITHHELD)
    filed = {r.player_id: r.as_of for r in filings if r.player_id not in withheld}
    return withheld, filed, stamp


def _moment(  # noqa: PLR0913, PLR0917 - one instant's reads, named
    conn: Connection, season: int, week: int, moment: datetime, passes: Mapping[int, datetime], plays: SeasonPlays
) -> tuple[MomentInputs, list[Stamp]]:
    kicking, k = kdef_weeks.kicking_weeks_at(conn, season, week, moment, passes)
    defense, d = kdef_weeks.defense_weeks_at(conn, season, week, moment, passes)
    kicks, p = kdef_weeks.kicks_at(conn, season, week, moment)
    withheld, filed, f = _filings(conn, season, week, moment)
    view = plays_at(plays, week, moment, withheld)
    found = MomentInputs(tuple(kicking), tuple(defense), tuple(kicks), withheld, FROZEN(filed), view)
    return found, [k, d, p, f, *view.stamps]


def season_inputs(
    conn: Connection, reader: KdefReader, season: int, moments: Sequence[tuple[int, datetime]], rule: DepthRule
) -> tuple[SeasonInputs, KdefReader]:
    """The season's inputs at each (week, t_g), and the season before read once at the first t_g. `rule`
    is the coordinator's recorded depth chart rule (round 4 section 5 item 6)."""
    reader = reader.admit("inputs", season).admit("inputs", season - 1)
    passes = week_passes(read_schedule(conn, season))
    prior_passes = week_passes(read_schedule(conn, season - 1))
    first = min(m for _, m in moments)
    prior_kicking, pk = kdef_weeks.prior_week_table_at(conn, KICKING_READ, season, first, prior_passes)
    prior_defense, pd_ = kdef_weeks.prior_week_table_at(conn, DEFENSE_READ, season, first, prior_passes)
    prior_kicks, pp = kdef_weeks.prior_kicks_at(conn, season, first)
    last = max(m for _, m in moments)
    plays, pl = read_season_plays(conn, season, first, last, max(w for w, _ in moments), rule)
    stamps: list[Stamp] = [pk, pd_, pp, pl]
    found: dict[tuple[int, datetime], MomentInputs] = {}
    for week, moment in sorted(set(moments)):
        found[(week, moment)], read = _moment(conn, season, week, moment, passes, plays)
        stamps += read
    inputs = SeasonInputs(
        season, tuple(prior_kicking), tuple(prior_defense), tuple(prior_kicks), FROZEN(found), tuple(stamps)
    )
    return inputs, reader


def _spelled(table: str, season: int, row: Mapping[str, Any]) -> dict[str, Any]:
    values = dict(row)
    for column in _CLUBS[table]:
        if values.get(column) is not None:
            values[column] = season_code(season, values[column])
    return values


@dataclass(frozen=True, slots=True)
class SeasonOutcomes:
    season: int
    defense: tuple[Mapping[str, Any], ...]
    kicking: tuple[Mapping[str, Any], ...]
    kicks: tuple[Mapping[str, Any], ...]


def season_outcomes(conn: Connection, reader: KdefReader, season: int) -> tuple[SeasonOutcomes, KdefReader]:
    """A season's week rows and kick plays through week 17, as outcomes (never an input)."""
    reader = reader.admit("outcomes", season)
    params = {"season": season, "last_week": LAST_WEEK}
    tables = (
        ("nflverse_team_defense_weeks", OUTCOME_DEFENSE),
        ("nflverse_kicking_weeks", OUTCOME_KICKING),
        ("nflverse_pbp_plays", OUTCOME_KICKS),
    )
    read = [
        tuple(FROZEN(_spelled(table, season, dict(r))) for r in conn.execute(text(query), params).mappings())
        for table, query in tables
    ]
    return SeasonOutcomes(season, read[0], read[1], read[2]), reader


@dataclass(frozen=True, slots=True)
class ArchivedRow:
    week: int
    espn_id: str
    position: str
    applied_total: float
    stats: Mapping[str, float]


def espn_archive(conn: Connection, reader: KdefReader, season: int) -> tuple[tuple[ArchivedRow, ...], KdefReader]:
    """ESPN's archived weekly K and D/ST projection of a judged season, its newest read of each row."""
    reader = reader.admit("espn", season)
    rows = tuple(
        ArchivedRow(int(r.week), str(r.espn_id), str(r.position), float(r.applied_total), FROZEN(dict(r.stats)))
        for r in conn.execute(text(ESPN_ARCHIVE), {"season": season})
    )
    return rows, reader


def espn_players(conn: Connection) -> Mapping[str, str]:
    """ESPN's id -> the universe's id (a kicker's, or `team-def:<club>` for a D/ST), the crosswalk."""
    found: dict[str, list[str]] = defaultdict(list)
    for r in conn.execute(text(ESPN_IDS)):
        found[str(r.espn_id)].append(str(r.id))
    return FROZEN({espn: ids[0] for espn, ids in found.items() if len(ids) == 1})
