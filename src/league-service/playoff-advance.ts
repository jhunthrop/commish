import { and, eq, isNotNull, lte } from "drizzle-orm";
import type { DbTx } from "@/db/client";
import { matchups, teams, weeks } from "@/db/schema";
import { LEAGUE_CONFIG, computeStandings } from "@/league";
import { championshipPairing, firstRoundPairings, playoffRoundOf, semifinalPairings, type SeededTeam } from "@/league/playoffs";

/**
 * THE BRACKET'S ADVANCE (engine-gap roadmap item 6, 2026-08-30), called by `finalizeWeekInTx`
 * after a week's scores commit and BEFORE `stampSeasonCompleteInTx` — the order is the design:
 * the next round's unscored matchups exist by the time the season-complete stamp asks "any
 * unscored matchup left?", so the season stays open until the championship itself settles.
 *
 * - Regular season's last week settles → round 1 (3v6, 4v5; 1-2 on bye), seeded from the final
 *   regular-season standings (the same `computeStandings` the standings page reads).
 * - Round 1 settles → reseeded semifinals. Round 2 settles → the championship.
 * - A TIE advances the better seed — the sport's own convention, and stated here because a tied
 *   fantasy playoff game is rare enough that silence would read as a bug.
 *
 * IDEMPOTENT by construction: if the next round's rows already exist, nothing is written — which
 * is also the honest answer to a stat correction re-settling a bracket-generating week AFTER the
 * bracket went out. A bracket, once published, stands; reseeding it retroactively would strip
 * teams of games they were already told they had.
 */
export async function advancePlayoffsInTx(tx: DbTx, leagueId: string, settledWeek: number): Promise<number> {
  const regularSeasonWeeks = LEAGUE_CONFIG.regularSeasonWeeks;
  const generatingRound = playoffRoundOf(settledWeek + 1, regularSeasonWeeks);
  if (generatingRound === null) return 0;

  const nextWeek = settledWeek + 1;
  const [already] = await tx
    .select({ weekNumber: matchups.weekNumber })
    .from(matchups)
    .where(and(eq(matchups.leagueId, leagueId), eq(matchups.weekNumber, nextWeek)))
    .limit(1);
  if (already !== undefined) return 0;

  const seeds = await seedsFromRegularSeason(tx, leagueId, regularSeasonWeeks);
  if (seeds.length !== LEAGUE_CONFIG.playoffTeams) return 0;

  const pairings =
    generatingRound === 1
      ? firstRoundPairings(seeds)
      : generatingRound === 2
        ? semifinalPairings(seeds, await winnersOf(tx, leagueId, settledWeek, seeds))
        : [championshipPairing(seeds, await winnersOf(tx, leagueId, settledWeek, seeds))];

  await tx.insert(matchups).values(
    pairings.map((pairing) => ({
      leagueId,
      weekNumber: nextWeek,
      homeTeamId: pairing.homeTeamId,
      awayTeamId: pairing.awayTeamId,
      homeScore: null,
      awayScore: null,
    })),
  );
  return pairings.length;
}

/** Final regular-season standings order, as seeds 1..N — the identical computation the
 *  standings page renders, so the bracket can never disagree with the table a manager read. */
async function seedsFromRegularSeason(tx: DbTx, leagueId: string, regularSeasonWeeks: number): Promise<readonly SeededTeam[]> {
  const teamRows = await tx.select({ id: teams.id }).from(teams).where(eq(teams.leagueId, leagueId));
  const matchupRows = await tx
    .select()
    .from(matchups)
    .where(and(eq(matchups.leagueId, leagueId), lte(matchups.weekNumber, regularSeasonWeeks)));
  const medianRows = await tx
    .select({ weekNumber: weeks.weekNumber, medianScore: weeks.medianScore })
    .from(weeks)
    .where(and(eq(weeks.leagueId, leagueId), isNotNull(weeks.medianScore)));
  const medianByWeek = new Map(medianRows.map((row) => [row.weekNumber, row.medianScore!]));
  const standings = computeStandings({ teamIds: teamRows.map((row) => row.id), matchups: matchupRows, medianByWeek });
  return standings.slice(0, LEAGUE_CONFIG.playoffTeams).map((row, index) => ({ teamId: row.teamId, seed: index + 1 }));
}

/** The settled week's winners, ties going to the better seed. */
async function winnersOf(tx: DbTx, leagueId: string, weekNumber: number, seeds: readonly SeededTeam[]): Promise<readonly string[]> {
  const seedOf = new Map(seeds.map((team) => [team.teamId, team.seed]));
  const games = await tx
    .select()
    .from(matchups)
    .where(and(eq(matchups.leagueId, leagueId), eq(matchups.weekNumber, weekNumber)));
  return games.map((game) => {
    const home = game.homeScore ?? 0;
    const away = game.awayScore ?? 0;
    if (home > away) return game.homeTeamId;
    if (away > home) return game.awayTeamId;
    return (seedOf.get(game.homeTeamId) ?? 99) <= (seedOf.get(game.awayTeamId) ?? 99) ? game.homeTeamId : game.awayTeamId;
  });
}
