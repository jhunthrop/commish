/**
 * TIER STANDINGS FOR THE POOL ROWS — "Tier 2, 5 of 6 left", from the games-worth tiers our board
 * already draws (`tiersOf`, `@research-ts/projections/decide/tiers`). Tiers are drawn over the FULL board at
 * each position, drafted players included, so a tier's size is a fact about the board and "left"
 * is what the room has not taken from it yet. A position the board ships in market order
 * (`shipsProjectedRows` false: the kicker and team defence decision) has no projected points to
 * draw a tier from, so it gets no entry rather than a number nobody measured.
 */
import type { Position } from "@research-ts/domain/player";
import { availablePool, draftedPlayerIds, type DraftState } from "@/draft-engine";
import { tiersOf } from "@research-ts/projections/decide/tiers";
import { shipsProjectedRows } from "@research-ts/projections/preseason/kdef-decision";
import type { ValuedEntry } from "./recommend";
import type { TierStandingView } from "./view";

function byPosition(valued: ReadonlyMap<string, ValuedEntry>): ReadonlyMap<Position, readonly ValuedEntry[]> {
  const groups = new Map<Position, ValuedEntry[]>();
  for (const entry of valued.values()) {
    if (!shipsProjectedRows(entry.position)) continue;
    groups.set(entry.position, [...(groups.get(entry.position) ?? []), entry]);
  }
  return new Map([...groups].map(([position, entries]) => [position, [...entries].sort((a, b) => b.projectedPoints - a.projectedPoints || a.playerId.localeCompare(b.playerId))]));
}

/** Every undrafted player in the room's pool at a projected position -> his tier standing. */
export function tierStandings(state: DraftState, valued: ReadonlyMap<string, ValuedEntry>): Readonly<Record<string, TierStandingView>> {
  const drafted = draftedPlayerIds(state);
  const inPool = new Set(availablePool(state).map((entry) => entry.playerId));
  const out: Record<string, TierStandingView> = {};
  for (const entries of byPosition(valued).values()) {
    const tiers = tiersOf(entries.map((entry) => entry.projectedPoints));
    const size = new Map<number, number>();
    const left = new Map<number, number>();
    entries.forEach((entry, index) => {
      const tier = tiers[index]!;
      size.set(tier, (size.get(tier) ?? 0) + 1);
      if (!drafted.has(entry.playerId)) left.set(tier, (left.get(tier) ?? 0) + 1);
    });
    entries.forEach((entry, index) => {
      if (!inPool.has(entry.playerId)) return;
      const tier = tiers[index]!;
      out[entry.playerId] = { tier: tier + 1, left: left.get(tier) ?? 0, size: size.get(tier) ?? 0 };
    });
  }
  return out;
}
