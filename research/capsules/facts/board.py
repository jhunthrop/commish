"""THE SERVED BOARD AS A CAPSULE READS IT: the projected rows under the generic shape, in the order
the board is served, each with his identity, the market's numbers, his bye and the board's reasons.

Ported from `research-ts/src/board/service.ts` (`boardRows`, the projected half), `projections/
preseason/board-store.ts` (`preseasonProjectionsAsOf`, `boardReasons`), `projections/decide/board-
order-compare.ts` and `reference/nfl-schedule.ts` (`byeWeeksByTeam`). Market-order rows (kickers and
defenses) carry no projection and are never a capsule's subject; they are appended after the value
order and cannot move a projected row's rank, so only whether the board carries them is read here.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any, Final

from sqlalchemy import Connection, text

from research.model.decide.roster import KDEF_DECISION
from research.model.decide.slots import id_key
from research.model.decide.value import (
    LeagueShape,
    SeasonProjection,
    ValuedPlayer,
    tier_standings,
    tiers_of,
    value_board,
)
from research.model.domain import POSITIONS, STANDARD_ROSTER_SLOTS, Position

GENERIC_BOARD_SHAPE: Final = LeagueShape(12, STANDARD_ROSTER_SLOTS)
BOARD_SOURCE: Final = "commish_board_v9_ppr_12"
FANTASY_REGULAR_SEASON_WEEKS: Final = 14
# `KNOWN_REASON_CODES` (`board-reasons-store.ts`): a stored reason with any other code is dropped.
KNOWN_REASON_CODES: Final = frozenset(
    {
        "availability",
        "offseason_share_gained",
        "offseason_share_lost",
        "changed_team",
        "new_play_caller",
        "rookie",
        "scarcity",
        "tier_cliff",
        "law",
        "market_unlisted",
        "market_anchor",
        "roster_status",
    }
)


@dataclass(frozen=True, slots=True)
class BoardRow:
    """A projected row: what `factsInputFor` reads off `BoardRow`."""

    player_id: str
    nfl_player_id: str
    name: str
    position: Position
    team: str
    market_adp: float | None
    market_position_adp: str | None
    overall_rank: int
    value_rank: int
    projected_points: float
    floor_points: float
    median_points: float
    ceiling_points: float
    bye_week: int | None
    reasons: tuple[Mapping[str, Any], ...]
    value_over_replacement: float = 0.0
    # The drop behind his position tier, among the draft-relevant (above replacement); None below.
    drop_to_next_tier: float | None = None


def projections_as_of(
    conn: Connection, season: int, source: str, as_of: datetime, ids: Sequence[str] | None = None
) -> list[Any]:
    """`preseasonProjectionsAsOf` (or `preseasonProjectionsFor`, given ids): each player's newest row."""
    players = "" if ids is None else "and player_id = any(:ids)"
    return list(
        conn.execute(
            text(
                "select distinct on (player_id) player_id, rank, value_rank, projected_points, floor_points, median_points, "
                f"ceiling_points, as_of from research.preseason_projections where season = :season and source = :source "
                f"and as_of <= :as_of {players} order by player_id asc, as_of desc"
            ),
            {"season": season, "source": source, "as_of": as_of, "ids": None if ids is None else list(ids)},
        )
    )


def board_reasons(
    conn: Connection, season: int, source: str, player_ids: Sequence[str] | None = None
) -> dict[str, list[dict[str, Any]]]:
    """`boardReasons`: each player's reasons in the order the board stated them (revision 0003)."""
    players = "" if player_ids is None else "and player_id = any(:ids)"
    rows = conn.execute(
        text(
            "select player_id, code, payload from research.preseason_board_reasons where season = :season "
            f"and source = :source {players} order by player_id, ordinal"
        ),
        {"season": season, "source": source, "ids": None if player_ids is None else list(player_ids)},
    )
    out: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        if row.code in KNOWN_REASON_CODES:
            out.setdefault(row.player_id, []).append({"code": row.code, **row.payload})
    return out


def bye_weeks_by_team(conn: Connection, season: int) -> dict[str, int]:
    """`byeWeeksByTeam`: the one week in the fantasy regular season a team plays no game."""
    rows = conn.execute(
        text(
            "select week, home_team, away_team from research.provider_games where season = :s and week between 1 and :last"
        ),
        {"s": season, "last": FANTASY_REGULAR_SEASON_WEEKS},
    )
    played: dict[str, set[int]] = {}
    for r in rows:
        for team in (r.home_team, r.away_team):
            played.setdefault(team, set()).add(r.week)
    byes: dict[str, int] = {}
    for team, weeks in played.items():
        missing = [week for week in range(1, FANTASY_REGULAR_SEASON_WEEKS + 1) if week not in weeks]
        if len(missing) == 1:
            byes[team] = missing[0]
    return byes


def crosswalk_identities(conn: Connection, nfl_ids: Sequence[str]) -> dict[str, Any]:
    """`crosswalkIdentities`: each universe id's product player through the crosswalk."""
    if not nfl_ids:
        return {}
    rows = conn.execute(
        text(
            "select c.player_id as nfl_player_id, p.id, p.name, p.position, p.team, p.adp, p.pos_adp "
            "from research.player_crosswalk c join research.provider_players p on p.id = c.provider_player_id "
            "where c.player_id = any(:ids)"
        ),
        {"ids": list(nfl_ids)},
    )
    return {row.nfl_player_id: row for row in rows if row.nfl_player_id is not None}


def market_order_positions_on_board(conn: Connection) -> list[Position]:
    """The market-order positions the board carries a priced row for (`marketOrderRows`)."""
    market = [position for position in POSITIONS if KDEF_DECISION.get(position) == "market_order"]
    rows = conn.execute(
        text("select distinct position from research.provider_players where position = any(:p) and adp is not null"),
        {"p": market},
    )
    present = {row.position for row in rows}
    return [position for position in market if position in present]


def _tier_drops(board: Sequence[ValuedPlayer]) -> dict[str, float]:
    """The board service's position tiers: each position's above-replacement players, by points."""
    drops: dict[str, float] = {}
    for position in dict.fromkeys(player.position for player in board):
        relevant = [p for p in board if p.position == position and p.value_over_replacement > 0]
        points = [p.projected_points for p in relevant]
        for player, (_, drop) in zip(relevant, tier_standings(tiers_of(points), points), strict=True):
            drops[player.player_id] = drop
    return drops


def board_rows(conn: Connection, season: int, as_of: datetime) -> list[BoardRow]:
    """`boardRows` under the generic shape, the projected rows in served order."""
    projections = projections_as_of(conn, season, BOARD_SOURCE, as_of)
    if not projections:
        return []
    reasons = board_reasons(conn, season, BOARD_SOURCE)
    byes = bye_weeks_by_team(conn, season)
    identities = crosswalk_identities(conn, [row.player_id for row in projections])
    placed = [(row, identities[row.player_id]) for row in projections if row.player_id in identities]
    board = value_board(
        [SeasonProjection(row.player_id, identity.position, row.projected_points) for row, identity in placed],
        GENERIC_BOARD_SHAPE,
    )
    valued = {v.player_id: v for v in board}
    drops = _tier_drops(board)
    keyed: list[tuple[tuple[float, float, Any], BoardRow]] = []
    for row, identity in placed:
        vor = valued[row.player_id].value_over_replacement
        board_row = BoardRow(
            identity.id, row.player_id, identity.name, identity.position, identity.team, identity.adp, identity.pos_adp,
            0, row.value_rank, row.projected_points, row.floor_points, row.median_points, row.ceiling_points,
            byes.get(identity.team), tuple(reasons.get(row.player_id, [])), vor, drops.get(row.player_id),
        )  # fmt: skip
        adp = float("inf") if identity.adp is None else identity.adp
        keyed.append(((-vor, adp, id_key(identity.id)), board_row))
    keyed.sort(key=lambda pair: pair[0])
    return [replace(row, overall_rank=index + 1) for index, (_, row) in enumerate(keyed)]
