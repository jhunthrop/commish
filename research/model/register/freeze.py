"""TAKING A FREEZE: what every tracked board and the three benchmarks said about a week, written
down strictly before the week's first kickoff, and stamped as the Python's.

Ported from `research-ts/src/projections/register/{freeze,props,sources,store}.ts`. The board column
is a READ of the stored board, never a recompute: the register records the claim a manager could
have been shown. A freeze taken at or after the week's first kickoff is refused. Every row this
writes carries `implementation = 'python'`; the TypeScript's rows are never touched. Every row also
carries the `model_version` of the board it quotes; a board that names no model is refused, since a
claim whose maker is unknown cannot be graded as anyone's.

Lane 93 (ruling B18) adds the order the site actually ships: from the first in-season board, every
screen shows the published run's rest-of-season order (`published_boards`), so the freeze also keeps
that board as `SHIPPED_SOURCE`, beside the preseason board it always kept. It is not in the oracle,
which knew no published board; a store with no in-season published board freezes exactly as before.
"""

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from types import MappingProxyType
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
# The order every screen ships in season (Lane 93, ruling B18): the published run's PPR board as
# `published_boards` holds it at the freeze, our rest-of-season order. The record grades it from the
# first week a freeze keeps it (week 7); the preseason board stays frozen beside it as it always was.
SHIPPED_SOURCE: Final = "commish_ros_shipped_ppr_12"
SHIPPED_FORMAT: Final = "ppr"
SHIPPED_ORDER_BASIS: Final = "rest_of_season"
ADP_SOURCE: Final = "ffc_adp_ppr_12"
ECR_SOURCE: Final = "fantasypros_ecr_ppr"
IMPLEMENTATION: Final = "python"
_MARKET_WEIGHT: Final = MappingProxyType(
    {
        "player_pass_yds": PPR_SCORING.points_per_passing_yard,
        "player_rush_yds": PPR_SCORING.points_per_rushing_yard,
        "player_reception_yds": PPR_SCORING.points_per_receiving_yard,
        "player_receptions": PPR_SCORING.points_per_reception,
    }
)


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


_PUBLISHED: Final = """
with newest as (
  select snapshot_id from research.tank01_projection_rows
  where season = :s and week = :w and captured_at <= :a
  group by snapshot_id order by max(captured_at) desc, snapshot_id desc limit 1
)
select c.player_id, r.ppr_points from research.tank01_projection_rows r
join newest n on n.snapshot_id = r.snapshot_id
join research.player_crosswalk c on c.provider_player_id = r.provider_player_id
where c.player_id is not null
"""


def week_published_points(conn: Connection, season: int, week: int, as_of: datetime) -> dict[str, float]:
    """The week's published projection at the freeze (Lane 66j): each player's PPR points on the newest
    snapshot read at or before `as_of`, by research player id through the crosswalk. Empty when no
    snapshot of the week was read by then."""
    rows = conn.execute(text(_PUBLISHED), {"s": season, "w": week, "a": as_of})
    return {str(row.player_id): float(row.ppr_points) for row in rows}


_ESPN_NEWEST: Final = """
select max(read_at) from research.espn_projection_rows where season = :s and week = :w and read_at <= :a
"""
_ESPN_FIRST_BETWEEN: Final = """
select min(read_at) from research.espn_projection_rows
where season = :s and week = :w and read_at > :after and read_at < :before
"""
_ESPN_AT: Final = """
select p.id as player_id, r.ppr_points from research.espn_projection_rows r
join research.players p on p.espn_id = r.espn_id
where r.season = :s and r.week = :w and r.read_at = :r
"""


@dataclass(frozen=True, slots=True)
class EspnRead:
    """One ESPN read of a week: its instant (None when there is no such read) and each player's PPR
    points on it, by research player id through his ESPN id."""

    read_at: datetime | None
    points: Mapping[str, float]


def _espn_read(conn: Connection, season: int, week: int, read_at: datetime | None) -> EspnRead:
    if read_at is None:
        return EspnRead(None, {})
    rows = conn.execute(text(_ESPN_AT), {"s": season, "w": week, "r": read_at})
    return EspnRead(ms_instant(read_at), {str(row.player_id): float(row.ppr_points) for row in rows})


def week_espn_read(conn: Connection, season: int, week: int, as_of: datetime) -> EspnRead:
    """ESPN's own weekly projection at the freeze (Lane 114, Amendment 5): the newest public read of the
    week taken at or before `as_of`, empty when no read of the week was taken by then."""
    newest = conn.execute(text(_ESPN_NEWEST), {"s": season, "w": week, "a": as_of}).scalar()
    return _espn_read(conn, season, week, newest)


def first_espn_read_between(conn: Connection, season: int, week: int, after: datetime, before: datetime) -> EspnRead:
    """The first ESPN read of the week taken strictly after `after` and strictly before `before`
    (Amendment 6: after a freeze that kept none, before the week's first kickoff); empty when none was."""
    first = conn.execute(text(_ESPN_FIRST_BETWEEN), {"s": season, "w": week, "after": after, "before": before}).scalar()
    return _espn_read(conn, season, week, first)


_SHIPPED: Final = """
select c.player_id, b.refreshed, b.points, b.rank, b.run_id from research.published_boards b
join research.player_crosswalk c on c.provider_player_id = b.player_id
where b.season = :s and b.format = :format and b.order_basis = :basis and b.points is not null
  and b.published_at <= :a and c.player_id is not null
"""


@dataclass(frozen=True, slots=True)
class ShippedEntry:
    """One row of the order the site ships at the freeze, in the stored board's shape: his
    rest-of-season points, his place in the order (which is its value order, points over
    replacement), and the published run as the maker of the claim."""

    player_id: str
    source: str
    as_of: datetime
    projected_points: float
    rank: int
    value_rank: int
    model_version: str


def shipped_board(conn: Connection, season: int, as_of: datetime) -> list[ShippedEntry]:
    """The order the site ships at `as_of` (Lane 93): the published run's PPR rest-of-season board,
    published at or before the freeze, each row through the crosswalk to its research id. Empty before
    the first in-season board (the preseason board is then the order shipped, frozen as the served
    board) and for a row with no research id."""
    params = {"s": season, "format": SHIPPED_FORMAT, "basis": SHIPPED_ORDER_BASIS, "a": as_of}
    return [
        ShippedEntry(
            str(row.player_id),
            SHIPPED_SOURCE,
            ms_instant(row.refreshed),
            float(row.points),
            int(row.rank),
            int(row.rank),
            f"published run {row.run_id}",
        )
        for row in conn.execute(text(_SHIPPED), params)
    ]


def _coverage(rows: Sequence[Mapping[str, Any]]) -> dict[str, int]:
    return {
        "board": len(rows),
        "adp": sum(1 for row in rows if row["adp"] is not None),
        "ecr": sum(1 for row in rows if row["ecr"] is not None),
        "props": sum(1 for row in rows if row["props_points"] is not None),
        "published": sum(1 for row in rows if row["published_points"] is not None),
        "espn": sum(1 for row in rows if row["espn_points"] is not None),
    }


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
                "select distinct on (player_id) player_id, source, as_of, projected_points, rank, value_rank, model_version "
                "from research.preseason_projections "
                "where season = :s and source = :source and as_of <= :a order by player_id asc, as_of desc"
            ),
            {"s": season, "source": source, "a": as_of},
        )
    )


@dataclass(frozen=True, slots=True)
class Yardsticks:
    """The week's projections a freeze keeps beside each row: the published one (Lane 66j) and ESPN's
    (Lane 114), each by research player id, with the instant of the ESPN read (Lane 146)."""

    published: Mapping[str, float]
    espn: Mapping[str, float]
    espn_read_at: datetime | None = None


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
    published = week_published_points(conn, season, week, frozen_at)
    espn = week_espn_read(conn, season, week, frozen_at)
    yardsticks = Yardsticks(published, espn.points, espn.read_at)
    rows: list[dict[str, Any]] = []
    coverage: dict[str, dict[str, int]] = {}
    for source, role in REGISTER_BOARD_SOURCES:
        board_rows = [
            _freeze_row(season, week, frozen_at, entry, adp, ecr, props, yardsticks)
            for entry in _stored_board(conn, season, source, frozen_at)
        ]
        unnamed = sorted({js_iso(row["board_as_of"]) for row in board_rows if row["model_version"] is None})
        if unnamed:
            raise RegisterRefusalError(
                "unknown_model",
                f"{season} {source} at {', '.join(unnamed)} names no model version, so its claim cannot be frozen as anyone's.",
            )
        if role == "served" and not board_rows:
            raise RegisterRefusalError(
                "empty_served_board",
                f'The served board ("{SERVED_SOURCE}") holds no {season} rows at or before {js_iso(frozen_at)}, so there is no claim to freeze.',
            )
        coverage[source] = _coverage(board_rows)
        rows.extend(board_rows)
    shipped = [
        _freeze_row(season, week, frozen_at, entry, adp, ecr, props, yardsticks)
        for entry in shipped_board(conn, season, frozen_at)
    ]
    if shipped:
        coverage[SHIPPED_SOURCE] = _coverage(shipped)
    rows.extend(shipped)
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
    yardsticks: "Yardsticks",
) -> dict[str, Any]:
    stance = props.get(entry.player_id)
    espn_points = yardsticks.espn.get(entry.player_id)
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
        "published_points": yardsticks.published.get(entry.player_id),
        "model_version": entry.model_version,
        "espn_points": espn_points,
        "espn_read_at": None if espn_points is None else yardsticks.espn_read_at,
    }


def _record(conn: Connection, rows: Sequence[Mapping[str, Any]]) -> None:
    """`recordFreezeRows`: a plain insert, no conflict clause; a second claim at an instant is refused."""
    statement = text(
        "insert into research.register_freeze_rows (season, week, frozen_at, board_source, player_id, implementation, board_as_of, "
        "board_points, board_rank, board_value_rank, adp, ecr, props_points, props_markets, published_points, model_version, "
        "espn_points, espn_read_at) values (:season, :week, :frozen_at, :board_source, :player_id, :implementation, :board_as_of, :board_points, "
        ":board_rank, :board_value_rank, :adp, :ecr, :props_points, cast(:props_markets as jsonb), :published_points, :model_version, "
        ":espn_points, :espn_read_at)"
    )
    for row in rows:
        conn.execute(
            statement,
            {**row, "props_markets": None if row["props_markets"] is None else json.dumps(row["props_markets"])},
        )
