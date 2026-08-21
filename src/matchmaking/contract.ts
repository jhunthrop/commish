import type { DraftFormat } from "@/domain/league";
import type { ExperienceTier } from "@/domain/user";
import type { TierComposition } from "@/participation/composition";
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
 * `tierComposition` is the SAME kind of exception, and for the same reason `scoringLabel` is:
 * `leagueTierComposition` (`@/league-service/participation`) already reduces a league's whole
 * membership down to two counts before this field is ever assembled, so what reaches the wire is
 * an aggregate over the league, never a fact about any one person in it — the same "two counts,
 * never a member" discipline `TierComposition`'s own docblock (`@/participation/composition`)
 * states.
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
  /** Two counts, never a member — see this interface's own docblock. */
  readonly tierComposition: TierComposition;
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
