/**
 * Module-local constants for the league service. `LEAGUE_CONFIG` (`@/league/config`) owns the
 * league's tunables — how far out a draft is scheduled, how long an invite lives; this holds
 * only the unit conversion those day counts are measured in, shared so `creation.ts` and
 * `invites.ts` cannot drift on it.
 */
export const MS_PER_DAY = 24 * 60 * 60 * 1000;
