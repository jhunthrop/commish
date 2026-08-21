/**
 * What a browse card is allowed to say about who is already in a league: two counts, never a
 * member. `PublicLeagueSummary` (`@/matchmaking/contract`) is the privacy boundary of this
 * product's one unauthenticated read — a composition is an aggregate over the league's seated
 * managers, and a list of who is a newcomer would be a roster of strangers' inexperience
 * published to anybody holding the URL.
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
 */
export function compositionCategoryFor(composition: TierComposition): CompositionCategory {
  if (composition.veterans === 0) {
    return composition.newcomers === 0 ? "open" : "all_newcomers";
  }
  return composition.newcomers > composition.veterans ? "mostly_newcomers" : "open";
}
