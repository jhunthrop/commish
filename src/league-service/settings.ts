// LEAGUE SETTINGS (Task 10) — the commissioner's own control over `leagues.draft_grades_visible`,
// and (peek document design §3.4, 2026-09-07) the one write path for a league's scoring rules.
// A future toggle joins this module rather than growing a second settings file, the same
// "one write module per concern" shape `draft-schedule.ts` and `invites.ts` each hold.
import { eq } from "drizzle-orm";
import type { Db, DbTx } from "@/db/client";
import type { Clock } from "@/domain/timing";
import { enqueuePeekDocumentRebuildsQuietly } from "@/jobs/defs/peek-document-job";
import { leagues, scoringSettings } from "@/db/schema";
import { excludedSetFor } from "@/db/upsert";
import type { ScoringRules } from "@/scoring";
import { writeLeagueScoringHash } from "./scoring-hash";

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

export interface WriteLeagueScoringInput {
  readonly leagueId: string;
  readonly rules: ScoringRules;
}

export interface WriteLeagueScoringResult {
  readonly hash: string;
  /** The hash this league carried before, or `null` for a league that never had one. A move from a
   *  real previous hash to a different one is the "league scoring settings change" event of the peek
   *  document design's own table (§3.4); a move from `null` is a league learning its own identity
   *  for the first time, which changes no document that any league was already being served. */
  readonly previous: string | null;
}

/**
 * THE ONE PLACE A LEAGUE'S SCORING RULES ARE WRITTEN — the settings row and `leagues.scoring_hash`
 * together, in whatever transaction the caller already holds.
 *
 * WHY THE TWO CANNOT BE WRITTEN SEPARATELY. The hash is what joins a league to its precomputed peek
 * documents. A window in which the weights say one thing and the hash says another is a window in
 * which a manager is shown weekly points scored under somebody else's rules, which is the single
 * failure the whole document design cannot survive. One function, one write, one commit.
 */
export async function writeLeagueScoring(db: Db | DbTx, clock: Clock, input: WriteLeagueScoringInput): Promise<WriteLeagueScoringResult> {
  await db
    .insert(scoringSettings)
    .values({ leagueId: input.leagueId, ...input.rules })
    .onConflictDoUpdate({ target: scoringSettings.leagueId, set: excludedSetFor(scoringSettings, ["leagueId"]) });
  const result = await writeLeagueScoringHash(db, input.leagueId, input.rules);

  // THE EVENT (peek document design §3.4, row five): a scoring CHANGE, and only a change. The new
  // hash gets a build of every player, since no document has ever been scored under it; a hash still
  // in use by other leagues is untouched, because their documents did not move. A league learning
  // its own hash for the first time (`previous === null`, which is every newly created league)
  // enqueues nothing at all: it has changed no rule set, and its first peek takes the miss path if
  // its hash is genuinely novel.
  if (result.previous !== null && result.previous !== result.hash) {
    await enqueuePeekDocumentRebuildsQuietly(db, clock, {
      playerIds: null,
      scoringHashes: [result.hash],
      reason: `settings:${input.leagueId}:${result.hash}`,
    });
  }
  return result;
}
