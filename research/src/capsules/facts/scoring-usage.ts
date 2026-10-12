import type { Position } from "@research/domain/player";
import { rankWithinGroups, type RankableStat, type RankedStat } from "../rank";
import type { PlayerFactsScoringUsage } from "./types";

/**
 * SCORING-RANGE USAGE, IN COUNTS (spec §4, fact 9; inventory row 9).
 *
 * The sheet already carries a red-zone SHARE of his own touches, which answers "what fraction of
 * his work happened near the goal line" and cannot answer "how much work near the goal line did he
 * get". A back with eight red-zone touches and a back with thirty-six can have identical shares,
 * and only one of them is a touchdown bet. These are the counts, plus the one rate that separates a
 * field stretcher from a checkdown back.
 *
 * THE SOURCE IS THE PLAY-BY-PLAY THE MODEL ALREADY FITS ON (`nflverse_pbp_player`, the same metric
 * keys `model/red-zone-fit.ts` and `model/target-depth-fit.ts` take as their own input), so nothing
 * here is a new derivation. It is the same rows those fits consume, summed per season rather than
 * shrunk toward a league prior.
 *
 * THE RANK POPULATION IS THE PEERS WITH A REAL READING OF THE SAME QUANTITY, per position — the
 * identical qualifier `collect.ts`'s own `rankedDiscoveryQuantity` documents, and the reason
 * `qualifierCount` is on the rendered sentence: "RB1 among 48 qualifying backs" names the real N.
 *
 * A ZERO IS A READING; A MISSING PLAYER IS NOT. A player the play-by-play placed but who never got
 * a red-zone touch has a real zero and is ranked with it. A player the feed never placed at all is
 * absent from the tallies entirely and gets `null`, because a zero he never earned would rank him
 * against men who did.
 */

/** One player's season sums, straight off `player_week_observations` source `nflverse_pbp_player`. */
export interface ScoringTally {
  readonly redZoneCarries: number;
  readonly redZoneTargets: number;
  readonly insideTenCarries: number;
  readonly insideTenTargets: number;
  readonly airYards: number;
  readonly airYardTargets: number;
}

/** Average intended air yards per target that carried a readable one. `null` on a zero denominator:
 *  a ratio over no targets is not a number, and an infinity on a fact sheet is a bug the writer
 *  would faithfully quote. */
function targetDepthOf(tally: ScoringTally): number | null {
  if (tally.airYardTargets <= 0) return null;
  return Math.round((tally.airYards / tally.airYardTargets) * 10) / 10;
}

/** One quantity, ranked within each position over the peers that have a real reading of it. */
function rankQuantity(
  tallies: ReadonlyMap<string, ScoringTally>,
  positions: ReadonlyMap<string, Position>,
  names: ReadonlyMap<string, string>,
  select: (tally: ScoringTally) => number | null,
): ReadonlyMap<string, RankedStat> {
  const byPosition = new Map<Position, RankableStat[]>();
  for (const [playerId, tally] of tallies) {
    const position = positions.get(playerId);
    const value = select(tally);
    if (position === undefined || value === null) continue;
    const entry: RankableStat = { playerId, name: names.get(playerId) ?? playerId, value };
    const list = byPosition.get(position);
    if (list === undefined) byPosition.set(position, [entry]);
    else list.push(entry);
  }
  return rankWithinGroups(byPosition);
}

/** Every player's scoring-range usage for one season, ranked. */
export function scoringUsageFor(
  season: number,
  tallies: ReadonlyMap<string, ScoringTally>,
  positions: ReadonlyMap<string, Position>,
  names: ReadonlyMap<string, string>,
): ReadonlyMap<string, PlayerFactsScoringUsage> {
  const redZone = rankQuantity(tallies, positions, names, (t) => t.redZoneCarries + t.redZoneTargets);
  const insideTen = rankQuantity(tallies, positions, names, (t) => t.insideTenCarries + t.insideTenTargets);
  const depth = rankQuantity(tallies, positions, names, targetDepthOf);

  const out = new Map<string, PlayerFactsScoringUsage>();
  for (const playerId of tallies.keys()) {
    const usage: PlayerFactsScoringUsage = {
      season,
      redZoneTouches: redZone.get(playerId) ?? null,
      insideTenTouches: insideTen.get(playerId) ?? null,
      targetDepth: depth.get(playerId) ?? null,
    };
    if (usage.redZoneTouches === null && usage.insideTenTouches === null && usage.targetDepth === null) continue;
    out.set(playerId, usage);
  }
  return out;
}
