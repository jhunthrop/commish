/**
 * Every tunable the live stats ingestion pipeline has.
 */
export const STATS_INGESTION_CONFIG = {
  /**
   * `final-only` fetches a game's box score exactly once, the first tick it reports final.
   * `live` fetches every non-final game every tick.
   *
   * The default is `final-only` because that is what the provider tier that exists today can
   * afford, and the plan states the arithmetic rather than hinting at it:
   *
   * | Cadence                                                                      | Requests per Sunday                          | Per month (4.3 weeks)          | Fits 1,000? |
   * |-------------------------------------------------------------------------------|-----------------------------------------------|---------------------------------|-------------|
   * | Poll every game every 5 minutes across a 10.5h Sunday                        | 126 polls x (1 schedule + ~10 live games) ~= 1,386 | ~5,960                     | No, by 6x   |
   * | Poll every game every 15 minutes                                             | 42 x 11 ~= 462                                 | ~1,990                          | No, by 2x   |
   * | Poll the schedule every 30 minutes, fetch each box score exactly once, when it first reports final | 24 schedule calls + 16 box scores = 40 | ~195 (with Thursday and Monday) | Yes, with room |
   *
   * `live` is a config change and no code change, so a paid tier turns it on. Both modes are
   * tested; the mock provider runs either at zero request cost.
   */
  mode: "final-only",
  /** Ceiling per calendar month across every upstream call the pipeline makes. */
  monthlyRequestBudget: 1_000,
  /** Held back from the ingestion budget so a full-season backfill (`npm run seed`) is never starved by live polling. */
  reservedForBackfill: 150,
  pollIntervalMs: 30 * 60_000,
  /** Weeks examined per tick. A tick scans forward from the newest non-final week, not the whole season. */
  maxWeeksPerTick: 2,
  /** Ceiling on box scores fetched in one tick, so one tick cannot spend a week's budget. */
  maxGamesPerTick: 20,
  /** Minimum gap between two logs about the same stuck week, mirroring DRAFT_SERVICE_CONFIG.tickWarnIntervalMs. */
  warnIntervalMs: 60 * 60_000,
  keys: {
    snapshot: (week: number): string => `stats:snapshot:${week}`,
    budget: (month: string): string => `stats:budget:${month}`,
    finalGame: (gameId: string): string => `stats:game:${gameId}:final`,
    score: (leagueId: string, week: number): string => `score:${leagueId}:${week}`,
    playerIndex: "stats:players",
    scoringSettings: (leagueId: string): string => `stats:settings:${leagueId}`,
  },
  ttlSeconds: {
    /** Generous: a snapshot outliving its week costs one key, losing one mid-Sunday costs a full recompute. */
    snapshot: 14 * 24 * 60 * 60,
    budget: 40 * 24 * 60 * 60,
    finalGame: 200 * 24 * 60 * 60,
    score: 7 * 24 * 60 * 60,
    /** Belt and braces only. The player index has an explicit invalidation path; this bounds how wrong a missed invalidation can get. */
    playerIndex: 6 * 60 * 60,
    scoringSettings: 6 * 60 * 60,
  },
  envVars: {
    mode: "STATS_INGESTION_MODE",
    pollIntervalMs: "STATS_POLL_INTERVAL_MS",
    monthlyRequestBudget: "STATS_MONTHLY_REQUEST_BUDGET",
  },
} as const;
