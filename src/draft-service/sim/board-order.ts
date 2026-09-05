/**
 * THE ROOM'S OWN BOARD — the one thing "room sharpness" (spec §5) actually changes.
 *
 * `chooseBotPick` (`@/mock-draft/bots`) is never modified or forked here: it samples from
 * whatever order `state.pool` (`START_DRAFT`'s own frozen ranking) holds, restricted to what is
 * still available. This module builds THAT ordering, once per simulated draft, so every bot in
 * the room shares one board the way a real room's consensus emerges from many people trusting
 * roughly the same rankings — sharpness is a property of the ROOM's board, not of any one bot's
 * brain, which is exactly the spec's own framing ("bot policy mix", never a new archetype).
 *
 * `sharpness` (0 casual to 1 sharp) blends two real rankings — the evidence board's own order
 * (`BOARD_SOURCE`'s `projectedPoints`, high to low) and the market's own order (`players.adp`,
 * low to high) — and adds jitter that shrinks to nothing as the room gets sharper: a casual room
 * drafts close to what the market already believes, with real reaches; a sharp room drafts close
 * to the evidence board, with almost none. See `SIM_CONFIG.casualJitterRankSpread`'s own docblock
 * for why the jitter is a documented simple model rather than a measured one.
 */
import type { DraftPoolEntry } from "@/domain/draft";
import type { Rng } from "@/mock-draft/rng";
import { SIM_CONFIG } from "./config";

/** One player, as the sim's board-order builder needs to see them: real evidence rank (always
 *  present, since only board-ranked players ever reach the sim's pool) and real market rank
 *  (absent for a player the market feed never ranked at all — the deep bench). */
export interface SimRankableEntry extends DraftPoolEntry {
  /** 0-based rank by the evidence board's own `projectedPoints`, best player first. */
  readonly evidenceRank: number;
  /** 0-based rank by market ADP (`players.adp`, lower ADP first), or null when the market feed
   *  never ranked this player — he is priced by evidence rank alone at every sharpness. */
  readonly marketRank: number | null;
}

/**
 * One player's blended rank score (lower drafts sooner), before jitter: a straight linear
 * interpolation between the two real orderings. A player with no market rank is anchored to his
 * own evidence rank on both ends of the blend, so a missing market number never pulls him toward
 * rank zero.
 */
function baseBlendRank(entry: SimRankableEntry, sharpness: number): number {
  const marketRank = entry.marketRank ?? entry.evidenceRank;
  return sharpness * entry.evidenceRank + (1 - sharpness) * marketRank;
}

/**
 * The room's shared board for one simulated draft: every entry from `pool`, reordered by
 * `sharpness`'s blend plus one jittered draw per player from `rng` (so two runs of the identical
 * config, different seeds, field rooms with genuinely different reaches). Ties resolve to
 * `playerId` so the ordering is reproducible for a fixed seed regardless of input array order.
 */
export function simBoardOrder(pool: readonly SimRankableEntry[], sharpness: number, rng: Rng): readonly DraftPoolEntry[] {
  const jitterSpread = (1 - sharpness) * SIM_CONFIG.casualJitterRankSpread;
  const scored = pool.map((entry) => ({
    entry,
    // A jitter draw of 0 is dead center: `(rng.next() - 0.5) * 2 * spread` spans
    // `[-spread, +spread]`, symmetric around the blended rank so jitter can move a player
    // earlier or later with equal chance.
    score: baseBlendRank(entry, sharpness) + (rng.next() - 0.5) * 2 * jitterSpread,
  }));
  scored.sort((a, b) => a.score - b.score || a.entry.playerId.localeCompare(b.entry.playerId));
  return scored.map(({ entry }) => ({ playerId: entry.playerId, position: entry.position }));
}
