import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts, leagues, matchups, players, playerStatLines, scoringSettings, teams } from "@/db/schema";
import { PPR_SCORING } from "@/domain/scoring";
import { listTeamCards } from "@/draft-service/teams";
import { benchOf, LEAGUE_CONFIG, seasonProgress, startersOf } from "@/league";
import type {
  LeagueHomeBody,
  LeagueSummary,
  MatchupDetail,
  MatchupLineupEntry,
  MatchupSide,
  MatchupSummary,
  MatchupWeekBody,
} from "@/league-room/contract";
import { computeFantasyPoints, type ScoringRules } from "@/scoring";
import { getLineup } from "./lineups";
import { leagueStandings } from "./results";

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

function toSummary(row: typeof matchups.$inferSelect, nameById: ReadonlyMap<string, string>): MatchupSummary {
  return {
    weekNumber: row.weekNumber,
    homeTeamId: row.homeTeamId,
    awayTeamId: row.awayTeamId,
    homeTeamName: nameById.get(row.homeTeamId) ?? row.homeTeamId,
    awayTeamName: nameById.get(row.awayTeamId) ?? row.awayTeamId,
    homeScore: row.homeScore,
    awayScore: row.awayScore,
    final: row.homeScore !== null && row.awayScore !== null,
  };
}

/**
 * Everything the league home page renders, assembled once on the server. `listTeamCards` is
 * imported from `@/draft-service/teams` rather than re-implemented — it is already the one
 * "team + owner's public profile" query in this codebase, and a second would drift.
 */
export async function leagueHome(db: Db, leagueId: string, userId: string): Promise<LeagueHomeBody | null> {
  const [league] = await db.select().from(leagues).where(eq(leagues.id, leagueId));
  if (league === undefined) return null;

  const matchupRows = await db.select().from(matchups).where(eq(matchups.leagueId, leagueId));
  const teamRows = await db.select({ id: teams.id, name: teams.name, userId: teams.userId }).from(teams).where(eq(teams.leagueId, leagueId));
  const [draft] = await db.select({ id: drafts.id, status: drafts.status }).from(drafts).where(eq(drafts.leagueId, leagueId));

  const { totalWeeks, currentWeek } = seasonProgress(matchupRows, LEAGUE_CONFIG.regularSeasonWeeks);
  const myTeamId = teamRows.find((row) => row.userId === userId)?.id ?? null;
  const nameById = new Map(teamRows.map((row) => [row.id, row.name]));

  const mine = matchupRows.find(
    (row) => row.weekNumber === currentWeek && (row.homeTeamId === myTeamId || row.awayTeamId === myTeamId),
  );

  return {
    leagueId,
    name: league.name,
    format: league.format,
    teamCount: league.teamCount,
    rosterSlots: league.rosterSlots,
    isCommissioner: league.commissionerUserId === userId,
    myTeamId,
    teams: await listTeamCards(db, leagueId),
    standings: await leagueStandings(db, leagueId),
    currentWeek,
    totalWeeks,
    myMatchup: mine === undefined ? null : toSummary(mine, nameById),
    draftId: draft?.id ?? null,
    draftStatus: draft?.status ?? null,
  };
}

/**
 * One week's matchups with both lineups and per-player points. Every number the page shows is
 * computed here — the matchup view does no arithmetic of its own.
 */
export async function matchupWeek(db: Db, leagueId: string, weekNumber: number, userId: string): Promise<MatchupWeekBody | null> {
  const [league] = await db.select().from(leagues).where(eq(leagues.id, leagueId));
  if (league === undefined) return null;
  const slotConfig = league.rosterSlots;

  const week = await db.select().from(matchups).where(and(eq(matchups.leagueId, leagueId), eq(matchups.weekNumber, weekNumber)));
  const allRows = await db.select().from(matchups).where(eq(matchups.leagueId, leagueId));
  const { totalWeeks } = seasonProgress(allRows, LEAGUE_CONFIG.regularSeasonWeeks);
  if (week.length === 0) return { leagueId, weekNumber, totalWeeks, myTeamId: null, matchups: [] };

  const teamRows = await db.select({ id: teams.id, name: teams.name, userId: teams.userId }).from(teams).where(eq(teams.leagueId, leagueId));
  const nameById = new Map(teamRows.map((row) => [row.id, row.name]));
  const myTeamId = teamRows.find((row) => row.userId === userId)?.id ?? null;

  const [settings] = await db.select().from(scoringSettings).where(eq(scoringSettings.leagueId, leagueId));
  const rules: ScoringRules = settings ?? PPR_SCORING;
  const playerRows = await db.select().from(players);
  const playerById = new Map(playerRows.map((row) => [row.id, row]));
  const lines = await db.select().from(playerStatLines).where(eq(playerStatLines.week, weekNumber));
  const statLines = new Map(lines.map((line) => [line.playerId, line]));

  const entryFor = (slot: { readonly slot: MatchupLineupEntry["slot"]; readonly slotIndex: number; readonly playerId: string | null }): MatchupLineupEntry => {
    const player = slot.playerId === null ? undefined : playerById.get(slot.playerId);
    const line = slot.playerId === null ? undefined : statLines.get(slot.playerId);
    return {
      slot: slot.slot,
      slotIndex: slot.slotIndex,
      playerId: slot.playerId,
      playerName: player?.name ?? null,
      position: player?.position ?? null,
      points: player === undefined || line === undefined ? 0 : computeFantasyPoints(line, player.position, rules),
    };
  };

  async function sideFor(teamId: string, score: number | null): Promise<MatchupSide> {
    const lineup = await getLineup(db, { teamId, weekNumber, slotConfig });
    return {
      teamId,
      teamName: nameById.get(teamId) ?? teamId,
      score,
      starters: startersOf(lineup).map(entryFor),
      bench: benchOf(lineup).map(entryFor),
    };
  }

  // Every matchup's two sides are independent `getLineup` round trips — run the whole week's
  // worth in parallel rather than awaiting each side, one matchup at a time.
  const details: MatchupDetail[] = await Promise.all(
    week.map(async (row): Promise<MatchupDetail> => {
      const [home, away] = await Promise.all([sideFor(row.homeTeamId, row.homeScore), sideFor(row.awayTeamId, row.awayScore)]);
      return { weekNumber, home, away, final: row.homeScore !== null && row.awayScore !== null };
    }),
  );

  return { leagueId, weekNumber, totalWeeks, myTeamId, matchups: details };
}
