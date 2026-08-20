import type { DraftFormat } from "@/domain/league";
import type { ExperienceTier } from "@/domain/user";

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
}

/** A normalized browse filter: every field is a concrete value or the "any" sentinel. */
export interface BrowseFilter {
  readonly format: DraftFormat | "any";
  readonly experienceTier: ExperienceTier | "any";
  readonly stakeTier: number | "any";
}

export interface BrowseBody {
  readonly leagues: readonly PublicLeagueSummary[];
}
