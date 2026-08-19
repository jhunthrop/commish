import { and, eq, gte, lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { leagues, matchups, players, playerStatLines, scoringSettings, teams } from "@/db/schema";
import { PPR_SCORING, type ScoringSettings } from "@/domain/scoring";
import { getLineup } from "@/league-service/lineups";
import { computeFantasyPoints, roundPoints, type ScoringRules } from "@/scoring";
import { ADVISOR_CONFIG } from "./config";
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

function recordOf(rows: readonly (typeof matchups.$inferSelect)[], teamId: string): string {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const row of rows) {
    if (row.homeScore === null || row.awayScore === null) continue;
    const isHome = row.homeTeamId === teamId;
    if (!isHome && row.awayTeamId !== teamId) continue;
    const mine = isHome ? row.homeScore : row.awayScore;
    const theirs = isHome ? row.awayScore : row.homeScore;
    if (mine > theirs) wins += 1;
    else if (mine < theirs) losses += 1;
    else ties += 1;
  }
  return ties === 0 ? `${wins}-${losses}` : `${wins}-${losses}-${ties}`;
}

/**
 * Everything the advisor knows about one league, assembled from rows this product already
 * owns. **This is the differentiator, not the model call** (strategy doc §4.2): the roster,
 * the league's exact scoring settings and the actual opponent are here with no sync step, no
 * pasted screenshot and no "which site are you on?" question.
 *
 * Read-only by construction: every statement in this file is a `select`. Nothing under
 * `src/ai-advisor/**` may write — see `advisory-only.test.ts`.
 */
export async function assembleAdvisorContext(db: Db, input: AssembleContextInput): Promise<AdvisorContext | null> {
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

  const allMatchups = await db.select().from(matchups).where(eq(matchups.leagueId, input.leagueId));
  const thisWeek = allMatchups.find(
    (row) =>
      row.weekNumber === input.weekNumber && (row.homeTeamId === input.teamId || row.awayTeamId === input.teamId),
  );
  const opponentTeamId =
    thisWeek === undefined ? null : thisWeek.homeTeamId === input.teamId ? thisWeek.awayTeamId : thisWeek.homeTeamId;

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
      const recentPoints = [...(linesByPlayer.get(slot.playerId) ?? [])]
        .sort((a, b) => a.week - b.week)
        .map((line) => roundPoints(computeFantasyPoints(line, player.position, rules)));
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
    return { teamId, teamName: nameById.get(teamId) ?? teamId, record: recordOf(allMatchups, teamId), players: roster };
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
