// THE ROOM'S OWN READ OF TASK 9'S GRADES (Task 10) — one indexed scan (`draft_grades_draft_idx`)
// joined to `teams` for the display name `GradeBoard` needs beside each letter. The stored rows
// themselves are `draft-grades-job.ts`'s own write, computed once at draft completion; this
// module only ever reads them back, never recomputes a grade.
import { asc, eq } from "drizzle-orm";
import type { Db } from "@research-ts/db/client";
import { draftGrades, teams } from "@/db/schema";
import type { LeagueGradeRow } from "@/league-room/contract";

export interface DraftGradesRead {
  /** Every team's grade, ordered by `projectedRank` ascending (the board's own ranking) — a
   *  courtesy ordering, not a contract: `GradeBoard` re-sorts by the same field defensively
   *  rather than trusting read order. */
  readonly grades: readonly LeagueGradeRow[];
  /** The evidence board's own `asOf` stamp every row in `grades` was computed against
   *  (`draft_grades.board_generation`) — one value for the whole draft, since `gradeDraft` runs
   *  once against one board snapshot. `null` for an empty `grades` (nothing to have a generation). */
  readonly boardGeneration: string | null;
}

const EMPTY_READ: DraftGradesRead = { grades: [], boardGeneration: null };

/**
 * Every stored grade for one REAL completed draft, or `EMPTY_READ` for a draft the grades job
 * has not written yet (a mock draft, never runs it at all; a real one, the write races the very
 * first page load in the seconds after commit) — `RoomData.grades`'s own docblock names both
 * gaps. Never called for a league with `draftGradesVisible` off; `room-data.ts` is the one place
 * that gate is checked, so this function trusts the draft id it is handed.
 */
export async function gradesForDraft(db: Db, draftId: string): Promise<DraftGradesRead> {
  const rows = await db
    .select({
      teamId: draftGrades.teamId,
      teamName: teams.name,
      letter: draftGrades.letter,
      components: draftGrades.components,
      projectedRank: draftGrades.projectedRank,
      boardGeneration: draftGrades.boardGeneration,
    })
    .from(draftGrades)
    .innerJoin(teams, eq(teams.id, draftGrades.teamId))
    .where(eq(draftGrades.draftId, draftId))
    .orderBy(asc(draftGrades.projectedRank));

  if (rows.length === 0) return EMPTY_READ;

  const grades: readonly LeagueGradeRow[] = rows.map((row) => ({
    teamId: row.teamId,
    teamName: row.teamName,
    letter: row.letter,
    components: row.components,
    projectedRank: row.projectedRank,
  }));
  return { grades, boardGeneration: rows[0]!.boardGeneration };
}
