import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { leagues, matchups, players, playerStatLines, scoringSettings, teams } from "@/db/schema";
import type { Position, StatLine } from "@/domain/player";
import type { RosterSlotConfig } from "@/domain/roster";
import { PPR_SCORING } from "@/domain/scoring";
import { clinchedTeamIds, computeStandings, LEAGUE_CONFIG, seasonProgress, startersOf } from "@/league";
import type { TeamStandingsRow } from "@/league-room/contract";
import { scoreLineup, type ScoringRules } from "@/scoring";
import { getLineup } from "./lineups";

export type ScoreWeekResult =
  | { readonly ok: true; readonly weekNumber: number; readonly matchupsScored: number }
  | { readonly ok: false; readonly status: number; readonly reason: string };

/** One team's week: the starters it fielded and what they were worth. */
async function scoreTeam(
  db: Db,
  teamId: string,
  weekNumber: number,
  slotConfig: readonly RosterSlotConfig[],
  positionById: ReadonlyMap<string, Position>,
  statLines: ReadonlyMap<string, StatLine>,
  rules: ScoringRules,
): Promise<number> {
  const lineup = await getLineup(db, { teamId, weekNumber, slotConfig });
  const starters = startersOf(lineup).flatMap((entry) => {
    if (entry.playerId === null) return [];
    const position = positionById.get(entry.playerId);
    return position === undefined ? [] : [{ playerId: entry.playerId, position }];
  });
  return scoreLineup({ starters, statLinesByPlayerId: statLines, settings: rules }).total;
}

/**
 * Scores one week of a league from the mock dataset and stores the result on its matchups.
 *
 * There is NO live scoring in this phase — the dataset is static and complete, so a week is
 * "final" the moment a commissioner scores it, and nothing about this is in progress.
 * Publishing no event is deliberate: a number that only changes when somebody asks for it
 * does not need a real-time channel.
 *
 * Re-running is safe and produces identical numbers: it recomputes from the same stored
 * lineups and stat lines and overwrites.
 */
export async function scoreWeek(db: Db, leagueId: string, weekNumber: number): Promise<ScoreWeekResult> {
  const [league] = await db.select({ rosterSlots: leagues.rosterSlots }).from(leagues).where(eq(leagues.id, leagueId));
  if (league === undefined) return { ok: false, status: 404, reason: "That league doesn't exist." };

  const week = await db.select().from(matchups).where(and(eq(matchups.leagueId, leagueId), eq(matchups.weekNumber, weekNumber)));
  if (week.length === 0) return { ok: false, status: 404, reason: "That week isn't part of this league's season." };

  // The league's OWN rules, never a preset guessed from its name. The fallback covers a
  // league seeded without a settings row at all; `createLeague` always writes one.
  const [settings] = await db.select().from(scoringSettings).where(eq(scoringSettings.leagueId, leagueId));
  const rules: ScoringRules = settings ?? PPR_SCORING;

  const roster = await db.select({ id: players.id, position: players.position }).from(players);
  const positionById = new Map(roster.map((row) => [row.id, row.position]));
  const lines = await db.select().from(playerStatLines).where(eq(playerStatLines.week, weekNumber));
  const statLines = new Map(lines.map((line) => [line.playerId, line]));

  const teamIds = [...new Set(week.flatMap((row) => [row.homeTeamId, row.awayTeamId]))];
  const scores = new Map<string, number>();
  for (const teamId of teamIds) {
    scores.set(teamId, await scoreTeam(db, teamId, weekNumber, league.rosterSlots, positionById, statLines, rules));
  }

  // One transaction for the whole week: a half-scored week is not a result, it's a bug in
  // progress — `computeStandings` deliberately ignores a matchup with only one score.
  await db.transaction(async (tx) => {
    for (const row of week) {
      await tx
        .update(matchups)
        .set({ homeScore: scores.get(row.homeTeamId) ?? 0, awayScore: scores.get(row.awayTeamId) ?? 0 })
        .where(and(eq(matchups.leagueId, leagueId), eq(matchups.weekNumber, weekNumber), eq(matchups.homeTeamId, row.homeTeamId)));
    }
  });

  return { ok: true, weekNumber, matchupsScored: week.length };
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
