/**
 * The two counts a league's seated managers reduce to, SERVER-SIDE ONLY (final review F6).
 *
 * THIS SHAPE NEVER CROSSES THE PUBLIC WIRE, and the reasoning is arithmetic rather than taste: an
 * aggregate over N=1 is not an aggregate. A public league with one filled seat and
 * `{ newcomers: 1, veterans: 0 }` discloses that one manager's computed participation tier to
 * anybody holding the URL, and polling the session-less endpoint across joins discloses each new
 * member's tier as a delta. Both are facts about a PERSON, which is exactly what
 * `PublicLeagueSummary` (`@/matchmaking/contract`), the privacy boundary of this product's one
 * unauthenticated read, exists to keep out.
 *
 * `compositionCategoryFor` (below) reduces this to one of three coarse buckets, and only that
 * bucket ships. The reduction used to happen client-side, which made the coarse-label discipline a
 * rendering convention rather than a wire boundary; `listPublicLeagues` (`@/league-service/browse`)
 * now performs it before the summary is assembled, and `browse.test.ts` asserts at the wire that
 * neither count ever serializes.
 */
export interface TierComposition {
  readonly newcomers: number;
  readonly veterans: number;
}

/**
 * Builds a `TierComposition` from the two counts a caller has already derived — a named
 * constructor rather than a bare object literal at every call site, so a future third tier (there
 * is no reason to expect one, but `PARTICIPATION_TIERS` is the vocabulary, not a promise) changes
 * one function instead of every call site that assembles this shape by hand.
 */
export function tierCompositionFor(input: { readonly newcomers: number; readonly veterans: number }): TierComposition {
  return { newcomers: input.newcomers, veterans: input.veterans };
}

/**
 * The three buckets a browse card is allowed to say out loud — an exhaustive `Record`, the same
 * shape `PARTICIPATION_TIER_LABEL` (`./tier`) already uses, over a union derived from a
 * `readonly` tuple rather than a raw ratio. Deliberately NOT symmetric with `ParticipationTier`:
 * there is no "mostly veterans" or "all veterans" phrase, because the composition label exists to
 * answer one question — "will I be the only beginner here" — and a newcomer weighing that
 * question needs a warning exactly when newcomers are NOT the majority, never a special phrase
 * for how thoroughly they are outnumbered. `compositionCategoryFor` below is the one place that
 * turns two counts into one of these three.
 */
export const COMPOSITION_CATEGORIES = ["all_newcomers", "mostly_newcomers", "open"] as const;

export type CompositionCategory = (typeof COMPOSITION_CATEGORIES)[number];

/** Never a raw ratio and never a percentage — a browse card is a decision aid, and "7 of 12
 *  veterans" is a statistic a visitor has to interpret. */
export const TIER_COMPOSITION_LABEL: Readonly<Record<CompositionCategory, string>> = {
  all_newcomers: "All newcomers",
  mostly_newcomers: "Mostly newcomers",
  open: "Open to everyone",
};

/**
 * THE THRESHOLDS, in the one place they live. A league with no seated managers yet reads
 * `"open"` rather than `"all_newcomers"` — nothing about an empty roster has actually signalled
 * newcomer-friendliness, and claiming otherwise would be a promise the league has not earned. A
 * league with at least one veteran reads `"all_newcomers"` only if it truly has zero; otherwise
 * the two counts are compared directly, `>` rather than `>=`, so an even split reads `"open"`
 * rather than leaning either way it cannot actually justify.
 *
 * `matchesBrowseFilter`'s `participationTier` narrowing (`@/matchmaking/filter`) is built on the
 * SAME comparison (`newcomers > veterans`) rather than a second copy of it, so the filter and the
 * label a visitor reads can never disagree about the same league.
 *
 * A SPARSE league (one seated manager out of twelve) reads exactly as confidently
 * `"all_newcomers"` as a nearly-full one — deliberately, not a gap: `public-league-list.tsx`
 * always renders this label beside `"1 of 12 joined"`, and that adjacent count is what tells a
 * visitor how much the composition label should weigh, which is the whole reason this function
 * itself never reaches for a ratio or a sample-size caveat of its own (this file's own docblock).
 * A future reader who wants to "fix" a one-seat league reading as confidently as an eleven-seat
 * one should read `public-league-list.tsx`'s card layout first.
 */
export function compositionCategoryFor(composition: TierComposition): CompositionCategory {
  if (composition.veterans === 0) {
    return composition.newcomers === 0 ? "open" : "all_newcomers";
  }
  return composition.newcomers > composition.veterans ? "mostly_newcomers" : "open";
}
