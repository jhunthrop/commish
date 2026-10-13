import { headCoachLookup, playCallerLookup, type PlayCallerRow } from "@research-ts/projections/nflverse/play-callers";
import type { PlayerFactsCoaching } from "./types";

/**
 * WHO IS IN CHARGE OF THE OFFENCE HE PLAYS IN (spec §4, fact 4; inventory row 4).
 *
 * The board already fires a `new_play_caller` beat, and the sheet already renders it, but that beat
 * names a TEAM and nobody else: "new play caller at MIA" is a fact a manager cannot act on without
 * knowing who arrived and who left. This names both people.
 *
 * TWO DIFFERENT KINDS OF "NEW", BOTH SOURCED, NEITHER GUESSED:
 *   - the HEAD COACH's flag comes from his own first season with the team, a column the curated
 *     table now carries from a cited source. `firstSeason === season` is a fact, not a comparison
 *     of two curated rows that might merely differ because one was never filled in.
 *   - the PLAY CALLER's flag is a genuine comparison, because the table covers every season back to
 *     1999 for that column: he is new when the prior season's week-one caller for this team was
 *     somebody else. `null` when the table names nobody for the prior season, which is "we cannot
 *     tell" rather than "he is not new".
 *
 * WEEK ONE IS THE IDENTITY, matching `coaches.ts`'s own leakage reasoning: a fact sheet written
 * before a season has started must not quote whoever ends up calling the most plays, because that
 * is correlated with the season's own outcome and nobody could know it yet.
 */

const OPENING_WEEK = 1;

/** The play-caller table's own role for one team-season's week-one caller. */
function roleAt(rows: readonly PlayCallerRow[], team: string, season: number): PlayCallerRow["role"] | null {
  const match = rows.find((row) => row.team === team && row.season === season && row.startWeek <= OPENING_WEEK && OPENING_WEEK <= row.endWeek);
  return match?.role ?? null;
}

/**
 * One team-season's coaching facts, or `null` when the curated table says nothing at all about it.
 *
 * A HALF-ANSWER IS STILL AN ANSWER. A team-season the table names a play caller for but no head
 * coach (every season before the head-coach column was sourced) returns an object with a real
 * `playCaller` and a `null` `headCoach`, and the renderer drops the missing half rather than the
 * whole line.
 */
export function coachingFor(team: string, season: number, rows: readonly PlayCallerRow[]): PlayerFactsCoaching | null {
  const callerOf = playCallerLookup(rows);
  const headOf = headCoachLookup(rows);

  const playCaller = callerOf(team, season, OPENING_WEEK);
  const priorCaller = callerOf(team, season - 1, OPENING_WEEK);
  const head = headOf(team, season);
  if (playCaller === null && head === null) return null;

  return {
    season,
    headCoach: head?.name ?? null,
    headCoachIsNew: head === null || head.firstSeason === null ? null : head.firstSeason === season,
    playCaller,
    playCallerRole: playCaller === null ? null : roleAt(rows, team, season),
    playCallerIsNew: playCaller === null || priorCaller === null ? null : priorCaller !== playCaller,
  };
}
