"""THE PROPS ANCHOR: week one's player prop lines, rescaled per position onto the market's points.

Ported from `research-ts/src/projections/market/props-anchor.ts`.
"""

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Final

from sqlalchemy import Connection, text

from research.model.domain import PPR_SCORING, STAT_FIELDS, Position, StatLine, compute_fantasy_points
from research.model.instants import ms_instant
from research.model.market.curve import CURVE_POSITIONS
from research.model.reads.teams import first_kickoff_for
from research.pipeline.odds.ingest import season_of_kickoff
from research.pipeline.odds.props import PROP_MARKETS

WEEK_ONE_WINDOW: Final = timedelta(days=7)
MINIMUM_ANCHORED_PER_POSITION: Final = 10
_AUGUST: Final = 8
_MARCH: Final = 3


@dataclass(frozen=True, slots=True)
class ArchivedPropLine:
    player_id: str
    market: str
    point: float
    commence_time: datetime
    fetched_at: datetime


def _median(values: Sequence[float]) -> float:
    ordered = sorted(values)
    middle = math.floor(len(ordered) / 2)
    return ordered[middle] if len(ordered) % 2 == 1 else (ordered[middle - 1] + ordered[middle]) / 2


def median_prop_lines_by_player(
    lines: Sequence[ArchivedPropLine], first_kickoff: datetime
) -> dict[str, dict[str, float]]:
    """`medianPropLinesByPlayer`: the median pre-kickoff line per player and market, week one only."""
    window_end = first_kickoff + WEEK_ONE_WINDOW
    points: dict[str, list[float]] = {}
    for entry in lines:
        if (
            entry.fetched_at >= first_kickoff
            or entry.commence_time < first_kickoff
            or entry.commence_time >= window_end
        ):
            continue
        if not math.isfinite(entry.point):
            continue
        points.setdefault(f"{entry.player_id}|{entry.market}", []).append(entry.point)
    medians: dict[str, dict[str, float]] = {}
    for key, values in points.items():
        player_id, _, market = key.rpartition("|")
        if market not in PROP_MARKETS:
            continue
        medians.setdefault(player_id, {})[market] = _median(values)
    return medians


def _props_per_game_line(player_id: str, medians: Mapping[str, float]) -> StatLine:
    return StatLine(player_id, 1, **dict.fromkeys(STAT_FIELDS, 0.0)).with_values(
        passing_yards=medians.get("player_pass_yds", 0.0),
        receiving_yards=medians.get("player_reception_yds", 0.0),
        receptions=medians.get("player_receptions", 0.0),
        rushing_yards=medians.get("player_rush_yds", 0.0),
    )


def props_anchor_points(
    lines: Sequence[ArchivedPropLine],
    first_kickoff: datetime,
    positions: Mapping[str, Position],
    market_points: Mapping[str, float],
    implied_games: Mapping[str, float],
) -> dict[str, float]:
    """`propsAnchorPoints`."""
    raw_by_player: dict[str, tuple[Position, float]] = {}
    for player_id, medians in median_prop_lines_by_player(lines, first_kickoff).items():
        position = positions.get(player_id)
        if position is None or position not in CURVE_POSITIONS:
            continue
        raw = (
            compute_fantasy_points(_props_per_game_line(player_id, medians), position, PPR_SCORING)
            * implied_games[position]
        )
        if not (raw > 0):
            continue
        raw_by_player[player_id] = (position, raw)
    totals: dict[Position, list[float]] = {}
    for player_id, (position, raw) in raw_by_player.items():
        market = market_points.get(player_id)
        if market is None:
            continue
        cell = totals.setdefault(position, [0.0, 0.0, 0.0])
        cell[0] += market
        cell[1] += raw
        cell[2] += 1
    scale: dict[Position, float] = {}
    for position, (market_total, raw_total, anchored) in totals.items():
        if anchored < MINIMUM_ANCHORED_PER_POSITION or not (raw_total > 0) or not (market_total > 0):
            continue
        scale[position] = market_total / raw_total
    return {
        player_id: raw * scale[position] for player_id, (position, raw) in raw_by_player.items() if position in scale
    }


def load_archived_prop_lines(conn: Connection, season: int, first_kickoff: datetime) -> list[ArchivedPropLine]:
    """`loadArchivedPropLines`: the season's archived lines fetched before its first kickoff. The
    TypeScript read carries no order; this reads in the archive's insertion order (its id), the
    order an append-only heap is scanned in."""
    rows = conn.execute(
        text(
            "select player_name, market, point, commence_time, fetched_at from research.player_prop_observations "
            "where commence_time >= :start and commence_time < :end and fetched_at < :kickoff order by id"
        ),
        {
            "start": datetime(season, _AUGUST, 1, tzinfo=UTC),
            "end": datetime(season + 1, _MARCH, 1, tzinfo=UTC),
            "kickoff": first_kickoff,
        },
    )
    names = {
        row.prop_name: row.player_id
        for row in conn.execute(text("select prop_name, season, player_id from research.props_player_map"))
        if row.season == season
    }
    lines: list[ArchivedPropLine] = []
    for row in rows:
        commence = ms_instant(row.commence_time)
        if season_of_kickoff(commence) != season or row.market not in PROP_MARKETS:
            continue
        player_id = names.get(row.player_name)
        if player_id is None:
            continue
        lines.append(ArchivedPropLine(player_id, row.market, row.point, commence, ms_instant(row.fetched_at)))
    return lines


def props_anchor_for_season(
    conn: Connection,
    season: int,
    positions: Mapping[str, Position],
    market_points: Mapping[str, float],
    implied_games: Mapping[str, float],
) -> dict[str, float]:
    """`propsAnchorForSeason`."""
    first_kickoff = first_kickoff_for(conn, season)
    if first_kickoff is None:
        return {}
    return props_anchor_points(
        load_archived_prop_lines(conn, season, first_kickoff), first_kickoff, positions, market_points, implied_games
    )
