import type { Position } from "@research/domain/player";
import type { ProjectionDistribution } from "./outlook";
import type { ValuedPlayer } from "./replacement";

/**
 * WHERE WE DISAGREE WITH THE MARKET, AND WHY.
 *
 * A SLEEPER IS NOT A GOOD PLAYER. It is a player the market has MISPRICED, which makes this a
 * disagreement metric and means it cannot exist without both numbers: our board and a market
 * price. Ranking somebody highly is not a claim about anybody but ourselves, and a list of men we
 * like is not a list of edges. The engine spec makes the same distinction about benchmarks:
 * beating the market is the commercial claim, and you cannot beat something you never measured
 * yourself against.
 *
 * DISAGREEMENT IS MEASURED IN RATIOS, NOT IN RANKS. Thirty places at the top of a board is an
 * enormous claim and thirty places at 300 is rounding, because what a pick costs is roughly
 * geometric in where it falls. `log(marketRank / ourRank)` says "we have him twice as high" the
 * same way wherever it happens.
 *
 * AN UNEXPLAINED DISAGREEMENT IS DISCOUNTED, and this is the honest half of the feature.
 * Unexplained disagreement with a market of thousands of drafters is usually OUR error rather
 * than theirs. A cause has to come from the features the model already computed - vacated
 * opportunity not yet repriced, a play-caller change, efficiency suppressed by a line or a
 * quarterback that has since improved, draft capital far above current usage - and it is passed
 * IN. Nothing here may invent one, which is the structural reason causes are an argument rather
 * than something this module derives: a reason written at this layer would be a reason nobody
 * measured.
 *
 * UPSIDE COMES FROM THE DISTRIBUTION, NOT THE MEAN. The honest claim about a sleeper is "his
 * ceiling far exceeds his cost", never "he will score more" - if we were confident he would score
 * more, he would simply be higher on the board and there would be nothing to say. With no
 * distribution the claim is `null` rather than approximated, because approximating it is exactly
 * the "bolted-on guess" the spec's layer 3 exists to avoid.
 */

/** What the market says a player costs. Ours from the house's own drafts, or a feed's. */
export interface MarketPrice {
  readonly playerId: string;
  readonly averageDraftPosition: number;
}

/**
 * The causes a disagreement is allowed to have. Each maps to a feature the engine computes
 * somewhere else; this union is a vocabulary, not an implementation.
 */
export type SleeperCauseKind =
  | "vacated_opportunity"
  | "play_caller_change"
  | "line_improved"
  | "quarterback_improved"
  | "draft_capital_above_usage";

export interface SleeperCause {
  readonly playerId: string;
  readonly kind: SleeperCauseKind;
  /** The feature it was read off, so a reviewer can go and look at the same number. */
  readonly feature: string;
  readonly magnitude: number;
}

export interface SleeperInput {
  /** Our board, valued through `valueBoard`. */
  readonly board: readonly ValuedPlayer[];
  readonly market: readonly MarketPrice[];
  readonly causes?: readonly SleeperCause[];
  readonly distributions?: ReadonlyMap<string, ProjectionDistribution>;
  readonly limit?: number;
}

export interface Sleeper {
  readonly playerId: string;
  readonly position: Position;
  readonly ourRank: number;
  readonly marketRank: number;
  /** `log(marketRank / ourRank)`. How much higher we have him, as a ratio. */
  readonly disagreement: number;
  /** The disagreement after an unexplained one is discounted. The list is ordered by this. */
  readonly score: number;
  readonly causes: readonly SleeperCause[];
  /**
   * How far his ninetieth percentile clears the value of the man our own board would give you at
   * his market price. `null` when no distribution was supplied, because the claim cannot be made
   * without one.
   */
  readonly ceilingAbovePrice: number | null;
}

/**
 * We must have him at least half again as high as the market does. Below that the two boards are
 * arguing about ordering rather than about price, and every projection disagrees with every other
 * projection at that resolution.
 */
export const MIN_DISAGREEMENT = Math.log(1.5);

/**
 * A full round in a twelve-team league. The ratio gate alone would let the top of the board
 * through on nothing: having a man second where the market has him third is a 1.5x ratio and is
 * not a disagreement about anything. Both gates, always.
 */
export const MIN_RANK_GAP = 12;

/** What an unexplained disagreement keeps. Half, because it is as likely to be our error. */
export const UNEXPLAINED_SHARE = 0.5;

/** As many as a manager can act on in one sitting. */
export const DEFAULT_SLEEPER_LIMIT = 15;

function ranksBy<T>(rows: readonly T[], key: (row: T) => string, order: (a: T, b: T) => number): ReadonlyMap<string, number> {
  return new Map([...rows].sort(order).map((row, index) => [key(row), index + 1]));
}

/**
 * The value our own board would hand you at a given draft slot. This is what a pick COSTS, priced
 * in the only currency the board has, so "his ceiling exceeds his cost" is a subtraction rather
 * than a figure of speech.
 */
function valueAtDraftSlot(board: readonly ValuedPlayer[], slot: number): number {
  const index = Math.min(Math.max(Math.round(slot), 1), board.length) - 1;
  return board[index]!.valueOverReplacement;
}

export function sleepers({
  board,
  market,
  causes = [],
  distributions,
  limit = DEFAULT_SLEEPER_LIMIT,
}: SleeperInput): readonly Sleeper[] {
  const ourRanks = ranksBy(
    board,
    (player) => player.playerId,
    (a, b) => b.valueOverReplacement - a.valueOverReplacement || a.playerId.localeCompare(b.playerId),
  );
  const marketRanks = ranksBy(
    market,
    (price) => price.playerId,
    (a, b) => a.averageDraftPosition - b.averageDraftPosition || a.playerId.localeCompare(b.playerId),
  );
  const causesByPlayer = new Map<string, SleeperCause[]>();
  for (const cause of causes) {
    const existing = causesByPlayer.get(cause.playerId);
    if (existing === undefined) causesByPlayer.set(cause.playerId, [cause]);
    else existing.push(cause);
  }
  const byValue = [...board].sort(
    (a, b) => b.valueOverReplacement - a.valueOverReplacement || a.playerId.localeCompare(b.playerId),
  );

  const found: Sleeper[] = [];
  for (const player of board) {
    const marketRank = marketRanks.get(player.playerId);
    // No market price, no disagreement. Silently valuing him against his own rank would make
    // every player we like a sleeper, which is the failure this whole metric is defined against.
    if (marketRank === undefined) continue;
    const ourRank = ourRanks.get(player.playerId)!;
    if (marketRank - ourRank < MIN_RANK_GAP) continue;
    const disagreement = Math.log(marketRank / ourRank);
    if (disagreement < MIN_DISAGREEMENT) continue;

    const playerCauses = causesByPlayer.get(player.playerId) ?? [];
    const outlook = distributions?.get(player.playerId);
    found.push({
      playerId: player.playerId,
      position: player.position,
      ourRank,
      marketRank,
      disagreement,
      score: playerCauses.length > 0 ? disagreement : disagreement * UNEXPLAINED_SHARE,
      causes: playerCauses,
      ceilingAbovePrice:
        outlook === undefined
          ? null
          : outlook.ceiling - player.replacementLevel - valueAtDraftSlot(byValue, marketRank),
    });
  }

  return found
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.ceilingAbovePrice ?? 0) - (a.ceilingAbovePrice ?? 0) ||
        a.playerId.localeCompare(b.playerId),
    )
    .slice(0, limit);
}
