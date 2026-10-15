"""THIS SEASON'S USAGE READS: the product season's play-by-play and charted facts, read once a pass.

One read of the facts the figures need (`season_usage.needed_metrics`) for every player, as of the
pass's instant (the latest statement of each fact at or before it), and one of the season's
player-team edges: the figures are about the population, the club totals about everyone. Never
through the history cache: this season moves every week.
"""

from collections.abc import Mapping
from datetime import datetime
from typing import Final

from sqlalchemy import Connection, text

from research.capsules.facts.depth_reads import names_for
from research.capsules.facts.model import SeasonUsage
from research.capsules.facts.season_usage import (
    TEAM_SHARE_METRICS,
    ZERO_WHEN_PLAYED,
    SeasonInputs,
    Week,
    metric_key,
    needed_metrics,
    season_usage_for,
)
from research.model.domain import Position
from research.model.reads.observations import LAST_POSSIBLE_WEEK, WeekRange
from research.model.reads.teams import player_teams_as_of
from research.pipeline.nflverse.participation import NflverseSource, ParticipationMetric
from research.pipeline.nflverse.pbp import PBP_PLAYER_SOURCE

_SNAPS: Final = metric_key(NflverseSource.SNAP_COUNTS, ParticipationMetric.OFFENSIVE_SNAPS)
_PBP_PREFIX: Final = metric_key(PBP_PLAYER_SOURCE, "")
_READ: Final = text(
    "select distinct on (week, player_id, source, metric) week, player_id, source, metric, value "
    "from research.player_week_observations "
    "where season = :season and week >= 1 and week <= :last and as_of <= :as_of "
    "and source = any(:sources) and metric = any(:metrics) "
    "order by week asc, player_id asc, source asc, metric asc, as_of desc"
)

PlayerWeek = tuple[str, int]


def _facts(conn: Connection, season: int, as_of: datetime) -> dict[PlayerWeek, dict[str, float]]:
    wanted = {*needed_metrics(), _SNAPS}
    sources = sorted({key.split(":", 1)[0] for key in wanted})
    metrics = sorted({key.split(":", 1)[1] for key in wanted})
    rows = conn.execute(
        _READ, {"season": season, "last": LAST_POSSIBLE_WEEK, "as_of": as_of, "sources": sources, "metrics": metrics}
    )
    facts: dict[PlayerWeek, dict[str, float]] = {}
    for row in rows:
        key = metric_key(row.source, row.metric)
        if key in wanted:
            facts.setdefault((str(row.player_id), int(row.week)), {})[key] = float(row.value)
    return facts


def _touched(own: Mapping[str, float]) -> bool:
    """A carry or target in the play-by-play that week."""
    return any(key.startswith(_PBP_PREFIX) for key in own)


def _played(facts: Mapping[PlayerWeek, Mapping[str, float]]) -> dict[PlayerWeek, dict[str, float]]:
    """His own facts each week, the team-share counts filled with zero in a week he played (an
    offensive snap or a play-by-play touch) without touching the ball, so his club's week still counts."""
    touched = {player for (player, _), own in facts.items() if _touched(own)}
    played: dict[PlayerWeek, dict[str, float]] = {}
    for (player, week), own in facts.items():
        filled = player in touched and (own.get(_SNAPS, 0.0) > 0 or _touched(own))
        played[(player, week)] = {**dict.fromkeys(ZERO_WHEN_PLAYED, 0.0), **own} if filled else dict(own)
    return played


def _team_totals(
    facts: Mapping[PlayerWeek, Mapping[str, float]], team_of: Mapping[PlayerWeek, str]
) -> dict[tuple[str, int], dict[str, float]]:
    totals: dict[tuple[str, int], dict[str, float]] = {}
    for (player, week), own in facts.items():
        team = team_of.get((player, week))
        if team is None:
            continue
        held = totals.setdefault((team, week), {})
        for key in TEAM_SHARE_METRICS:
            if key in own:
                held[key] = held.get(key, 0.0) + own[key]
    return totals


def season_usage_by_player(
    conn: Connection, season: int, positions: Mapping[str, Position], as_of: datetime, *, ftn_on: bool
) -> dict[str, SeasonUsage]:
    """This season's figures for every player in `positions`, by universe id; empty before any
    week's facts are stored."""
    facts = _facts(conn, season, as_of)
    pbp_weeks = [week for (_, week), own in facts.items() if _touched(own)]
    if not pbp_weeks or not positions:
        return {}
    team_of = {
        (t.player_id, t.week): t.team for t in player_teams_as_of(conn, season, WeekRange(1, LAST_POSSIBLE_WEEK), as_of)
    }
    team_totals = _team_totals(facts, team_of)
    weeks: dict[str, list[Week]] = {}
    for (player, week), own in sorted(_played(facts).items()):
        if player in positions:
            team = team_totals.get((team_of.get((player, week)) or "", week), {})
            weeks.setdefault(player, []).append(Week(week, own, team))
    inputs = SeasonInputs(season, min(pbp_weeks), max(pbp_weeks), weeks, positions, names_for(conn, list(weeks)))
    return season_usage_for(inputs, ftn_on=ftn_on)
