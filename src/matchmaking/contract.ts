import type { DraftFormat } from "@/domain/league";
import type { ExperienceTier } from "@/domain/user";
import type { CompositionCategory } from "@/participation/composition";
import type { ParticipationTier } from "@/participation/tier";

/**
 * TYPES ONLY, no runtime code.
 *
 * `PublicLeagueSummary` IS the privacy boundary of public browse, written once: this is the
 * complete set of facts an UNAUTHENTICATED visitor may learn about a league they are not in.
 * Adding a field here is a deliberate disclosure decision, and
 * `src/league-service/browse.test.ts` fails if the wire body ever carries a key this interface
 * does not name.
 *
 * Deliberately absent, and each for a reason: the commissioner's identity and any team or
 * owner name (a stranger has no business learning who plays here), the invite code (a
 * membership capability), the draft id (a gated room), and standings, rosters and chat (all
 * member-only reads today, and there is no reason browse should be the hole in that).
 *
 * `scoringLabel` is the one deliberate exception to "scoring settings stay member-only": it is
 * a DERIVED label (`describeScoring`, `@/scoring`), never the fifteen raw weights, and it is a
 * property of the league being advertised, not of any person in it. A manager cannot evaluate
 * whether to join a league without knowing how it scores, so withholding it would not be
 * privacy, it would just be a worse card. See `browse.ts`'s docblock and the commit that added
 * this field for the fuller reasoning.
 *
 * `compositionCategory` is the SAME kind of exception, and for the same reason `scoringLabel` is:
 * it is a DERIVED bucket, one of three coarse phrases, never the counts it was derived from. Final
 * review F6 is why it is the bucket and not the counts: this field used to be a
 * `{ newcomers, veterans }` pair reduced to its bucket client-side, and an aggregate over N=1 is
 * not an aggregate — at `filledTeams: 1` the raw pair discloses that one manager's computed
 * participation tier to anybody holding the URL, and polling across joins discloses each new
 * member's tier as a delta. The reduction now happens server-side, so the coarse-label discipline
 * is a wire boundary rather than a rendering convention.
 *
 * `draftAt` (Phase 3 Plan D, Task 6) is the tenth field and the newest disclosure decision: a
 * draft's scheduled time is a scheduling fact about the LEAGUE, not about any person in it, and
 * a visitor who can't see it can't tell whether they are free to attend before they join
 * (ruling 15) — exactly the reasoning `scoringLabel` and `compositionCategory` already established
 * for this interface. Formatted by the SAME `formatDraftTime` (`@/league/terms`) `leagueTerms`
 * calls for `LeagueTerms.draftAt`, so the sentence a stranger reads on a browse card and the one
 * a prospect reads on the invite preview can only ever agree.
 *
 * A stranger gets what they need to CHOOSE a league and nothing about the people already in it.
 */
export interface PublicLeagueSummary {
  readonly id: string;
  readonly name: string;
  readonly format: DraftFormat;
  readonly experienceTier: ExperienceTier;
  /** A cosmetic tier index — see `MATCHMAKING_CONFIG.stakeTiers`. Never an amount of money. */
  readonly stakeTier: number;
  readonly teamCount: number;
  readonly filledTeams: number;
  /** Derived from the league's scoring weights (`describeScoring`) — never the raw weights. */
  readonly scoringLabel: string;
  /** One of three coarse buckets, never the counts behind it — see this interface's own docblock. */
  readonly compositionCategory: CompositionCategory;
  /** Absolute-plus-relative, e.g. "Saturday 12 September, 7:00 PM UTC (in 3 days)" — see this
   *  interface's own docblock. */
  readonly draftAt: string;
}

/** A normalized browse filter: every field is a concrete value or the "any" sentinel. */
export interface BrowseFilter {
  readonly format: DraftFormat | "any";
  readonly experienceTier: ExperienceTier | "any";
  readonly stakeTier: number | "any";
  /**
   * A DIFFERENT axis from `experienceTier` above, on purpose — see `src/participation/tier.ts`'s
   * own docblock on the third meaning of "tier". `experienceTier` is a commissioner's
   * self-declared label for who a league is FOR; this is a computed fact about who is already
   * IN it, and the two can disagree (a commissioner who declares "beginner" for a league three
   * veterans already filled).
   */
  readonly participationTier: ParticipationTier | "any";
}

export interface BrowseBody {
  readonly leagues: readonly PublicLeagueSummary[];
}
