import type { DbTx } from "@/db/client";
import { matchups, weeks } from "@/db/schema";
import { generateSchedule } from "@/league";

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
