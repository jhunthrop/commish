/**
 * Module-local constants for the league service. `LEAGUE_CONFIG` (`@/league/config`) owns the
 * league's own tunables — how far out a draft is scheduled, how long an invite lives; this holds
 * what the SERVICE needs rather than what the season has: the unit conversion those day counts
 * are measured in, shared so `creation.ts` and `invites.ts` cannot drift on it, and the one bound
 * on the auto-set's own per-run scan.
 */
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The missed-deadline auto-set's own tunables (`./auto-lineup.ts`).
 */
export const AUTO_SET_CONFIG = {
  /**
   * Ceiling on leagues one run may touch, the sibling of `DRAFT_SERVICE_CONFIG.maxDraftsPerTick`
   * (50) and `STATS_INGESTION_CONFIG.maxSettlementsPerTick` (20) — final review F8 named its
   * absence, and the level-derived trigger (F2) is what makes a bound safe to have at all.
   *
   * 100, matching `INTEGRITY_CONFIG.trade.sweepBatchSize`, and the arithmetic stated rather than
   * hinted at: the candidate query returns only leagues that STILL have a team with no lineup row
   * for the week, so a league this run finishes drops out of the next run's page rather than
   * costing a slot of it. At `STATS_INGESTION_CONFIG.pollIntervalMs` (30 minutes) a backlog
   * therefore drains at 100 leagues per half hour, monotonically, with no bookkeeping — and the
   * common case is one run of well under the bound, because the only leagues in the page are the
   * ones a rollback or a crash left behind.
   */
  maxLeaguesPerRun: 100,
} as const;
