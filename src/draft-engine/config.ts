/** The autopick policy is shared with the research core's decide layer and lives beside the roster
 *  rules it reads (`./autopick-policy`); the engine's config surface keeps exporting it. */
export { AUTOPICK_CONFIG, type DraftAutopickPolicy } from "@research/draft-engine/autopick-policy";

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

/**
 * 8h → 4h → 1h → 10m → 1:30, per the strategy doc's auto-tightening schedule. The floor is
 * the live draft-night pace: 90 seconds is enough to act on a plan (the queue) and short
 * enough to keep twelve people leaning in — a founder call (2026-08-18) over the original 60s.
 */
export const DRAFT_CLOCK_SCHEDULE: readonly ClockTier[] = [
  { untilHoursBeforeKickoff: 168, pickSeconds: 8 * 60 * 60 },
  { untilHoursBeforeKickoff: 48, pickSeconds: 4 * 60 * 60 },
  { untilHoursBeforeKickoff: 12, pickSeconds: 60 * 60 },
  { untilHoursBeforeKickoff: 2, pickSeconds: 10 * 60 },
  { untilHoursBeforeKickoff: 0, pickSeconds: 90 },
];

/**
 * The overnight freeze: while the current tier's pick clock is `appliesAtOrAbovePickSeconds`
 * or longer, a deadline that would land between `startHour` and `endHour` LOCAL time in `zone`
 * is pushed past it (`pause.ts`'s `deadlineAfter`) — the courtesy FFPC and Underdog both give a
 * slow draft, applied only where a deadline is COMPUTED (selectors, never the reducer; see
 * `pause.ts`'s own docblock for why).
 */
export interface PauseWindow {
  /** IANA zone name. Every hour below is read in this zone, never the host's own. */
  readonly zone: string;
  /** Local hour the freeze starts, inclusive. */
  readonly startHour: number;
  /** Local hour the freeze ends, exclusive. */
  readonly endHour: number;
  /** The room is awake below this tier's pick length, so the freeze never applies to it —
   *  the 90-second (or 10-minute) floor never strands eleven managers to protect one asleep. */
  readonly appliesAtOrAbovePickSeconds: number;
}

/**
 * Underdog's ladder, which `DRAFT_CLOCK_SCHEDULE` above already mirrors — 2 AM to 5 AM ET,
 * and only once a pick clock has reached an hour or longer (the 1h/4h/8h tiers; never the
 * 10m/90s floor a draft runs at near kickoff).
 */
export const DRAFT_PAUSE_WINDOW: PauseWindow = {
  zone: "America/New_York",
  startHour: 2,
  endHour: 5,
  appliesAtOrAbovePickSeconds: 60 * 60,
};

/**
 * The skip-and-owe allowance (Task 5): NFFC's forgiveness for a manager who never set a
 * queue. Read ONLY by `reduceSnakeExpiry` (`snake.ts`) — a REDUCER, not a command-time guard
 * like `DRAFT_PAUSE_WINDOW` — so it cannot travel the way `pauseWindow`/`clockSchedule` do
 * (re-read fresh from `loadDraftConfig` on every load). A deploy that changed the allowance
 * mid-draft would otherwise change what an already-persisted TIMER_EXPIRE did the next time
 * that log replayed. Instead this is snapshotted onto the `START_DRAFT` action itself
 * (`StartDraftAction.skipPolicy`, `@research/domain/draft`), the same way `AUCTION_CONFIG.minBid`
 * already is, and `reduceStart` copies it into `DraftConfig.skipPolicy` — the value baked into
 * that one draft's own history, forever.
 */
export interface DraftSkipPolicy {
  /** How many picks a team may owe at once before a further stall autopicks instead of skipping. */
  readonly maxOwedPerTeam: number;
  /** The room is awake below this tier's pick length, so a skip never applies to it — the
   *  90-second (or 10-minute) floor a live room runs at near kickoff always autopicks. */
  readonly appliesAtOrAbovePickSeconds: number;
}

/** One owed pick, ever, per team — Underdog's own ceiling — and only at the hour-or-longer tiers. */
export const DRAFT_SKIP_POLICY: DraftSkipPolicy = {
  maxOwedPerTeam: 1,
  appliesAtOrAbovePickSeconds: 60 * 60,
};

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
