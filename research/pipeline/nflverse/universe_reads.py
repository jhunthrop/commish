"""Reads of the stored universe that several ingests gate on (`allPositions` in backtest.ts, and the
`knownPlayerIds` two-liners in injuries.ts, draft-picks.ts and roster-weeks.ts)."""

from sqlalchemy import Connection, select

from research.db.schema import PLAYERS
from research.pipeline.nflverse.players import Position, projected_position


def all_positions(conn: Connection) -> dict[str, Position]:
    """Every stored player the engine projects, with his projected position."""
    positions: dict[str, Position] = {}
    for player_id, position in conn.execute(select(PLAYERS.c.id, PLAYERS.c.position)):
        projected = projected_position(position)
        if projected is not None:
            positions[player_id] = projected
    return positions


def known_player_ids(conn: Connection) -> frozenset[str]:
    """Every id `players` holds: the foreign-key guard the archive tables need."""
    return frozenset(conn.execute(select(PLAYERS.c.id)).scalars())
