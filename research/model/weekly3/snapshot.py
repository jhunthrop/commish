"""WHAT ONE INSTANT SEES: the covered reads for every game of a week that kicks off at t_g + 1 ms.

Preregistration section 2, "The input rule", and section 3: at t_g each read takes the rows of
weeks before W stamped at or before t_g (`observations_as_of`, `team_observations_as_of`,
`player_teams_as_of`, the as-of reads rounds 1 and 2 use, with a week bound of W - 1), and the
filings of week W stamped at or before t_g. Every read goes through the recording wrapper
(`ledger.admit`), which refuses a row from week W or stamped after t_g and keeps the read's stamp
for G5. The season before is read once, at the season's first instant (`read_prior`), and the run
refuses unless no row of it is stamped between that instant and the season's last: then a read at
any t_g of the season returns the same rows.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from types import MappingProxyType
from typing import Final

from sqlalchemy import Connection, text

from research.model.reads.observations import LAST_POSSIBLE_WEEK, ObservationQuery, WeekRange, observations_as_of
from research.model.reads.teams import player_teams_as_of, team_observations_as_of
from research.model.weekly2.designation import WeekStatus, status_of_filing
from research.model.weekly3.allowance import TeamRows
from research.model.weekly3.ledger import SEASON_WIDE, InputRuleError, Stamp, admit
from research.model.weekly3.work import USAGE_METRICS, USAGE_ROWS, PlayerGame, Work, mean_work, player_games
from research.pipeline.nflverse.injury_reports import INJURY_SOURCE, InjuryMetric
from research.pipeline.nflverse.pbp import PBP_SOURCE, PbpMetric

# Section 2 item 2 and item 3: pace and pass rate (controls), dropbacks and dropbacks faced (the
# quarterbacks' allowance), from the play-by-play club rows.
TEAM_METRICS: Final = (
    PbpMetric.PACE_SECONDS_PER_PLAY,
    PbpMetric.PASS_RATE,
    PbpMetric.DROPBACKS,
    PbpMetric.DROPBACKS_FACED,
)


@dataclass(frozen=True, slots=True)
class Snapshot:
    """Every covered read at one instant of a week."""

    season: int
    week: int
    moment: datetime
    games: Mapping[str, tuple[PlayerGame, ...]]  # each player's line-weeks before W, in order
    clubs: Mapping[str, str]  # each player's latest club edge this season before W (the model's rule)
    team_rows: TeamRows  # (club, week) -> play-by-play metric -> value, weeks before W
    statuses: Mapping[str, WeekStatus]  # week W's latest filing per player, at the instant
    stamps: tuple[Stamp, ...]


def latest_club(games: tuple[PlayerGame, ...]) -> str | None:
    return games[-1].club if games else None


def read_snapshot(conn: Connection, season: int, week: int, moment: datetime) -> Snapshot:
    """The box-score reads (weeks before W) and the filings (week W), at `moment`, recorded."""
    span = WeekRange(1, week - 1)
    observations = observations_as_of(conn, ObservationQuery(season, span, moment, metrics=USAGE_METRICS))
    edges = player_teams_as_of(conn, season, span, moment)
    team = [r for r in team_observations_as_of(conn, season, span, moment, PBP_SOURCE) if r.metric in TEAM_METRICS]
    filings = observations_as_of(
        conn, ObservationQuery(season, week, moment, INJURY_SOURCE, metrics=(InjuryMetric.REPORT_STATUS,))
    )
    box = admit([*observations, *edges, *team], season, week, moment, "box")
    filed = admit(filings, season, week, moment, "filings")
    games = player_games(observations, edges)
    rows: dict[tuple[str, int], dict[str, float]] = {}
    for row in team:
        rows.setdefault((row.team, row.week), {})[row.metric] = row.value
    return Snapshot(
        season,
        week,
        moment,
        MappingProxyType(games),
        MappingProxyType({pid: club for pid, played in games.items() if (club := latest_club(played)) is not None}),
        MappingProxyType({key: MappingProxyType(found) for key, found in rows.items()}),
        MappingProxyType({row.player_id: status_of_filing(row.value) for row in filings}),
        (box, filed),
    )


@dataclass(frozen=True, slots=True)
class PriorSeason:
    """Each player's mean work over his games of the season before, and the read's stamp."""

    means: Mapping[str, Work]
    stamp: Stamp


_ROWS_BETWEEN: Final = text(
    "select (select count(*) from research.player_week_observations where season = :prior_season "
    "and metric = any(:metrics) and as_of > :after and as_of <= :until) "
    "+ (select count(*) from research.player_week_teams where season = :prior_season "
    "and as_of > :after and as_of <= :until) as n"
)


def read_prior(conn: Connection, season: int, moment: datetime, last: datetime) -> PriorSeason:
    """The season before `season`, read at its first instant `moment`; refused unless no row of it
    is stamped in (moment, last], the season's last instant."""
    prior = season - 1
    span = WeekRange(1, LAST_POSSIBLE_WEEK)
    observations = observations_as_of(conn, ObservationQuery(prior, span, moment, metrics=USAGE_METRICS))
    edges = player_teams_as_of(conn, prior, span, moment)
    stamp = admit([*observations, *edges], season, SEASON_WIDE, moment, "prior")
    later = conn.execute(
        _ROWS_BETWEEN,
        {"prior_season": prior, "metrics": [m for _, m in USAGE_ROWS], "after": moment, "until": last},
    ).scalar_one()
    if int(later) > 0:
        raise InputRuleError(
            f"{later} rows of {prior} are stamped during {season}'s judged weeks; one read of the season before is not exact"
        )
    games = player_games(observations, edges)
    return PriorSeason(
        MappingProxyType({pid: mean_work([g.work for g in played]) for pid, played in games.items()}), stamp
    )
