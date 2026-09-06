/**
 * THE ROOM'S OWN BOARD — what every seat EXCEPT the one being measured drafts from.
 *
 * FOUNDER RULING, 2026-09-05: "It should use ADP to draft against and our board to pick with."
 * The room is the market. Bots draft in ADP order, because that is what a real room's consensus
 * actually is, and the seat being measured drafts from our own board (`value-order.ts`, threaded
 * through `simulate.ts`). Our board is NEVER blended into the room's order: if it were, the sim
 * would be measuring our board against itself and the survival odds it reports would be a claim
 * about our own opinion rather than about the market a real drafter sits in.
 *
 * `chooseBotPick` (`@/mock-draft/bots`) is never modified or forked here: it samples from
 * whatever order the state's pool holds, restricted to what is still available. This module
 * builds THAT ordering, once per simulated draft, so every bot in the room shares one board.
 *
 * `sharpness` (0 casual to 1 sharp) is now purely NOISE AROUND THE MARKET, not a blend: it sets
 * how far a room strays from ADP. A casual room reaches, a sharp room takes the market in order.
 * See `SIM_CONFIG.casualJitterRankSpread`'s own docblock for why the jitter is a documented
 * simple model rather than a measured one.
 */
import type { DraftPoolEntry } from "@/domain/draft";
import type { Rng } from "@/mock-draft/rng";
import { SIM_CONFIG } from "./config";

/** One player, as the sim's board-order builder needs to see them: real market rank (absent for
 *  a player the market feed never ranked at all — the deep bench) and our own board's rank, used
 *  ONLY to order that deep bench among itself. */
export interface SimRankableEntry extends DraftPoolEntry {
  /** 0-based rank on our board (`value-order.ts`: value over replacement under the sim's league
   *  shape), best player first. */
  readonly evidenceRank: number;
  /** 0-based rank by market ADP (`players.adp`, lower ADP first), or null when the market feed
   *  never ranked this player. */
  readonly marketRank: number | null;
}

/**
 * The room's shared board for one simulated draft: every entry from `pool` in market order, each
 * market rank jittered by one draw from `rng` (so two runs of the identical config, different
 * seeds, field rooms with genuinely different reaches).
 *
 * A player the market never ranked sorts after every player it did, since the room cannot reach
 * for a name its own consensus has never priced. Those players hold our board's order among
 * themselves, which is the only ordering left that is not arbitrary. Ties resolve to `playerId`
 * so the ordering is reproducible for a fixed seed regardless of input array order.
 */
export function simBoardOrder(pool: readonly SimRankableEntry[], sharpness: number, rng: Rng): readonly DraftPoolEntry[] {
  const jitterSpread = (1 - sharpness) * SIM_CONFIG.casualJitterRankSpread;
  const scored = pool.map((entry) => {
    // Drawn for every player, ranked or not, so the stream a seed produces does not depend on
    // how much of this pool the market happens to cover.
    const jitter = (rng.next() - 0.5) * 2 * jitterSpread;
    return entry.marketRank === null
      ? { entry, unpriced: 1, score: entry.evidenceRank }
      : { entry, unpriced: 0, score: entry.marketRank + jitter };
  });
  scored.sort((a, b) => a.unpriced - b.unpriced || a.score - b.score || a.entry.playerId.localeCompare(b.entry.playerId));
  return scored.map(({ entry }) => ({ playerId: entry.playerId, position: entry.position }));
}
