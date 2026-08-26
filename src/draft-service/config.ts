export const DRAFT_SERVICE_CONFIG = {
  /** How often the server checks live drafts for an expired clock (ms). */
  tickIntervalMs: 1_000,
  /**
   * Ceiling on drafts examined per tick, so one tick can't starve the event loop. Shared by both
   * of the ticker's scans (the in-progress expiry scan, and Task 7's `autoStartDueDrafts` —
   * `@/draft-service/auto-start`) rather than each getting its own number: both run on the same
   * cadence against the same connection pool, and a second ceiling to keep in step with this one
   * would be a config value with no independent reason to differ.
   */
  maxDraftsPerTick: 50,
  /**
   * Minimum gap between two `onOutcome` logs for the same stuck draft (ms). A draft whose
   * clock keeps failing to expire (e.g. a persistent sequence conflict) would otherwise log
   * once per tick — every second — forever. The first failure always logs immediately; after
   * that, at most one log per interval keeps a stuck draft visible without spamming.
   */
  tickWarnIntervalMs: 60_000,
  /**
   * Phase 3.5 addendum, Task 13: the ceiling on house leagues `ensureHouseCatalog`
   * (`@/league-service/house-factory`) may spawn in one reconcile — following `maxDraftsPerTick`
   * above and `AUTO_SET_CONFIG.maxLeaguesPerRun` (`@/league-service/config`), the same "no scan
   * this codebase runs is unbounded" precedent. `HOUSE_CATALOG`'s three rungs sum to 2 open
   * leagues total today (founder directive 2026-08-26 dropped the shelf from 6; `sitandgo_12`
   * itself is retired to `openAtOnce: 0`), so this ceiling is headroom for a cold-start reconcile
   * plus lost-race retries, never a limit the shelf is expected to brush against in ordinary
   * operation.
   */
  maxHouseSpawnsPerRun: 20,
  /**
   * How often `reconcileHouse` (Task 13, Step 6) actually runs, gated against the injected
   * clock rather than every tick: the ticker fires once a second and a shelf of house leagues
   * does not change that fast. Comfortably above one tick, comfortably below a minute — long
   * enough that the reconcile scan is not doing real work 60 times for every once it needs to.
   */
  houseReconcileIntervalMs: 30_000,
} as const;

export const DRAFT_NUDGE_CONFIG = {
  /**
   * The spec's `DRAFT_NUDGE_THRESHOLD_PCT`: how far through the current turn's clock the
   * moderator waits before speaking up. Never written as a literal at a call site.
   */
  thresholdPct: 75,
  /** Ceiling on the model call before we fall back to the static reminder. */
  llmTimeoutMs: 2_000,
  /** One short sentence, not an essay. */
  maxTokens: 120,
  /** Longest nudge we will broadcast. Anything longer is discarded for the static reminder. */
  maxCopyChars: 200,
} as const;
