export const DRAFT_SERVICE_CONFIG = {
  /** How often the server checks live drafts for an expired clock (ms). */
  tickIntervalMs: 1_000,
  /** Ceiling on drafts examined per tick, so one tick can't starve the event loop. */
  maxDraftsPerTick: 50,
} as const;
