// LEAGUE SETTINGS (Task 10) — the commissioner's own control over `leagues.draft_grades_visible`,
// and (peek document design §3.4, 2026-09-07) the one write path for a league's scoring rules.
// A future toggle joins this module rather than growing a second settings file, the same
// "one write module per concern" shape `draft-schedule.ts` and `invites.ts` each hold.
import { and, eq } from "drizzle-orm";
import type { Db, DbTx } from "@research-ts/db/client";
import type { Clock } from "@research-ts/domain/timing";
import { enqueuePeekDocumentRebuildsQuietly } from "@/jobs/defs/peek-document-job";
import { leagues, scoringSettings, teams } from "@/db/schema";
import { excludedSetFor } from "@research-ts/db/upsert";
import type { ScoringRules } from "@research-ts/scoring";
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

export interface RenameMyTeamInput {
  readonly leagueId: string;
  readonly userId: string;
  /** Already trimmed and length-checked by `renameMyTeamSchema` (`./schemas.ts`). */
  readonly name: string;
}

export type RenameMyTeamResult = { readonly ok: true; readonly name: string } | { readonly ok: false; readonly reason: string; readonly status: 404 };

/**
 * A MANAGER NAMES THEIR OWN TEAM (2026-09-11). Until now nothing in this codebase could: the
 * waiting room's "Team name" panel stated the name a seat was given and had no control behind it,
 * which is an instruction with no verb, and the signed-in home's redesign deleted that panel. The
 * field it moves to is the league room's own My team page, which is where a manager already goes
 * to change something about their team, so the fact and the control are finally in one place.
 *
 * OWN TEAM ONLY, structurally: the `WHERE` is `league_id AND user_id`, so this function has no
 * way to express "somebody else's team" whatever a caller passes, the same shape
 * `setSlotPreference` (`@/draft-service/slot-preference`) keeps for the identical reason. A caller
 * with no seat here updates nothing and gets the non-oracle 404 a stranger to the league would.
 */
export async function renameMyTeam(db: Db, input: RenameMyTeamInput): Promise<RenameMyTeamResult> {
  const updated = await db
    .update(teams)
    .set({ name: input.name })
    .where(and(eq(teams.leagueId, input.leagueId), eq(teams.userId, input.userId)))
    .returning({ name: teams.name });
  const row = updated[0];
  if (row === undefined) return { ok: false, reason: "That league does not exist.", status: 404 };
  return { ok: true, name: row.name };
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
