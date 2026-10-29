"""THE WEEK'S USAGE READS (Lane 300): every player's week-by-week usage this season, for the angles (`angles`).

One read of the stored facts at or before the instant, the newest statement of each (week, player, fact):
- his offensive snaps and his club's, his targets and his club's, his carries and his club's (the snap
  counts and the weekly stat lines, nflverse);
- his air yards, the targets they were taken over, and his red-zone and inside-the-ten carries and targets
  (the play-by-play), each against his club's own total that week, summed over every player the store
  places on the club that week (`player_week_teams`), as the season capsules sum them
  (`facts.season_usage_reads`);
- his rushing and receiving touchdowns (the weekly stat lines).

And one read of the depth chart's releases (`depth_changes`): whether his slot on the newest release differs
from the release before it, so a move reaches the writer only when it is new (`bites`).

A week he has no snap and no touch in is no week of his. Nothing is estimated: a fact the store does not
hold is None, and an angle that needs it is left out.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Final

from sqlalchemy import Connection, text

from research.model.reads.observations import LAST_POSSIBLE_WEEK, WeekRange
from research.model.reads.teams import player_teams_as_of
from research.pipeline.nflverse.participation import NflverseSource, ParticipationMetric
from research.pipeline.nflverse.pbp import PBP_PLAYER_SOURCE, PbpPlayerMetric
from research.pipeline.nflverse.team_codes import product_team_code
from research.pipeline.preseason.rosters import DEPTH_METRIC, DEPTH_SOURCE

_SNAPS: Final = (NflverseSource.SNAP_COUNTS, ParticipationMetric.OFFENSIVE_SNAPS)
_TEAM_SNAPS: Final = (NflverseSource.SNAP_COUNTS, ParticipationMetric.TEAM_OFFENSIVE_SNAPS)
_TARGETS: Final = (NflverseSource.PLAYER_WEEK, ParticipationMetric.TARGETS)
_TEAM_TARGETS: Final = (NflverseSource.PLAYER_WEEK, ParticipationMetric.TEAM_TARGETS)
_CARRIES: Final = (NflverseSource.PLAYER_WEEK, ParticipationMetric.CARRIES)
_TEAM_CARRIES: Final = (NflverseSource.PLAYER_WEEK, ParticipationMetric.TEAM_CARRIES)
_AIR_YARDS: Final = (PBP_PLAYER_SOURCE, PbpPlayerMetric.AIR_YARDS)
_AIR_YARD_TARGETS: Final = (PBP_PLAYER_SOURCE, PbpPlayerMetric.AIR_YARD_TARGETS)
_PBP_TOUCHES: Final = ((PBP_PLAYER_SOURCE, PbpPlayerMetric.CARRIES), (PBP_PLAYER_SOURCE, PbpPlayerMetric.TARGETS))
_RED_ZONE: Final = (
    (PBP_PLAYER_SOURCE, PbpPlayerMetric.RED_ZONE_CARRIES),
    (PBP_PLAYER_SOURCE, PbpPlayerMetric.RED_ZONE_TARGETS),
)
_INSIDE_TEN: Final = (
    (PBP_PLAYER_SOURCE, PbpPlayerMetric.INSIDE_TEN_CARRIES),
    (PBP_PLAYER_SOURCE, PbpPlayerMetric.INSIDE_TEN_TARGETS),
)
_TOUCHDOWNS: Final = (
    (NflverseSource.PLAYER_WEEK, "rushing_touchdowns"),
    (NflverseSource.PLAYER_WEEK, "receiving_touchdowns"),
)
_ALL: Final = (
    _SNAPS,
    _TEAM_SNAPS,
    _TARGETS,
    _TEAM_TARGETS,
    _CARRIES,
    _TEAM_CARRIES,
    _AIR_YARDS,
    _AIR_YARD_TARGETS,
    *_PBP_TOUCHES,
    *_RED_ZONE,
    *_INSIDE_TEN,
    *_TOUCHDOWNS,
)
# The play-by-play counts a club's week is summed from, player by player.
_SUMMED: Final = (_AIR_YARDS, *_RED_ZONE, *_INSIDE_TEN)
_READ: Final = text(
    "select distinct on (week, player_id, source, metric) week, player_id, source, metric, value "
    "from research.player_week_observations where season = :season and week >= 1 and week <= :last "
    "and as_of <= :as_of and source = any(:sources) and metric = any(:metrics) "
    "order by week, player_id, source, metric, as_of desc"
)
_DEPTH_RELEASES: Final = text(
    "select player_id, value, as_of from research.player_week_observations where season = :season "
    "and source = :source and metric = :metric and as_of <= :as_of order by player_id, as_of desc"
)

Fact = tuple[str, str]


@dataclass(frozen=True, slots=True)
class UsageWeek:
    """One week of his: his club that week (the product's code) and each count, his and his club's, None where
    the store holds none."""

    week: int
    team: str | None
    snaps: float | None
    team_snaps: float | None
    targets: float | None
    team_targets: float | None
    carries: float | None
    team_carries: float | None
    air_yards: float | None
    team_air_yards: float | None
    air_yard_targets: float | None
    red_zone: float | None
    team_red_zone: float | None
    inside_ten: float | None
    team_inside_ten: float | None
    touchdowns: float | None


def _facts(conn: Connection, season: int, as_of: datetime) -> dict[tuple[str, int], dict[Fact, float]]:
    rows = conn.execute(
        _READ,
        {
            "season": season,
            "last": LAST_POSSIBLE_WEEK,
            "as_of": as_of,
            "sources": sorted({source for source, _ in _ALL}),
            "metrics": sorted({metric for _, metric in _ALL}),
        },
    )
    wanted = set(_ALL)
    out: dict[tuple[str, int], dict[Fact, float]] = {}
    for row in rows:
        fact = (str(row.source), str(row.metric))
        if fact in wanted:
            out.setdefault((str(row.player_id), int(row.week)), {})[fact] = float(row.value)
    return out


def _sum(own: Mapping[Fact, float], facts: Sequence[Fact]) -> float | None:
    values = [own.get(fact) for fact in facts]
    return None if all(v is None for v in values) else sum(v for v in values if v is not None)


def _played(own: Mapping[Fact, float]) -> bool:
    """An offensive snap or a play-by-play touch that week."""
    return own.get(_SNAPS, 0.0) > 0 or (_sum(own, _PBP_TOUCHES) or 0.0) > 0


def _club_totals(
    facts: Mapping[tuple[str, int], Mapping[Fact, float]], team_of: Mapping[tuple[str, int], str]
) -> dict[tuple[str, int], dict[Fact, float]]:
    totals: dict[tuple[str, int], dict[Fact, float]] = {}
    for key, own in facts.items():
        team = team_of.get(key)
        if team is None:
            continue
        held = totals.setdefault((team, key[1]), {})
        for fact in _SUMMED:
            if fact in own:
                held[fact] = held.get(fact, 0.0) + own[fact]
    return totals


def _week(week: int, team: str | None, own: Mapping[Fact, float], club: Mapping[Fact, float]) -> UsageWeek:
    # A play-by-play count he has none of in a week he played is a zero: his club's week still counts.
    def mine(facts: Sequence[Fact]) -> float | None:
        return _sum(own, facts) if any(f in own for f in facts) else (0.0 if club else None)

    return UsageWeek(
        week=week,
        team=None if team is None else product_team_code(team),
        snaps=own.get(_SNAPS),
        team_snaps=own.get(_TEAM_SNAPS),
        targets=own.get(_TARGETS),
        team_targets=own.get(_TEAM_TARGETS),
        carries=own.get(_CARRIES),
        team_carries=own.get(_TEAM_CARRIES),
        air_yards=mine((_AIR_YARDS,)),
        team_air_yards=club.get(_AIR_YARDS),
        air_yard_targets=own.get(_AIR_YARD_TARGETS),
        red_zone=mine(_RED_ZONE),
        team_red_zone=_sum(club, _RED_ZONE),
        inside_ten=mine(_INSIDE_TEN),
        team_inside_ten=_sum(club, _INSIDE_TEN),
        touchdowns=_sum(own, _TOUCHDOWNS),
    )


def usage_by_player(conn: Connection, season: int, as_of: datetime) -> dict[str, tuple[UsageWeek, ...]]:
    """Every player's weeks this season by universe id, oldest first: only the weeks he played."""
    facts = _facts(conn, season, as_of)
    if not facts:
        return {}
    team_of = {
        (t.player_id, t.week): t.team for t in player_teams_as_of(conn, season, WeekRange(1, LAST_POSSIBLE_WEEK), as_of)
    }
    clubs = _club_totals(facts, team_of)
    out: dict[str, list[UsageWeek]] = {}
    for (player, week), own in sorted(facts.items()):
        if _played(own):
            team = team_of.get((player, week))
            club = clubs.get((team, week), {}) if team is not None else {}
            out.setdefault(player, []).append(_week(week, team, own, club))
    return {player: tuple(weeks) for player, weeks in out.items()}


def depth_changes(conn: Connection, season: int, as_of: datetime) -> dict[str, tuple[float, datetime]]:
    """Each player whose slot on the newest depth-chart release by `as_of` differs from the release before it:
    his slot before, and the newest release's stamp. A player on one release only has no change."""
    rows = conn.execute(
        _DEPTH_RELEASES, {"season": season, "source": DEPTH_SOURCE, "metric": DEPTH_METRIC, "as_of": as_of}
    )
    releases: dict[str, list[tuple[float, datetime]]] = {}
    for row in rows:
        releases.setdefault(str(row.player_id), []).append((float(row.value), row.as_of))
    return {
        player: (held[1][0], held[0][1])
        for player, held in releases.items()
        if len(held) > 1 and held[0][0] != held[1][0]
    }
