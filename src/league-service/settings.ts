// LEAGUE SETTINGS (Task 10) — the commissioner's own control over `leagues.draft_grades_visible`.
// One field today; a future toggle joins this module rather than growing a second settings file,
// the same "one write module per concern" shape `draft-schedule.ts` and `invites.ts` each hold.
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { leagues } from "@/db/schema";

export interface SetDraftGradesVisibleInput {
  readonly leagueId: string;
  readonly visible: boolean;
}

/**
 * Flips whether this league's draft grades show on league home. `withCommissioner`
 * (`@/app/api/leagues/_shared`) is the WHOLE authorization boundary here — the same
 * trust-the-route shape `createInvite` (`./invites`) already uses for its own commissioner-only
 * write, since this function writes exactly the one league the route already scoped the caller
 * to. No state-machine gate either: unlike a draft's kickoff time, this toggle has no "too late
 * to change" moment — a commissioner may turn grades on or off at any point in the season.
 */
export async function setDraftGradesVisible(db: Db, input: SetDraftGradesVisibleInput): Promise<void> {
  await db.update(leagues).set({ draftGradesVisible: input.visible }).where(eq(leagues.id, input.leagueId));
}
