import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { matchups, teams } from "@/db/schema";
import { finalizeWeek, type FinalizeResult } from "@/stats-pipeline/finalize";
import { clinchedTeamIds, computeStandings, LEAGUE_CONFIG, seasonProgress } from "@/league";
import type { TeamStandingsRow } from "@/league-room/contract";

export type ScoreWeekResult = FinalizeResult;

/**
 * Delegate until Plan B Task 8 deletes the manual path.
 *
 * The scoring body that used to live here moved to `@/stats-pipeline/finalize.ts` as
 * `finalizeWeek` — it's now the ingestion worker's SETTLEMENT write, called when a week
 * transitions to final, rather than something a commissioner triggers by hand. This delegate
 * exists only because `src/app/api/leagues/[leagueId]/weeks/[week]/score/route.ts` still imports
 * `scoreWeek` from here; Task 8 deletes both the route and this delegate together.
 */
export async function scoreWeek(db: Db, leagueId: string, weekNumber: number): Promise<ScoreWeekResult> {
  return finalizeWeek(db, leagueId, weekNumber);
}

/** The standings table, with the display names and the clinch flag the page renders. */
export async function leagueStandings(db: Db, leagueId: string): Promise<readonly TeamStandingsRow[]> {
  const teamRows = await db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.leagueId, leagueId));
  const matchupRows = await db.select().from(matchups).where(eq(matchups.leagueId, leagueId));
  const standings = computeStandings({ teamIds: teamRows.map((row) => row.id), matchups: matchupRows });

  const { weeksRemaining } = seasonProgress(matchupRows, LEAGUE_CONFIG.regularSeasonWeeks);
  const clinched = new Set(clinchedTeamIds({ standings, weeksRemaining, playoffTeams: LEAGUE_CONFIG.playoffTeams }));
  const nameById = new Map(teamRows.map((row) => [row.id, row.name]));

  return standings.map((row) => ({ ...row, teamName: nameById.get(row.teamId) ?? row.teamId, clinched: clinched.has(row.teamId) }));
}
