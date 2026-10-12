/**
 * THE REFERENCE MEMOS (Neon cost audit 2026-09-07, finding 7): how long a warm instance may serve
 * a reference read that varies by week or season but never by user, before re-reading it. Each
 * TTL sits below its source's own refresh cadence, so a memo can only ever lag a write by less
 * than the write cadence itself — see `createTtlMemo` for why these are in-process.
 */
export const REFERENCE_MEMO_CONFIG = {
  /** Byes derive from the ingested schedule, which changes at most when a game is moved. */
  byeWeeksTtlMs: 60 * 60_000,
  /** A fixture's `when` flips to "Live" and "Final" as the worker ticks; a minute keeps that honest. */
  fixtureLabelsTtlMs: 60_000,
  /** The projections capture is harvested hourly (`HARVEST_CONFIG.cron`); five minutes of lag. */
  weeklyProjectionsTtlMs: 5 * 60_000,
} as const;
