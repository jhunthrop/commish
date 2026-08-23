import { and, eq, gte, lt } from "drizzle-orm";
import type { ReadonlyDb } from "@/db/client";
import { leagues, matchups, players, playerStatLines, scoringSettings, teams, weeks } from "@/db/schema";
import { ADVISOR_CONFIG } from "@/domain/advisor";
import { PPR_SCORING, type ScoringSettings } from "@/domain/scoring";
import { computeStandings, type StandingsRow } from "@/league";
import { getLineup } from "@/league-service/lineups";
import { computeFantasyPoints, roundPoints, type ScoringRules } from "@/scoring";
import type { StartSitCandidate, ValuedPlayer } from "./valuation";

export interface AdvisorPlayerContext extends StartSitCandidate {
  readonly nflTeam: string;
  readonly slotIndex: number;
  /** Points in each of the last `ADVISOR_CONFIG.trendWeeks` completed weeks, oldest first. */
  readonly recentPoints: readonly number[];
}

export interface AdvisorTeamContext {
  readonly teamId: string;
  readonly teamName: string;
  /** "7-4-1", or "0-0" before a week has been scored. Display-shaped: it goes into a prompt. */
  readonly record: string;
  readonly players: readonly AdvisorPlayerContext[];
}

export interface AdvisorContext {
  readonly leagueId: string;
  readonly leagueName: string;
  readonly weekNumber: number;
  /** The league's OWN rules — never a preset guessed from its name. */
  readonly scoring: Omit<ScoringSettings, "leagueId">;
  readonly me: AdvisorTeamContext;
  readonly opponent: AdvisorTeamContext | null;
}

export interface AssembleContextInput {
  readonly leagueId: string;
  readonly teamId: string;
  readonly weekNumber: number;
}

/** Every key of a scoring-settings row except `leagueId` — the shape the prompt is allowed to see. */
function scoringWithoutLeagueId(row: ScoringSettings): Omit<ScoringSettings, "leagueId"> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => key !== "leagueId")) as Omit<
    ScoringSettings,
    "leagueId"
  >;
}

/**
 * "7-4-1", or "0-0" before a week has been scored. Delegates the actual win/loss/tie count to
 * `computeStandings` (`@/league`) — the SAME function `leagueStandings` and `crossLeagueHome`
 * read — rather than re-deriving it from `matchups` by hand: a hand-rolled head-to-head tally
 * here used to disagree with the standings page the moment a league turned its median game on,
 * because it only ever counted the ONE result a matchup row can hold and had no way to fold in
 * the second, medianByWeek-derived result every other record consumer already does.
 */
function formatTeamRecord(row: StandingsRow): string {
  return row.ties === 0 ? `${row.wins}-${row.losses}` : `${row.wins}-${row.losses}-${row.ties}`;
}

/**
 * Everything the advisor knows about one league, assembled from rows this product already
 * owns. **This is the differentiator, not the model call** (strategy doc §4.2): the roster,
 * the league's exact scoring settings and the actual opponent are here with no sync step, no
 * pasted screenshot and no "which site are you on?" question.
 *
 * Read-only by CONSTRUCTION, not by convention: `ReadonlyDb` exposes `select` and nothing
 * else, so a write anywhere down this call path is a compile error rather than something a
 * directory scan has to notice. `advisory-only.test.ts` stays as defense in depth for the
 * things a type cannot say.
 */
export async function assembleAdvisorContext(db: ReadonlyDb, input: AssembleContextInput): Promise<AdvisorContext | null> {
  const [league] = await db.select().from(leagues).where(eq(leagues.id, input.leagueId));
  if (league === undefined) return null;

  const [settings] = await db.select().from(scoringSettings).where(eq(scoringSettings.leagueId, input.leagueId));
  const rules: ScoringRules = settings ?? PPR_SCORING;

  const teamRows = await db
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(eq(teams.leagueId, input.leagueId));
  const nameById = new Map(teamRows.map((row) => [row.id, row.name]));
  // `leagueId` and `teamId` arrive as INDEPENDENT inputs, and the roster read below
  // (`getLineup`) filters by `teamId` alone — so without this line a team id from another
  // league assembles that team's real roster under this league's name and scoring. That is an
  // authorization check, not a lookup convenience: the trade route takes `counterpartyTeamId`
  // straight from the request body. Both routes already answer `null` as a 404.
  if (!nameById.has(input.teamId)) return null;

  // Fix round 1 (F2): the league's own stored medians ride along on this SAME query, a LEFT JOIN
  // rather than a second round trip — `weeks`' own primary key is `(league_id, week_number)`,
  // the exact pair `matchups` is already scoped and grouped by, so the join costs nothing this
  // query wasn't already paying for. A row with no matching `weeks` entry (the toggle is off, or
  // that week never finalized) simply carries `medianScore: null`, indistinguishable from the
  // standalone read's own "absent from the map" case. This keeps `assembleAdvisorContext` at the
  // SAME query count Task 2 found it at, rather than adding one — measured directly in
  // `context.test.ts`'s own query-budget test, since this function is on the hot path for both
  // the trade propose (`trades.ts`) and trade accept-time fairness (`trade-fairness.ts`) checks,
  // each of which calls it TWICE per action.
  const allMatchups = await db
    .select({
      leagueId: matchups.leagueId,
      weekNumber: matchups.weekNumber,
      homeTeamId: matchups.homeTeamId,
      awayTeamId: matchups.awayTeamId,
      homeScore: matchups.homeScore,
      awayScore: matchups.awayScore,
      medianScore: weeks.medianScore,
    })
    .from(matchups)
    .leftJoin(weeks, and(eq(weeks.leagueId, matchups.leagueId), eq(weeks.weekNumber, matchups.weekNumber)))
    .where(eq(matchups.leagueId, input.leagueId));
  const thisWeek = allMatchups.find(
    (row) =>
      row.weekNumber === input.weekNumber && (row.homeTeamId === input.teamId || row.awayTeamId === input.teamId),
  );
  const opponentTeamId =
    thisWeek === undefined ? null : thisWeek.homeTeamId === input.teamId ? thisWeek.awayTeamId : thisWeek.homeTeamId;

  // The SAME record `leagueStandings` and `crossLeagueHome` show, median game included: a
  // league's own stored medians (riding on `allMatchups` above), folded into one win/loss/tie
  // count per team by the one function every other record consumer already goes through.
  const medianByWeek = new Map(allMatchups.flatMap((row) => (row.medianScore === null ? [] : [[row.weekNumber, row.medianScore] as const])));
  const standings = computeStandings({ teamIds: [...nameById.keys()], matchups: allMatchups, medianByWeek });
  const standingsByTeam = new Map(standings.map((row) => [row.teamId, row]));

  // Recent form is BOUNDED: `trendWeeks` completed weeks before this one, never the season.
  const firstTrendWeek = Math.max(1, input.weekNumber - ADVISOR_CONFIG.trendWeeks);
  const trendWeeks = await db
    .select()
    .from(playerStatLines)
    .where(and(gte(playerStatLines.week, firstTrendWeek), lt(playerStatLines.week, input.weekNumber)));

  const playerRows = await db.select().from(players);
  const playerById = new Map(playerRows.map((row) => [row.id, row]));

  const linesByPlayer = new Map<string, (typeof playerStatLines.$inferSelect)[]>();
  for (const line of trendWeeks) {
    linesByPlayer.set(line.playerId, [...(linesByPlayer.get(line.playerId) ?? []), line]);
  }

  async function teamContext(teamId: string): Promise<AdvisorTeamContext> {
    const lineup = await getLineup(db, { teamId, weekNumber: input.weekNumber, slotConfig: league.rosterSlots });
    const roster = lineup.flatMap((slot): readonly AdvisorPlayerContext[] => {
      if (slot.playerId === null) return [];
      const player = playerById.get(slot.playerId);
      if (player === undefined) return [];
      // computeFantasyPoints already rounds internally (src/scoring/compute.ts) — rounding its
      // result again would be a second spelling of a rule that has exactly one owner.
      const recentPoints = [...(linesByPlayer.get(slot.playerId) ?? [])]
        .sort((a, b) => a.week - b.week)
        .map((line) => computeFantasyPoints(line, player.position, rules));
      const averagePoints =
        recentPoints.length === 0
          ? 0
          : roundPoints(recentPoints.reduce((sum, points) => sum + points, 0) / recentPoints.length);
      return [
        {
          playerId: player.id,
          name: player.name,
          position: player.position,
          nflTeam: player.nflTeam,
          slot: slot.slot,
          slotIndex: slot.slotIndex,
          starting: slot.slot !== "BENCH",
          recentPoints,
          averagePoints,
        },
      ];
    });
    // `standingsByTeam` has a row for every id `nameById` does (`computeStandings` tallies every
    // team it's given, whether or not it has ever played a matchup), and `teamContext` is only
    // ever called with `input.teamId` (checked against `nameById` above) or an `opponentTeamId`
    // drawn from this same league's own matchup rows — so this is never missing.
    const record = formatTeamRecord(standingsByTeam.get(teamId)!);
    return { teamId, teamName: nameById.get(teamId) ?? teamId, record, players: roster };
  }

  const [me, opponent] = await Promise.all([
    teamContext(input.teamId),
    opponentTeamId === null ? Promise.resolve(null) : teamContext(opponentTeamId),
  ]);

  const scoring = scoringWithoutLeagueId(settings ?? { leagueId: input.leagueId, ...PPR_SCORING });

  return {
    leagueId: input.leagueId,
    leagueName: league.name,
    weekNumber: input.weekNumber,
    scoring,
    me,
    opponent,
  };
}

/**
 * The named players on one side of a trade, valued. Ids that aren't on that team are dropped
 * rather than valued at zero: a trade the analyzer can't see both sides of is a shape error the
 * route rejects, not a fairness verdict this function should invent.
 */
export function valuePlayers(context: AdvisorTeamContext, playerIds: readonly string[]): readonly ValuedPlayer[] {
  return playerIds.flatMap((playerId) => {
    const player = context.players.find((entry) => entry.playerId === playerId);
    return player === undefined
      ? []
      : [{ playerId: player.playerId, name: player.name, position: player.position, averagePoints: player.averagePoints }];
  });
}
