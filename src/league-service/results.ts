import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { matchups, teams } from "@/db/schema";
import { clinchedTeamIds, computeStandings, LEAGUE_CONFIG, seasonProgress } from "@/league";
import type { TeamStandingsRow } from "@/league-room/contract";

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
