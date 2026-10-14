"""WHICH CLUB A PLAYER IS PROJECTED WITH: the oracle's rule, and the round's correction of it.

The oracle's `latestTeams` (`team-context.ts`) keeps each player's team of his highest WEEK across
the two seasons a weekly projection reads, without comparing seasons. In a replay of season S the
edges arrive prior season first, so a man who played week 17 for Cleveland last year stays a
Cleveland player in every week of S before week 17, whichever club he plays for now; the scheme and
the opponent he is projected with are his old club's. `oracle_latest_teams` reproduces that for the
parity cases. `latest_teams_by_season` is the correction the weekly round's model runs with (named
in the preregistration, amendment-free because it was made before any fit): the latest (season,
week) edge wins.
"""

from collections.abc import Callable, Sequence

from research.model.reads.teams import TeamContext, latest_teams
from research.pipeline.observations import PlayerWeekTeam

TeamsOf = Callable[[TeamContext], dict[str, str]]


def oracle_latest_teams(context: TeamContext) -> dict[str, str]:
    """`latestTeams` exactly: the highest week wins, seasons not compared."""
    return latest_teams(context.player_teams)


def latest_teams_by_season(context: TeamContext) -> dict[str, str]:
    """Each player's club at his latest (season, week) edge."""
    return _latest(context.player_teams)


def _latest(edges: Sequence[PlayerWeekTeam]) -> dict[str, str]:
    latest: dict[str, tuple[int, int]] = {}
    team: dict[str, str] = {}
    for row in edges:
        known = latest.get(row.player_id)
        if known is not None and known >= (row.season, row.week):
            continue
        latest[row.player_id] = (row.season, row.week)
        team[row.player_id] = row.team
    return team
