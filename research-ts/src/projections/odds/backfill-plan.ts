import type { OddsEvent } from "./http";

/**
 * THE PURE PLANNING LOGIC for the historical props backfill (props-backfill Task 1) — no network,
 * no database, fixture-driven. `scripts/odds-props-backfill.ts` is the only caller; every decision
 * that script makes about WHICH week to ask the API about, WHICH events belong to that week, WHICH
 * events to skip on a resumed run, and WHEN to stop spending credits lives here, testable against
 * plain fixtures rather than a live key and a live database.
 */

/**
 * How far before a week's own first kickoff the archived snapshot instant sits.
 *
 * Delegated design decision (task-1-brief.md): the brief asks for "something like first kickoff
 * minus 6-12 hours" and leaves the exact figure to this round. 8 hours is chosen -- comfortably
 * inside that range, and it reuses the same "8" this codebase already treats as its steady-state
 * weekly unit (`odds-props-snapshot.ts`'s own `WINDOW_DAYS` before it was widened for the
 * preseason gap). Sportsbooks post player-prop lines days ahead of kickoff, not hours, so 8 hours
 * is not chasing "the earliest possible line" -- it is chasing "reliably archived, strictly before
 * kickoff, deterministic," which is what a once-per-week historical snapshot needs.
 */
export const SNAPSHOT_OFFSET_HOURS = 8;

/** How many days past a week's first kickoff still belong to that week, for bucketing the season's
 *  whole event list (the historical `/events` endpoint returns MANY weeks at once -- see
 *  `scripts/odds-props-backfill.ts`'s own docblock). Covers a Thursday opener through the Monday
 *  night closer with a day of slack, and lands short of the following week's own opener (7 days
 *  later), so no event is ever double-counted into two weeks. */
export const WEEK_WINDOW_DAYS = 8;

export interface WeekSnapshotInstant {
  readonly week: number;
  readonly firstKickoff: Date;
  readonly snapshotAt: Date;
}

/**
 * One snapshot instant per week, `SNAPSHOT_OFFSET_HOURS` before that week's own first kickoff --
 * always STRICTLY before, by construction (subtracting a positive offset). Sorted by week ascending
 * so a caller iterating this list processes a season in game order.
 */
export function weekSnapshotInstants(kickoffsByWeek: ReadonlyMap<number, Date>): readonly WeekSnapshotInstant[] {
  return [...kickoffsByWeek.entries()]
    .sort(([weekA], [weekB]) => weekA - weekB)
    .map(([week, firstKickoff]) => ({
      week,
      firstKickoff,
      snapshotAt: new Date(firstKickoff.getTime() - SNAPSHOT_OFFSET_HOURS * 60 * 60 * 1000),
    }));
}

/**
 * Narrows a season's WHOLE event list (the historical `/events` endpoint returns every week at
 * once, verified live against the API -- a single call near week one's kickoff already listed every
 * game through week eighteen) down to the events that belong to ONE week: `[firstKickoff,
 * firstKickoff + WEEK_WINDOW_DAYS)`, inclusive of the lower bound, exclusive of the upper.
 */
export function eventsInWeekWindow(events: readonly OddsEvent[], firstKickoff: Date): readonly OddsEvent[] {
  const windowEnd = new Date(firstKickoff.getTime() + WEEK_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return events.filter((event) => event.commenceTime >= firstKickoff && event.commenceTime < windowEnd);
}

/**
 * THE RESUME/SKIP LOGIC. A prior run that stopped mid-season (the budget guard, or a crash) leaves
 * some events already archived and some not; re-running the script must never re-spend credits on
 * an event `player_prop_observations` already holds rows for. `alreadyArchivedEventIds` comes from
 * a single `SELECT DISTINCT event_id` the script runs once at start-up.
 */
export function eventsNeedingFetch(events: readonly OddsEvent[], alreadyArchivedEventIds: ReadonlySet<string>): readonly OddsEvent[] {
  return events.filter((event) => !alreadyArchivedEventIds.has(event.id));
}

/**
 * THE BUDGET GUARD. `usedThisRun` is real, header-measured spend (`x-requests-used` diffed against
 * the value at run start) -- never an estimate of what the NEXT call might cost. Checked before
 * every event-odds call; once it trips, the run stops and reports its own resume point rather than
 * spending past the operator's stated cap.
 */
export function hasBudgetRemaining(usedThisRun: number, budget: number): boolean {
  return usedThisRun < budget;
}
