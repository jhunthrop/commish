"""THE KICKERS AND DEFENSES, IN DRAFT ORDER (Lane 66m).

The 2026-09-05 ruling (`docs/research/2026-09-05-kicker-defense-preregistration-results.md`,
`KDEF_DECISION`): neither position passed its gates, so both ship in market order, labelled, with no
projected points and no tier, and a position in market order shows only the players the market has an
opinion about. Every board carries them after its ranked rows: every kicker and team defense on the
provider's roster that the board's own ADP feed prices (`RunFormat.adp`, the ADP its rows print, so the
order and the ADP column never disagree), in that draft order, ties by provider id. Each position
counts its own place from 1. The room's board takes the same order from the same capture
(`api/internal/boards/market.go`); `api/testdata/market-order.json` holds both to it.

The September ingest priced kickers and defenses from the PPR feed alone (`ingest_kdef_adp`); every
feed's capture prices them now (2026-09-09: PPR 20 kickers and 26 defenses, half PPR 16 and 16,
standard 16 and 15), so each board reads its own.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from sqlalchemy import Connection, text

from research.model.domain import Position
from research.nightly.config import MARKET_POSITIONS


@dataclass(frozen=True, slots=True)
class MarketPlayer:
    player_id: str  # the provider id, the product's player id
    name: str
    position: Position  # "K" or "DEF"
    team: str
    headshot_url: str | None


@dataclass(frozen=True, slots=True)
class MarketEntry:
    player: MarketPlayer
    # The ADP that placed him.
    draft_adp: float
    position_rank: int
    # His place among every board's market rows, 1 first.
    order: int


def market_players(conn: Connection) -> list[MarketPlayer]:
    """Every kicker and team defense on the provider's roster."""
    rows = conn.execute(
        text(
            "select id, name, position, team, headshot_url from research.provider_players "
            "where position = any(:positions) order by id"
        ),
        {"positions": list(MARKET_POSITIONS)},
    )
    return [MarketPlayer(r.id, r.name, r.position, r.team, r.headshot_url or None) for r in rows]


def market_order(players: Sequence[MarketPlayer], adp: Mapping[str, float]) -> tuple[MarketEntry, ...]:
    """The players `adp` prices (the board's own feed, by provider id), in its draft order, ties by id.
    A player the drafts do not take is not on the board."""
    priced = sorted((adp[p.player_id], p.player_id, p) for p in players if p.player_id in adp)
    counts: dict[str, int] = {}
    entries = []
    for order, (draft_adp, _, player) in enumerate(priced, start=1):
        counts[player.position] = counts.get(player.position, 0) + 1
        entries.append(MarketEntry(player, draft_adp, counts[player.position], order))
    return tuple(entries)
