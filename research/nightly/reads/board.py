"""ONE FORMAT'S BOARD AS THE RUN PRINTS IT: the stored board's newest generation, valued under the
format's roster shape, in the board service's served order.

Ported from `research-ts/src/board/service.ts` (`boardRows`, the projected half), as the capsules'
`capsules.facts.board` reads it, so the PPR board's order, value and tier drops are the ones the
capsule writer saw. The points (projection, floor, median, ceiling, expected games) are the stored
board's own; what the shape changes is the draft-value half: value over replacement, the order, the
position rank and the tiers (`model.decide.value`).

TIERS ACROSS THE WHOLE BOARD (spec §9, "board-wide tiers"). The service draws tiers only among the
players above replacement and leaves the rest without one. A board page shows every player, so the
players at or below replacement get tiers too: the same rule (`tiers_of`) drawn over them on their
own, numbered after the last tier above replacement. The tiers above replacement, and every drop a
capsule quotes, are the service's exactly.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import Connection, text

from research.model.decide.slots import id_key
from research.model.decide.value import (
    LeagueShape,
    SeasonProjection,
    ValuedPlayer,
    tier_standings,
    tiers_of,
    value_board,
)
from research.model.domain import Position
from research.nightly.config import TEAMS, RunFormat
from research.pipeline.jscompat import CollationKey


@dataclass(frozen=True, slots=True)
class StoredBoard:
    source: str
    as_of: datetime
    model_version: str | None
    arithmetic: str | None


@dataclass(frozen=True, slots=True)
class StoredRow:
    """A stored board row joined to the product's player through the crosswalk."""

    universe_id: str
    player_id: str  # the provider id, the product's player id
    name: str
    position: Position
    team: str
    headshot_url: str | None
    market_adp: float | None  # the provider's ADP, the served order's tiebreak (`compareBoardOrder`)
    projected: float
    # None in season: the rest-of-season board gives no range (`nightly.build.ros`).
    floor: float | None
    median: float | None
    ceiling: float | None
    expected_games: float


@dataclass(frozen=True, slots=True)
class BoardEntry:
    row: StoredRow
    value_over_replacement: float
    position_rank: int
    tier: int
    # The drop to the next tier among the players above replacement, as the service states it; None
    # for a player at or below replacement.
    drop_to_next_tier: float | None
    our_rank: int
    # In season, the preseason board's own entry for him (its rank and points, and the numbers his
    # capsule was written about); None on a preseason board.
    preseason: "BoardEntry | None" = None


@dataclass(frozen=True, slots=True)
class FormatBoard:
    format: RunFormat
    stored: StoredBoard
    entries: tuple[BoardEntry, ...]


def stored_board(conn: Connection, season: int, source: str, as_of: datetime) -> StoredBoard | None:
    """The newest generation of `source` at or before `as_of`, with the model that made it."""
    row = conn.execute(
        text(
            "select as_of, min(model_version) as model_version, min(arithmetic) as arithmetic "
            "from research.preseason_projections where season = :s and source = :source and as_of = ("
            "select max(as_of) from research.preseason_projections where season = :s and source = :source and as_of <= :a"
            ") group by as_of"
        ),
        {"s": season, "source": source, "a": as_of},
    ).first()
    return None if row is None else StoredBoard(source, row.as_of, row.model_version, row.arithmetic)


def stored_rows(conn: Connection, season: int, board: StoredBoard) -> list[StoredRow]:
    rows = conn.execute(
        text(
            "select p.player_id, p.projected_points, p.floor_points, p.median_points, p.ceiling_points, "
            "p.expected_games, pp.id, pp.name, pp.position, pp.team, pp.headshot_url, pp.adp "
            "from research.preseason_projections p "
            "join research.player_crosswalk c on c.player_id = p.player_id "
            "join research.provider_players pp on pp.id = c.provider_player_id "
            "where p.season = :s and p.source = :source and p.as_of = :a"
        ),
        {"s": season, "source": board.source, "a": board.as_of},
    )
    return [_stored_row(r) for r in rows]


def _stored_row(r: Any) -> StoredRow:
    return StoredRow(
        r.player_id,
        r.id,
        r.name,
        r.position,
        r.team,
        r.headshot_url,
        r.adp,
        r.projected_points,
        r.floor_points,
        r.median_points,
        r.ceiling_points,
        r.expected_games,
    )


def board_tiers(valued: Sequence[ValuedPlayer]) -> dict[str, tuple[int, float | None]]:
    """Each player's tier (1 is the top) and the drop behind it, position by position: the
    service's tiers above replacement, then the same rule over the rest, numbered after them."""
    out: dict[str, tuple[int, float | None]] = {}
    for position in dict.fromkeys(player.position for player in valued):
        pool = sorted((p for p in valued if p.position == position), key=lambda p: p.position_rank)
        above = [p for p in pool if p.value_over_replacement > 0]
        rest = [p for p in pool if p.value_over_replacement <= 0]
        offset = 0
        for group, quoted in ((above, True), (rest, False)):
            points = [p.projected_points for p in group]
            tiers = tiers_of(points)
            for player, tier, (_, drop) in zip(group, tiers, tier_standings(tiers, points), strict=True):
                out[player.player_id] = (offset + tier + 1, drop if quoted else None)
            offset += max(tiers, default=-1) + 1
    return out


def _served_order(row: StoredRow, valued: ValuedPlayer) -> tuple[float, float, CollationKey]:
    """`compareBoardOrder`: value over replacement, then the market's ADP, then the id."""
    adp = float("inf") if row.market_adp is None else row.market_adp
    return (-valued.value_over_replacement, adp, id_key(row.player_id))


def format_board(conn: Connection, season: int, run_format: RunFormat, as_of: datetime) -> FormatBoard | None:
    """The format's board at `as_of`, or None when no generation of its source is stored."""
    board = stored_board(conn, season, run_format.board_source, as_of)
    if board is None:
        return None
    return FormatBoard(run_format, board, board_entries(stored_rows(conn, season, board), run_format))


def board_entries(
    rows: Sequence[StoredRow], run_format: RunFormat, preseason: Mapping[str, BoardEntry] | None = None
) -> tuple[BoardEntry, ...]:
    """Rows valued under the format's shape, in the served order, ranked and tiered; `preseason`
    (by universe id) links each in-season entry to his preseason one."""
    valued = value_board(
        [SeasonProjection(row.universe_id, row.position, row.projected) for row in rows],
        LeagueShape(TEAMS, run_format.slots),
    )
    by_id = {player.player_id: player for player in valued}
    tiers = board_tiers(valued)
    ordered = sorted(rows, key=lambda row: _served_order(row, by_id[row.universe_id]))
    return tuple(
        BoardEntry(
            row,
            by_id[row.universe_id].value_over_replacement,
            by_id[row.universe_id].position_rank,
            *tiers[row.universe_id],
            rank,
            None if preseason is None else preseason[row.universe_id],
        )
        for rank, row in enumerate(ordered, start=1)
    )
