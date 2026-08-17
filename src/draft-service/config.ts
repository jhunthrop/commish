export const DRAFT_SERVICE_CONFIG = {
  /** How often the server checks live drafts for an expired clock (ms). */
  tickIntervalMs: 1_000,
  /** Ceiling on drafts examined per tick, so one tick can't starve the event loop. */
  maxDraftsPerTick: 50,
  /**
   * Minimum gap between two `onOutcome` logs for the same stuck draft (ms). A draft whose
   * clock keeps failing to expire (e.g. a persistent sequence conflict) would otherwise log
   * once per tick — every second — forever. The first failure always logs immediately; after
   * that, at most one log per interval keeps a stuck draft visible without spamming.
   */
  tickWarnIntervalMs: 60_000,
} as const;
