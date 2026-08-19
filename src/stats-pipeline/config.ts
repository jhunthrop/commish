/**
 * `final-only` fetches a final game's box score exactly once, ever; `live` never stops asking.
 *
 * The list is a value and not only a type because `STATS_INGESTION_MODE` is a boundary value:
 * `resolveIngestionSettings` (`./settings.ts`) validates against it and names every legal
 * spelling in its error, the same way `isStatsProviderName` does for `STATS_PROVIDER`.
 */
export const INGESTION_MODES = ["final-only", "live"] as const;

export type IngestionMode = (typeof INGESTION_MODES)[number];

export function isIngestionMode(value: string): value is IngestionMode {
  return (INGESTION_MODES as readonly string[]).includes(value);
}

/**
 * Every tunable the live stats ingestion pipeline has.
 */
export const STATS_INGESTION_CONFIG = {
  /**
   * `final-only` fetches a game's box score exactly once, the first tick it reports final.
   * `live` fetches every non-final game every tick.
   *
   * The default is `final-only` because it is the cheaper of the two by an order of magnitude,
   * and the plan states the arithmetic rather than hinting at it. The numbers below are the
   * LEDGER's numbers: what `RequestBudget.reserve()` actually debits, which since the two-phase
   * reservation landed is exactly what the tick spends upstream. A month is taken as 31 days of
   * uninterrupted ticking, because the worker runs on a timer and not on an NFL calendar.
   *
   * | Line item                                              | Arithmetic                                  | Requests per month |
   * |--------------------------------------------------------|---------------------------------------------|--------------------|
   * | Ticks per month                                        | 86,400,000 / 1,800,000 x 31 days            | 1,488 ticks        |
   * | Schedule calls, steady state (one examined week)       | 1 x 1,488                                   | 1,488              |
   * | Schedule calls, the second week on a rollover tick     | 1 x 5 week rollovers                        | 5                  |
   * | Box scores, `final-only` (each fetched once, ever)     | 16 games x 5 weeks                          | 80                 |
   * | The correction sweep (see `correctionWindowDays`)      | (1 schedule + 16 box scores) x 3 days x 5   | 255                |
   * | A sweep cut short by the live week, retried next tick  | 1 schedule x 3 days x 5                     | 15                 |
   * | **Ingestion total**                                    |                                             | **1,843**          |
   * | The season backfill (`npm run seed`)                   | see `reservedForBackfill`                   | 308                |
   * | **Everything**                                         |                                             | **2,151**          |
   *
   * The rollover line is one tick, not a tail: the tick that resumes at a week with no
   * `stat_weeks` row examines two weeks and PLANTS both rows, so the tick after it is narrow
   * again. The line that is NOT in this table is a wedged week's widened window, and that is
   * deliberate rather than an omission — `wedgedWeekTicks` is set longer than any week can
   * legitimately stay unsettled, so widening is an incident and not a term. See that field.
   *
   * `live` mode replaces the box-score line with "every game that is not final, every tick" —
   * roughly 16 games x 14 ticks across a Sunday's game window, about 900 a month on top of the
   * schedule calls, before Thursday and Monday night. It is a config change and no code change
   * (`STATS_INGESTION_MODE=live`), but it is NOT a free one: turning it on needs a quota, and
   * `STATS_MONTHLY_REQUEST_BUDGET` has to move with it. Both modes are tested; the mock provider
   * runs either at zero request cost.
   */
  mode: "final-only",
  /**
   * Ceiling per calendar month across every upstream call the pipeline makes — ingestion and
   * backfill together.
   *
   * This is a ceiling on what THIS deployment is allowed to spend, not a claim about what the
   * upstream account allows. Set `STATS_MONTHLY_REQUEST_BUDGET` to the purchased quota; if that
   * quota is smaller than this default the ledger will start denying partway through the month,
   * which is the correct and visible failure. The default is the arithmetic above (2,151) rounded
   * up to 3,000 for headroom — deliberately not the 1,000-request free tier, because a 24/7
   * worker at a 30-minute cadence cannot fit inside 1,000: 1,488 ticks a month at one schedule
   * call each is already 1,488 requests before a single box score is fetched.
   */
  monthlyRequestBudget: 3_000,
  /**
   * Held back from the ingestion budget so a full-season backfill (`npm run seed`) is never
   * starved by live polling. The measured cost of one backfill against Tank01's 18-week regular
   * season: 2 for `listPlayers` (the player list plus the teams call that mints team defenses),
   * then per week one `listGames` plus one box score per game, 18 x (1 + 16) = 306. Total 308.
   * `seedPlayers` reserves against this same monthly ledger through `reserveBackfill`, so the
   * two halves of the month's spending are counted in one place.
   */
  reservedForBackfill: 308,
  pollIntervalMs: 30 * 60_000,
  /**
   * The MAXIMUM weeks examined per tick. A tick scans forward from the earliest non-final week,
   * and only widens to the week after it when that earliest week has no `stat_weeks` row yet (a
   * cold start, or the first tick after a week rolled over) or when a week has wedged — see
   * `wedgedWeekTicks`. Steady state is therefore ONE schedule call per tick, not two, which is
   * the single largest line in the arithmetic above.
   */
  maxWeeksPerTick: 2,
  /**
   * How many consecutive ticks the earliest non-final week may stay un-advanceable before the
   * worker treats it as wedged: it logs loudly (rate-limited by `warnIntervalMs`) and WIDENS the
   * examination window to the wedged week plus a full window opening after it, so the season keeps
   * progressing while the wedge stays visible. Never skips the wedged week — a postponed game that
   * eventually gets played must still land.
   *
   * **This number is load-bearing for the arithmetic above, not a cosmetic threshold**, and it has
   * to be read against how long a week is legitimately un-advanceable rather than against how long
   * feels like a while. A week becomes the earliest non-final week the moment the previous week
   * settles (Monday night) and stays that way until its own last game ends (the following Monday
   * night): a full seven days, which at `pollIntervalMs` is **336 ticks**. A whole quiet stretch
   * inside that — every game `scheduled` from Tuesday to Thursday — is 96 to 144 ticks on its own.
   *
   * So 384 (eight days), not one day: anything shorter fires on every ordinary NFL week, and since
   * `trackWedge` only resets when the window opens on a different week, a threshold below 336 makes
   * the WIDENED window the steady state for most of the season. That would silently double the
   * dominant line in the request budget above — the projection assumes the window is one week wide
   * except at a rollover, and this is the tunable that assumption depends on.
   * `src/stats-pipeline/config.test.ts` asserts `wedgedWeekTicks > ticksPerDay * 7` so the premise
   * cannot drift away from the number that rests on it.
   */
  wedgedWeekTicks: 384,
  /**
   * How long after a week settles the worker keeps re-examining it for corrections. NFL official
   * scoring revisions run into the following week, and `final-only` records whatever the box
   * score said the first moment the provider called the game final — the earliest, least settled
   * version of it. The correction sweep re-fetches the most recent final week's box scores at
   * most once per calendar day for this many days after the week's `stat_weeks.updated_at`;
   * `persistTick` and `finalizeWeek` are already recompute-and-overwrite idempotent, so a landed
   * revision flows through the scores, the version, the caches and the standings by machinery
   * that already exists.
   */
  correctionWindowDays: 3,
  /** Ceiling on box scores fetched in one tick, so one tick cannot spend a week's budget. */
  maxGamesPerTick: 20,
  /**
   * Ceiling on late settlements per tick — weeks that were already final when a league finished
   * its draft, caught up afterwards. A league drafting in week 9 has eight weeks to settle; doing
   * them a few ticks apart keeps one tick's Postgres work bounded, and there is nothing time
   * critical about a week that has been over for a month.
   */
  maxSettlementsPerTick: 20,
  /** Minimum gap between two logs about the same stuck week, mirroring DRAFT_SERVICE_CONFIG.tickWarnIntervalMs. */
  warnIntervalMs: 60 * 60_000,
  keys: {
    snapshot: (week: number): string => `stats:snapshot:${week}`,
    budget: (month: string): string => `stats:budget:${month}`,
    finalGame: (gameId: string): string => `stats:game:${gameId}:final`,
    score: (leagueId: string, week: number): string => `score:${leagueId}:${week}`,
    playerIndex: "stats:players",
    scoringSettings: (leagueId: string): string => `stats:settings:${leagueId}`,
    /** The cross-instance tick lease. One key for the whole pipeline: a tick is the unit of work. */
    tickLease: "stats:tick-lease",
    /** `day` is a `YYYY-MM-DD` slice of the injected clock — one correction sweep per week per calendar day. */
    correctionSweep: (week: number, day: string): string => `stats:correction:${week}:${day}`,
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
    /** Two days, so a sweep marker outlives its calendar day in any timezone and then goes away on its own. */
    correctionSweep: 2 * 24 * 60 * 60,
  },
  envVars: {
    mode: "STATS_INGESTION_MODE",
    pollIntervalMs: "STATS_POLL_INTERVAL_MS",
    monthlyRequestBudget: "STATS_MONTHLY_REQUEST_BUDGET",
  },
} as const;
