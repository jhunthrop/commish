import type { Position } from "@/domain/player";
import type { BoardReason } from "@/projections/preseason/board";
import { countWordCapitalized } from "../lib/format";

/**
 * THE VERDICT LINE (founder, 2026-09-04, Outlook redesign) — one deterministic sentence opening
 * the Outlook so a manager reads a VERDICT before he reads evidence. Before this, the Outlook had
 * no sentence that stated a conclusion at all; a reader had to add up a wall of chips himself to
 * learn whether the board thinks this man is a buy.
 *
 * DERIVED FROM `market_anchor` — the one reason that already states "what the market thinks" next
 * to "what the evidence says" (`board.ts`'s own docblock: `marketPoints + delta`). `tier_cliff`
 * (falling back to `scarcity`) supplies a SUPPORTING clause when present — never the main clause,
 * which is always about the market gap. In the SAME voice the Market surface's own edge sentences
 * use (`docs/superpowers/specs/2026-09-04-draft-hq-design.md` §Edges table: "Age 28.6 on the RB
 * curve costs -1.2 pts the market ignores") — plain, declarative, cites the number rather than
 * describing it.
 *
 * MISSING MARKET DATA gets a verdict from the evidence alone, never a blank: a player the board
 * ranked but the market never listed still has a position rank (`scarcity`) to state — "the
 * evidence makes him WR21. The market has not priced him" — and a player with neither gets the
 * honest last resort, "The evidence stands alone."
 *
 * NO REASONS AT ALL — the board never ranked him (a crosswalk miss, or no board this season) —
 * returns `null` rather than inventing a sentence from nothing; the caller renders no verdict line,
 * the same "absence means nothing to say" rule this engine keeps everywhere else.
 */

type MarketAnchorReason = Extract<BoardReason, { code: "market_anchor" }>;
type ScarcityReason = Extract<BoardReason, { code: "scarcity" }>;
type TierCliffReason = Extract<BoardReason, { code: "tier_cliff" }>;

/**
 * A delta smaller than this reads as noise, not a stated market gap — the same "a band, not a
 * hairline" idea `DRAFT_ROOM_CONFIG.verdict.evenBandPicks` already applies to a pick's own slip
 * (`draft-room/lib/verdict.ts`), sized here for a SEASON-POINTS delta rather than a pick count. A
 * product-tuned constant, named and in one place rather than a literal buried in the sentence
 * logic below.
 */
export const FAIR_PRICE_BAND_POINTS = 5;

function findReason<T extends BoardReason["code"]>(reasons: readonly BoardReason[], code: T): Extract<BoardReason, { code: T }> | undefined {
  return reasons.find((reason): reason is Extract<BoardReason, { code: T }> => reason.code === code);
}

/**
 * The tier clause, when the board found a real cliff below him — never built from `scarcity`
 * alone, which `marketGapClause`/the no-market branch already state on their own.
 *
 * IT STATES THE COUNT IT HAS (dossier-voice round §3.3, founder: "for every player we say 'last
 * man in his tier', that doesn't mean they shouldn't be drafted"). "Last man" is reserved for a
 * count of exactly one; every other count is spoken ("Two left in his tier before a 20.9 point
 * drop."). The clause is a SUPPORTING one in every branch below — `verdictLine` always leads with
 * the market call or the evidence's own rank and appends this after it, never the reverse.
 */
function tierClause(tierCliff: TierCliffReason | undefined): string | null {
  if (tierCliff === undefined) return null;
  const count = tierCliff.playersLeftInTier;
  const drop = tierCliff.dropToNextTier.toFixed(1);
  if (count === 1) return `He is the last man in his tier, with a ${drop} point drop behind him.`;
  return `${countWordCapitalized(count)} left in his tier before a ${drop} point drop.`;
}

function positionRankLabel(position: Position, scarcity: ScarcityReason): string {
  return `${position}${scarcity.positionRank}`;
}

/** The one sentence for a player the market DID price: fair, under, or over, by `delta` — the
 *  evidence's own season-points gap off `marketPoints`. */
function marketGapSentence(marketAnchor: MarketAnchorReason): string {
  const { delta } = marketAnchor;
  if (Math.abs(delta) < FAIR_PRICE_BAND_POINTS) {
    return `The market has him about right, within ${FAIR_PRICE_BAND_POINTS} points of the evidence.`;
  }
  const rounded = Math.abs(Math.round(delta));
  return delta > 0
    ? `The market is underpricing him. Our number says he is worth about ${rounded} more points than where he is going.`
    : `The market is overpricing him. Our number sits about ${rounded} points under his price, so let someone else pay it.`;
}

/** The one sentence for a player the market never priced at all — the evidence's own position
 *  rank (`scarcity`) when the board has one, otherwise the honest last resort. */
function noMarketSentence(position: Position, scarcity: ScarcityReason | undefined): string {
  if (scarcity === undefined) return "The market has not priced him. The evidence stands alone.";
  return `The evidence makes him ${positionRankLabel(position, scarcity)}. The market has not priced him.`;
}

/**
 * The written sentences this player's own capsule carries for the verdict, when the sweep produced
 * and validated them (`capsules/narrative-slots.ts`). Both optional and both independently absent:
 * a validated call with no tier sentence still leads, and the deterministic tier clause follows it.
 */
export interface WrittenVerdict {
  readonly call?: string | null;
  readonly tier?: string | null;
}

/**
 * The Outlook's own opening line — see this module's docblock for the full account of each
 * branch. `null` exactly when `reasons` is empty (the board never ranked this player at all).
 *
 * THE WRITTEN CALL LEADS WHEN THERE IS ONE (founder amendment 2026-09-07: every sentence on the
 * peek is written). `written.call` replaces the templated market sentence as the LEAD, and the
 * measured facts stay exactly where they were underneath it: the market gap is still stated, and
 * the tier clause still follows, so nothing measured leaves the page in exchange for voice.
 */
export function verdictLine(reasons: readonly BoardReason[], position: Position, written: WrittenVerdict = {}): string | null {
  if (reasons.length === 0) return null;

  const marketAnchor = findReason(reasons, "market_anchor");
  const scarcity = findReason(reasons, "scarcity");
  const tierCliff = findReason(reasons, "tier_cliff");
  const supporting = tierCliff === undefined ? null : (written.tier ?? tierClause(tierCliff));

  const stated = marketAnchor === undefined ? noMarketSentence(position, scarcity) : marketGapSentence(marketAnchor);
  const call = written.call ?? null;
  const base = call === null ? stated : `${call} ${stated}`;

  if (supporting !== null) return `${base} ${supporting}`;
  // No tier cliff: a priced player still gets his position rank stated, once, as the supporting
  // fact — the no-market branch already states it as the MAIN clause when it applies, so it is
  // never repeated here.
  if (marketAnchor !== undefined && scarcity !== undefined) return `${base} He sits ${positionRankLabel(position, scarcity)}.`;
  return base;
}
