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
   * Storefront review E13: the ceiling on house leagues `ensureHouseCatalog`
   * (`@/league-service/house-factory`) may RETIRE (dissolve) in one reconcile — the surplus half
   * of the same "keep the shelf at `openAtOnce`" rule `maxHouseSpawnsPerRun` above already bounds
   * on the shortfall side. A small number on purpose: retirement runs the real operator
   * dissolution door (`dissolveLeague`, `@/money-service/dissolution`), a full transaction per
   * league, and the legacy surplus this exists to drain is a one-time, small population (six
   * pre-directive leagues at most, per rung) — never a scan this reconciler is expected to run
   * hot against in steady state.
   */
  maxHouseRetiresPerRun: 3,
  /**
   * How often `reconcileHouse` (Task 13, Step 6) actually runs, gated against the injected
   * clock rather than every tick: the ticker fires once a second and a shelf of house leagues
   * does not change that fast. Comfortably above one tick, comfortably below a minute — long
   * enough that the reconcile scan is not doing real work 60 times for every once it needs to.
   */
  houseReconcileIntervalMs: 30_000,
} as const;

/**
 * The serverless drivers' own knobs (draft-driver design, 2026-09-03; the draft-room performance
 * round, item 3, retired the SSE watcher loop): advance-on-read, the per-pick pacing job and the
 * minute-cron sweep all read from here — never a literal at a call site.
 */
export const DRAFT_ADVANCE_CONFIG = {
  /**
   * Ceiling on actions one `advance()` call may apply. Sized to carry the deepest realistic
   * backlog in one call — a fully abandoned 12-team, 15-round board is 180 expiries — while
   * still bounding a pathological loop; an exhausted call reports it and the next driver
   * (another read, the pacing job, the sweep) resumes from the log.
   */
  maxActionsPerAdvance: 200,
  /**
   * Sweep-wide ceiling on actions one `draft-sweep` job run may apply across ALL drafts, so a
   * minute tick's sweep can never outgrow the job runner's own budget. Level-triggered: work
   * left over is found by the next minute's fire.
   */
  sweepMaxActions: 600,
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
