import type { ParticipationTier } from "./tier";

/**
 * The wire shape `src/league-room/**` and `src/account-room/**` value-import — one account's
 * whole participation record, computed by `participationFor` (`@/league-service/participation`)
 * and never assembled twice. `completedSeasons` is carried alongside the derived `tier` and
 * `verified` fields rather than making a consumer re-derive either from the raw count, the same
 * "one source, never a second copy of the rule" discipline `participationTierFor` and
 * `isVerifiedPlayer` themselves exist to enforce.
 */
export interface ParticipationSummary {
  readonly completedSeasons: number;
  readonly tier: ParticipationTier;
  readonly verified: boolean;
}
