"""TAKING A FREEZE: what every tracked board and the three benchmarks said about a week, written
down strictly before the week's first kickoff, and stamped as the Python's.

Ported from `research-ts/src/projections/register/{freeze,props,sources,store}.ts`. The board column
is a READ of the stored board, never a recompute: the register records the claim a manager could
have been shown. A freeze taken at or after the week's first kickoff is refused. Every row this
writes carries `implementation = 'python'`; the TypeScript's rows are never touched.
"""

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final

from sqlalchemy import Connection, text

from research.model.domain import PPR_SCORING
from research.model.instants import js_iso, ms_instant
from research.model.reads.preseason import preseason_rankings_as_of
from research.model.reads.teams import kickoff_instants_by_week
from research.pipeline.odds.props import PROP_MARKETS

SERVED_SOURCE: Final = "commish_board_v9_ppr_12"
SHADOW_SOURCE: Final = "commish_board_v7_ppr_12"
REGISTER_BOARD_SOURCES: Final = ((SERVED_SOURCE, "served"), (SHADOW_SOURCE, "shadow"))
ADP_SOURCE: Final = "ffc_adp_ppr_12"
ECR_SOURCE: Final = "fantasypros_ecr_ppr"
IMPLEMENTATION: Final = "python"
_MARKET_WEIGHT: Final = {
    "player_pass_yds": PPR_SCORING.points_per_passing_yard,
    "player_rush_yds": PPR_SCORING.points_per_rushing_yard,
    "player_reception_yds": PPR_SCORING.points_per_receiving_yard,
    "player_receptions": PPR_SCORING.points_per_reception,
}


class RegisterRefusalError(ValueError):
    """`RegisterRefusalError`: a freeze that would not be a prospective claim, or about nothing."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class PropsStance:
    points: float
    markets: dict[str, float]


def _median(values: Sequence[float]) -> float:
    ordered = sorted(values)
    middle = len(ordered) // 2
    return ordered[middle] if len(ordered) % 2 == 1 else (ordered[middle - 1] + ordered[middle]) / 2


def week_props_consensus(
    conn: Connection, season: int, window: tuple[datetime, datetime | None], as_of: datetime
) -> dict[str, PropsStance]:
    """`weekPropsConsensus`: each book's latest line per market, the median across books, priced."""
    names = {
        row.prop_name: row.player_id
        for row in conn.execute(
            text("select prop_name, player_id from research.props_player_map where season = :s"), {"s": season}
        )
    }
    if not names:
        return {}
    start, end = window
    upper = "" if end is None else "and commence_time < :end"
    rows = conn.execute(
        text(
            f"select player_name, market, bookmaker, point, fetched_at from research.player_prop_observations "
            f"where commence_time >= :start {upper} and fetched_at <= :as_of order by id"
        ),
        {"start": start, "end": end, "as_of": as_of},
    )
    latest: dict[str, tuple[float, datetime]] = {}
    markets_by_player: dict[str, dict[str, list[str]]] = {}
    for row in rows:
        player_id = names.get(row.player_name)
        if player_id is None or row.market not in PROP_MARKETS:
            continue
        key = json.dumps([player_id, row.market, row.bookmaker], separators=(",", ":"), ensure_ascii=False)
        fetched = ms_instant(row.fetched_at)
        held = latest.get(key)
        if held is not None and held[1] >= fetched:
            continue
        latest[key] = (row.point, fetched)
        books = markets_by_player.setdefault(player_id, {}).setdefault(row.market, [])
        if key not in books:
            books.append(key)
    stances: dict[str, PropsStance] = {}
    for player_id, by_market in markets_by_player.items():
        markets: dict[str, float] = {}
        points = 0.0
        for market, keys in by_market.items():
            line = _median([latest[key][0] for key in keys])
            markets[market] = line
            weight = _MARKET_WEIGHT.get(market)
            if weight is not None:
                points += line * weight
        stances[player_id] = PropsStance(points, markets)
    return stances


def _stored_board(conn: Connection, season: int, source: str, as_of: datetime) -> list[Any]:
    generations = conn.execute(
        text(
            "select distinct as_of from research.preseason_projections where season = :s and source = :source and as_of <= :a"
        ),
        {"s": season, "source": source, "a": as_of},
    ).fetchall()
    if len(generations) > 1:
        stamps = ", ".join(sorted(js_iso(ms_instant(row[0])) for row in generations))
        raise RegisterRefusalError(
            "stitched_generations",
            f"{season} {source} holds more than one generation at or before {js_iso(as_of)}: {stamps}",
        )
    return list(
        conn.execute(
            text(
                "select distinct on (player_id) player_id, source, as_of, projected_points, rank, value_rank from research.preseason_projections "
                "where season = :s and source = :source and as_of <= :a order by player_id asc, as_of desc"
            ),
            {"s": season, "source": source, "a": as_of},
        )
    )


@dataclass(frozen=True, slots=True)
class FreezeResult:
    season: int
    week: int
    frozen_at: datetime
    kickoff: datetime
    rows: list[dict[str, Any]]
    coverage: dict[str, dict[str, int]]


def take_freeze(conn: Connection, season: int, week: int, now: datetime) -> FreezeResult:
    """`takeFreeze`: every tracked board and the benchmarks at one instant, in one transaction."""
    kickoffs = kickoff_instants_by_week(conn, season)
    kickoff = kickoffs.get(week)
    if kickoff is None:
        raise RegisterRefusalError(
            "no_kickoff",
            f"The store holds no ingested kickoff for {season} week {week}, so there is nothing to check a freeze against.",
        )
    frozen_at = ms_instant(now)
    if frozen_at >= kickoff:
        raise RegisterRefusalError(
            "past_kickoff",
            f"{season} week {week}'s first kickoff ({js_iso(kickoff)}) is not after {js_iso(frozen_at)}.",
        )
    adp = {row.player_id: row.rank for row in preseason_rankings_as_of(conn, season, ADP_SOURCE, frozen_at)}
    ecr = {row.player_id: row.rank for row in preseason_rankings_as_of(conn, season, ECR_SOURCE, frozen_at)}
    props = week_props_consensus(conn, season, (kickoff, kickoffs.get(week + 1)), frozen_at)
    rows: list[dict[str, Any]] = []
    coverage: dict[str, dict[str, int]] = {}
    for source, role in REGISTER_BOARD_SOURCES:
        board_rows = [
            _freeze_row(season, week, frozen_at, entry, adp, ecr, props)
            for entry in _stored_board(conn, season, source, frozen_at)
        ]
        if role == "served" and not board_rows:
            raise RegisterRefusalError(
                "empty_served_board",
                f'The served board ("{SERVED_SOURCE}") holds no {season} rows at or before {js_iso(frozen_at)}, so there is no claim to freeze.',
            )
        coverage[source] = {
            "board": len(board_rows),
            "adp": sum(1 for row in board_rows if row["adp"] is not None),
            "ecr": sum(1 for row in board_rows if row["ecr"] is not None),
            "props": sum(1 for row in board_rows if row["props_points"] is not None),
        }
        rows.extend(board_rows)
    _record(conn, rows)
    return FreezeResult(season, week, frozen_at, kickoff, rows, coverage)


def _freeze_row(  # noqa: PLR0913, PLR0917 - the oracle's own parameters, in its order, for a line-by-line read
    season: int,
    week: int,
    frozen_at: datetime,
    entry: Any,
    adp: Mapping[str, float],
    ecr: Mapping[str, float],
    props: Mapping[str, PropsStance],
) -> dict[str, Any]:
    stance = props.get(entry.player_id)
    return {
        "season": season,
        "week": week,
        "frozen_at": frozen_at,
        "board_source": entry.source,
        "player_id": entry.player_id,
        "implementation": IMPLEMENTATION,
        "board_as_of": ms_instant(entry.as_of),
        "board_points": entry.projected_points,
        "board_rank": entry.rank,
        "board_value_rank": entry.value_rank,
        "adp": adp.get(entry.player_id),
        "ecr": ecr.get(entry.player_id),
        "props_points": None if stance is None else stance.points,
        "props_markets": None if stance is None else stance.markets,
    }


def _record(conn: Connection, rows: Sequence[Mapping[str, Any]]) -> None:
    """`recordFreezeRows`: a plain insert, no conflict clause; a second claim at an instant is refused."""
    statement = text(
        "insert into research.register_freeze_rows (season, week, frozen_at, board_source, player_id, implementation, board_as_of, "
        "board_points, board_rank, board_value_rank, adp, ecr, props_points, props_markets) values (:season, :week, :frozen_at, "
        ":board_source, :player_id, :implementation, :board_as_of, :board_points, :board_rank, :board_value_rank, :adp, :ecr, "
        ":props_points, cast(:props_markets as jsonb))"
    )
    for row in rows:
        conn.execute(
            statement,
            {**row, "props_markets": None if row["props_markets"] is None else json.dumps(row["props_markets"])},
        )
