"""ESPN'S WEEKLY PROJECTION, READ BEFORE THE ORDER IS SET (`espn_projection_rows`, Lane 114).

The weekly record grades the order the site ships beside the weekly yardsticks a player knows (Amendment 5
of the round 4 preregistration). ESPN's own projection is one: its public player pool
(`kona_player_info` on ESPN's PPR league defaults, `leaguedefaults/3`) answers every player ESPN
projects with no sign-in, each with one stat split per scoring period and source. The projection for
week W of season S is the split with `seasonId` S, `scoringPeriodId` W, `statSourceId` 1 (projected) and
`statSplitTypeId` 1 (one scoring period); its `appliedTotal` is the PPR points as the defaults score
them (checked 2026-10-20: the week 7 totals equal the PPR sum of the split's own stats to a tenth).

The in-season pass reads the coming week once per pass, before its freeze (`season_week`), so the
Thursday 14:00 Eastern pass that sets the order keeps a read taken minutes before it. Every read is kept
whole (append-only, keyed by its instant); the freeze keeps the newest read at or before it. A read
that lists no projection for the week is unpublished: nothing is stored and the pass says so. Never an
input to a fit.
"""

import json
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final

from sqlalchemy import Connection

from research.db.schema import ESPN_PROJECTION_ROWS
from research.errors import SchemaDriftError
from research.pipeline.http import Fetcher
from research.pipeline.observations import insert_ignoring_conflicts

PPR_DEFAULTS: Final = 3
PROJECTED_SOURCE: Final = 1
ONE_PERIOD_SPLIT: Final = 1
# Every player ESPN lists fits under this (1,054 on 2026-10-20).
POOL_LIMIT: Final = 3000


def pool_url(season: int, week: int) -> str:
    return (
        f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{season}/segments/0/"
        f"leaguedefaults/{PPR_DEFAULTS}?scoringPeriodId={week}&view=kona_player_info"
    )


def pool_headers(week: int) -> dict[str, str]:
    """The filter ESPN reads from its own header: projected one-period splits of the week, every player."""
    wanted = {
        "players": {
            "filterStatsForSourceIds": {"value": [PROJECTED_SOURCE]},
            "filterStatsForSplitTypeIds": {"value": [ONE_PERIOD_SPLIT]},
            "filterStatsForScoringPeriodIds": {"value": [week]},
            "limit": POOL_LIMIT,
        }
    }
    return {"X-Fantasy-Filter": json.dumps(wanted, separators=(",", ":")), "Accept": "application/json"}


@dataclass(frozen=True, slots=True)
class Projection:
    espn_id: str
    ppr_points: float


def _week_total(stats: Any, season: int, week: int) -> float | None:
    if not isinstance(stats, list):
        return None
    for split in stats:
        if not isinstance(split, Mapping):
            continue
        if (
            split.get("seasonId") == season
            and split.get("scoringPeriodId") == week
            and split.get("statSourceId") == PROJECTED_SOURCE
            and split.get("statSplitTypeId") == ONE_PERIOD_SPLIT
        ):
            total = split.get("appliedTotal")
            if isinstance(total, int | float) and not isinstance(total, bool) and math.isfinite(total):
                return float(total)
    return None


def parse_pool(payload: Any, season: int, week: int) -> list[Projection]:
    """Each player's projection for the week, in the pool's order. A payload without the player list, or
    a player entry without its id, is a changed feed and refused; a player with no split for the week
    (ESPN projects only who it expects to play) is left out."""
    players = payload.get("players") if isinstance(payload, Mapping) else None
    if not isinstance(players, list):
        raise SchemaDriftError("espn_projections: the player pool answered without a players list")
    out: list[Projection] = []
    seen: set[str] = set()
    for entry in players:
        player = entry.get("player") if isinstance(entry, Mapping) else None
        espn_id = player.get("id") if isinstance(player, Mapping) else None
        if not isinstance(espn_id, int) or isinstance(espn_id, bool):
            raise SchemaDriftError(f"espn_projections: a pool entry without a player id: {str(entry)[:120]}")
        total = _week_total(player.get("stats"), season, week) if isinstance(player, Mapping) else None
        if total is None or str(espn_id) in seen:
            continue
        seen.add(str(espn_id))
        out.append(Projection(str(espn_id), total))
    return out


@dataclass(frozen=True, slots=True)
class PoolRead:
    week: int
    listed: int
    written: int

    @property
    def published(self) -> bool:
        return self.listed > 0


def read_week(conn: Connection, fetcher: Fetcher, season: int, week: int, now: datetime) -> PoolRead:
    """One read of the week's projection, kept at `now`. A failed answer raises (the step fails and the
    freeze after it still runs); an answer listing no projection for the week stores nothing."""
    response = fetcher.get(pool_url(season, week), pool_headers(week))
    if not response.ok:
        raise RuntimeError(f"espn_projections: the player pool answered {response.status} for {season} week {week}")
    try:
        payload = json.loads(response.body)
    except ValueError as error:
        raise SchemaDriftError(f"espn_projections: the player pool answered no JSON: {error}") from error
    projections = parse_pool(payload, season, week)
    written = store(conn, season, week, now, projections)
    return PoolRead(week, len(projections), written)


def store(conn: Connection, season: int, week: int, at: datetime, projections: Sequence[Projection]) -> int:
    rows: list[dict[str, object]] = [
        {"season": season, "week": week, "read_at": at, "espn_id": p.espn_id, "ppr_points": p.ppr_points}
        for p in projections
    ]
    return insert_ignoring_conflicts(conn, ESPN_PROJECTION_ROWS, rows) if rows else 0
