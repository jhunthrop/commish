import { eq } from "drizzle-orm";
import type { DbTx, ReadonlyDb } from "@/db/client";
import { matchups, weeks } from "@/db/schema";
import { generateSchedule, LEAGUE_CONFIG, seasonProgress } from "@/league";

export interface WriteScheduleInput {
  readonly leagueId: string;
  /** In a stable order — the schedule is a pure function of it (usually `state.draftOrder`). */
  readonly teamIds: readonly string[];
  readonly weeks: number;
}

export interface WrittenScheduleCounts {
  readonly weeks: number;
  readonly matchups: number;
}

/**
 * Persists a generated season inside the caller's transaction.
 *
 * Idempotent by primary key: both inserts are `onConflictDoNothing`, so
 * `commitDraftResults`' defensive re-run — or a crash between the two inserts — costs a
 * repeat, never a duplicate. A schedule that can't be built (a league with one team) writes
 * nothing rather than throwing: the draft that produced it is still legitimately complete.
 *
 * Imports only `@/db/*`, `@/league` and Drizzle, which is what keeps `draft-service` →
 * `league-service` a one-way edge rather than a cycle.
 */
export async function writeSchedule(tx: DbTx, input: WriteScheduleInput): Promise<WrittenScheduleCounts> {
  const schedule = generateSchedule({ leagueId: input.leagueId, teamIds: input.teamIds, weeks: input.weeks });
  if (!schedule.ok) {
    console.warn("[league] schedule not written", { leagueId: input.leagueId, reason: schedule.reason });
    return { weeks: 0, matchups: 0 };
  }

  await tx.insert(weeks).values([...schedule.weeks]).onConflictDoNothing();
  await tx.insert(matchups).values([...schedule.matchups]).onConflictDoNothing();
  return { weeks: schedule.weeks.length, matchups: schedule.matchups.length };
}

/**
 * THE one server-side answer to "what week is this league living in", read from the database.
 *
 * It defines nothing: `seasonProgress`/`currentWeekNumber` (`@/league/schedule`) is the single
 * definition — the earliest unscored week, or the last week once the season is in the books — and
 * this is only the read that feeds it, so `leagueHome`, `crossLeagueHome` and every trade writer
 * all answer the same number from the same rule rather than each carrying a second opinion. A
 * `matchups` row IS the source: a week is over when a commissioner's scores are in, never when a
 * wall clock says so.
 *
 * Takes a `ReadonlyDb`, so `acceptTrade` can call it on its own `tx` and get the week as it
 * stands INSIDE the transaction that is about to move rosters, not a snapshot read before it.
 *
 * A league with no schedule yet answers week 1 — `currentWeekNumber`'s own documented floor, not
 * a fallback invented here.
 */
export async function currentWeekOf(db: ReadonlyDb, leagueId: string): Promise<number> {
  const rows = await db.select().from(matchups).where(eq(matchups.leagueId, leagueId));
  return seasonProgress(rows, LEAGUE_CONFIG.regularSeasonWeeks).currentWeek;
}
