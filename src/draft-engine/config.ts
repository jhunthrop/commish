/**
 * One tier of the auto-tightening pick clock. A tier applies while the draft is more than
 * `untilHoursBeforeKickoff` hours from kickoff; tiers are ordered farthest-out first, and
 * the last tier is the floor that applies at (and after) kickoff.
 *
 * This is the direct answer to Apex's 5-day email draft (strategy doc §1.1, §4): schedule
 * flexibility without ever leaving a live room.
 */
export interface ClockTier {
  readonly untilHoursBeforeKickoff: number;
  readonly pickSeconds: number;
}

/** 8h → 4h → 1h → 10m → 60s, per the strategy doc's named schedule. */
export const DRAFT_CLOCK_SCHEDULE: readonly ClockTier[] = [
  { untilHoursBeforeKickoff: 168, pickSeconds: 8 * 60 * 60 },
  { untilHoursBeforeKickoff: 48, pickSeconds: 4 * 60 * 60 },
  { untilHoursBeforeKickoff: 12, pickSeconds: 60 * 60 },
  { untilHoursBeforeKickoff: 2, pickSeconds: 10 * 60 },
  { untilHoursBeforeKickoff: 0, pickSeconds: 60 },
];

export const DRAFT_QUEUE_CONFIG = {
  /**
   * Longest queue a team may store. Bounds both the jsonb action row and the reorder UI;
   * a queue is a shortlist, not a mirror of the whole pool.
   */
  maxLength: 50,
} as const;

/**
 * Ceiling for the PERSISTED `SET_QUEUE` action row (`draftActionSchema`, the jsonb boundary),
 * kept deliberately separate from `DRAFT_QUEUE_CONFIG.maxLength` (the client-submission
 * tunable). Every `draft_actions` row ever written was validated against this number at
 * write time; if it were tied to the tunable and someone later lowered `maxLength`, those
 * older rows would stop parsing on replay and the draft would become unloadable. Never
 * decrease this value — only ever raise it, and only as a deliberate, documented migration.
 *
 * `DRAFT_QUEUE_CONFIG.maxLength <= PERSISTED_QUEUE_MAX` is asserted by a test
 * (`action-schema.test.ts`) rather than a module-load throw here: a throw's failing branch
 * can never be exercised by a passing test suite, which would cost this file the 100%
 * branch-coverage gate `src/draft-engine` is held to.
 */
export const PERSISTED_QUEUE_MAX = 100;

export const AUCTION_CONFIG = {
  /** Lowest legal opening bid, in whole dollars. */
  minBid: 1,
  /** Minimum raise over the standing high bid. League-configurable later; never a literal. */
  bidIncrement: 1,
  /** How long a live bidding window stays open after the latest bid, in seconds. */
  bidWindowSeconds: 15,
  /** Dollars a team must keep in reserve for each roster spot it still has to fill. */
  reservePerOpenSlot: 1,
} as const;

/**
 * Tunables for the serialized view, as opposed to the rules. `upcomingCount` is how far ahead
 * `DraftClockView.upcoming` looks — long enough that a manager in a 12-team league can always
 * see themselves in the queue, short enough that it costs nothing on every event payload.
 */
export const DRAFT_VIEW_CONFIG = {
  upcomingCount: 12,
} as const;
