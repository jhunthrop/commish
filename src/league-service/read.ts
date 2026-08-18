import { asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts, leagues, teams } from "@/db/schema";
import type { LeagueSummary } from "@/league-room/contract";

/**
 * Every league the caller fields a team in, oldest first, with the two numbers the list needs:
 * how full it is, and what its draft is doing. One query per table, not one per league — a
 * manager in ten leagues must not cost thirty round trips.
 */
export async function listLeaguesForUser(db: Db, userId: string): Promise<readonly LeagueSummary[]> {
  const mine = await db.select({ leagueId: teams.leagueId, teamId: teams.id }).from(teams).where(eq(teams.userId, userId));
  if (mine.length === 0) return [];
  const ids = mine.map((row) => row.leagueId);

  const leagueRows = await db.select().from(leagues).where(inArray(leagues.id, ids)).orderBy(asc(leagues.createdAt));
  const teamRows = await db.select({ leagueId: teams.leagueId }).from(teams).where(inArray(teams.leagueId, ids));
  const draftRows = await db
    .select({ id: drafts.id, leagueId: drafts.leagueId, status: drafts.status })
    .from(drafts)
    .where(inArray(drafts.leagueId, ids));

  const filledByLeague = new Map<string, number>();
  for (const row of teamRows) filledByLeague.set(row.leagueId, (filledByLeague.get(row.leagueId) ?? 0) + 1);
  const draftByLeague = new Map(draftRows.map((row) => [row.leagueId, row]));
  const myTeamByLeague = new Map(mine.map((row) => [row.leagueId, row.teamId]));

  return leagueRows.map((league) => ({
    id: league.id,
    name: league.name,
    format: league.format,
    teamCount: league.teamCount,
    filledTeams: filledByLeague.get(league.id) ?? 0,
    isCommissioner: league.commissionerUserId === userId,
    myTeamId: myTeamByLeague.get(league.id) ?? null,
    draftId: draftByLeague.get(league.id)?.id ?? null,
    draftStatus: draftByLeague.get(league.id)?.status ?? null,
  }));
}
