"""THE KICKERS AND DEFENSES, IN DRAFT ORDER (Lane 66m).

The 2026-09-05 ruling (`docs/research/2026-09-05-kicker-defense-preregistration-results.md`,
`KDEF_DECISION`): neither position passed its gates, so both ship in market order, labelled, with no
projected points and no tier. Every board carries them after its ranked rows: every kicker and team
defense on the provider's roster (the API's board names the same players, `api/internal/boards`), in
the draft order of the board's own ADP feed (`RunFormat.adp`, the ADP its rows print, so the order
and the ADP column never disagree), a player those drafts do not take after the ones they do, by
provider id. Each position counts its own place from 1.

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
    # The ADP that placed him, None for a player the order's board does not price.
    draft_adp: float | None
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
    """The players in draft order: by `adp` (the order's board, by provider id), then the unpriced by id."""

    def key(player: MarketPlayer) -> tuple[bool, float, str]:
        found = adp.get(player.player_id)
        return (found is None, 0.0 if found is None else found, player.player_id)

    counts: dict[str, int] = {}
    entries = []
    for order, player in enumerate(sorted(players, key=key), start=1):
        counts[player.position] = counts.get(player.position, 0) + 1
        entries.append(MarketEntry(player, adp.get(player.player_id), counts[player.position], order))
    return tuple(entries)
