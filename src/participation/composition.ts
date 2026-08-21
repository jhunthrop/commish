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
