import { inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { matchups, statWeeks } from "@/db/schema";
import { computeStandings, LEAGUE_CONFIG, nextAction, seasonProgress, type WeekStatus } from "@/league";
import type { HomeBody, HomeLeagueCard, MatchupSummary } from "@/league-room/contract";
import { STATS_INGESTION_CONFIG } from "@/stats-pipeline/config";
import type { ScoreCache, ScoreCacheBatchRequest } from "@/stats-pipeline/score-cache";
import { myLeaguesOverview, toSummary } from "./read";

/** No Redis connection needed: every existing caller of `crossLeagueHome` keeps working
 *  untouched, the same idiom `matchupWeek`'s `referenceCache` and `setLineup`'s `cache`
 *  parameters use. */
const NOOP_SCORE_CACHE: Pick<ScoreCache, "readMany"> = {
  readMany: async () => new Map(),
};

export interface CrossLeagueHomeDeps {
  readonly scoreCache: Pick<ScoreCache, "readMany">;
}

const DEFAULT_DEPS: CrossLeagueHomeDeps = { scoreCache: NOOP_SCORE_CACHE };

/** A live score for one team, out of the cache's batch response for one league/week pair, or
 *  `undefined` on a miss — the caller falls back to the matchup row's own (Postgres) score. */
function cachedPoints(scores: readonly { readonly teamId: string; readonly points: number }[] | undefined, teamId: string): number | undefined {
  return scores?.find((score) => score.teamId === teamId)?.points;
}

/**
 * Everything the cross-league home renders, assembled once on the server: every league the user
 * fields a team in, this week's matchup in each, the user's record, and the one next action.
 *
 * Extends `myLeaguesOverview` (`./read.ts`) rather than re-querying membership its own way — the
 * league/team/draft rows are the SAME shared read `listLeaguesForUser` uses, so the two can never
 * quietly disagree about which leagues a user is in. Two more queries cover everything else: the
 * matchups across every one of those leagues, and the `stat_weeks` rows for the distinct current
 * weeks among them (usually just one, since Phase 1's calendar is shared across leagues). That is
 * five queries total — `myLeaguesOverview`'s three, plus these two — however many leagues the
 * caller is in, ten or fifty: the query-count discipline `listLeaguesForUser`'s own docblock
 * commits to, extended rather than re-earned.
 *
 * The one live read is a single `MGET` (`ScoreCache.readMany`) across every league whose current
 * week is `in_progress` — never one `GET` per league. A cache miss (including "never written",
 * which is every non-live week) simply leaves the matchup's own Postgres score in place, so the
 * numbers are always correct whether or not the cache has anything to say.
 *
 * Returns `HomeBody` minus `firstRun`, on purpose: the first-run fork (`firstRunPlan`,
 * `@/identity`) needs the caller's preferences, and this function's signature is deliberately
 * just a db and a user id. Both callers (`AppHome` and `/api/home`) compute `firstRun` themselves
 * and spread it onto this result before it reaches the wire.
 */
export async function crossLeagueHome(
  db: Db,
  userId: string,
  deps: CrossLeagueHomeDeps = DEFAULT_DEPS,
): Promise<Omit<HomeBody, "firstRun">> {
  const { leagueRows, teamRows, draftRows, myTeamByLeague } = await myLeaguesOverview(db, userId);
  if (leagueRows.length === 0) return { leagues: [] };
  const ids = leagueRows.map((league) => league.id);

  const filledByLeague = new Map<string, number>();
  for (const row of teamRows) filledByLeague.set(row.leagueId, (filledByLeague.get(row.leagueId) ?? 0) + 1);
  const draftByLeague = new Map(draftRows.map((row) => [row.leagueId, row]));

  const allMatchups = await db.select().from(matchups).where(inArray(matchups.leagueId, ids));
  const matchupsByLeague = new Map<string, (typeof allMatchups)[number][]>();
  for (const row of allMatchups) {
    const bucket = matchupsByLeague.get(row.leagueId);
    if (bucket === undefined) matchupsByLeague.set(row.leagueId, [row]);
    else bucket.push(row);
  }

  interface LeaguePhase {
    readonly currentWeek: number;
    readonly myTeamId: string | null;
    readonly nameById: ReadonlyMap<string, string>;
    readonly mine: (typeof allMatchups)[number] | undefined;
    readonly record: { readonly wins: number; readonly losses: number; readonly ties: number } | null;
  }

  const phaseByLeague = new Map<string, LeaguePhase>();
  for (const league of leagueRows) {
    const leagueMatchups = matchupsByLeague.get(league.id) ?? [];
    const { currentWeek } = seasonProgress(leagueMatchups, LEAGUE_CONFIG.regularSeasonWeeks);
    const myTeamId = myTeamByLeague.get(league.id) ?? null;
    const leagueTeams = teamRows.filter((row) => row.leagueId === league.id);
    const nameById = new Map(leagueTeams.map((row) => [row.id, row.name]));
    const mine = leagueMatchups.find(
      (row) => row.weekNumber === currentWeek && (row.homeTeamId === myTeamId || row.awayTeamId === myTeamId),
    );
    const standings = computeStandings({ teamIds: leagueTeams.map((row) => row.id), matchups: leagueMatchups });
    const myStanding = myTeamId === null ? undefined : standings.find((row) => row.teamId === myTeamId);
    const record = myStanding === undefined ? null : { wins: myStanding.wins, losses: myStanding.losses, ties: myStanding.ties };
    phaseByLeague.set(league.id, { currentWeek, myTeamId, nameById, mine, record });
  }

  const currentWeeks = [...new Set([...phaseByLeague.values()].map((phase) => phase.currentWeek))];
  const statWeekRows = currentWeeks.length === 0 ? [] : await db.select().from(statWeeks).where(inArray(statWeeks.week, currentWeeks));
  const statWeekByWeek = new Map(statWeekRows.map((row) => [row.week, row]));

  const weekStatusFor = (weekNumber: number): WeekStatus => statWeekByWeek.get(weekNumber)?.status ?? "scheduled";

  // Batch every league whose current week is actually live: a scheduled or final week never
  // wrote anything fresher than Postgres already has, so asking the cache for it would be a
  // wasted key in the MGET.
  const cacheRequests: ScoreCacheBatchRequest[] = [];
  for (const league of leagueRows) {
    const phase = phaseByLeague.get(league.id)!;
    const statWeek = statWeekByWeek.get(phase.currentWeek);
    if (statWeek !== undefined && statWeek.status === "in_progress") {
      cacheRequests.push({ leagueId: league.id, week: phase.currentWeek, version: statWeek.version });
    }
  }
  const cacheHits = await deps.scoreCache.readMany(cacheRequests);

  const leagues: HomeLeagueCard[] = leagueRows.map((league) => {
    const phase = phaseByLeague.get(league.id)!;
    const weekStatus = weekStatusFor(phase.currentWeek);
    const draft = draftByLeague.get(league.id);
    const filledTeams = filledByLeague.get(league.id) ?? 0;

    let matchup: MatchupSummary | null = null;
    if (phase.mine !== undefined) {
      const summary = toSummary(phase.mine, phase.nameById, weekStatus);
      const cacheKey = STATS_INGESTION_CONFIG.keys.score(league.id, phase.currentWeek);
      const live = cacheHits.get(cacheKey);
      matchup = {
        ...summary,
        homeScore: cachedPoints(live, summary.homeTeamId) ?? summary.homeScore,
        awayScore: cachedPoints(live, summary.awayTeamId) ?? summary.awayScore,
      };
    }

    return {
      id: league.id,
      name: league.name,
      format: league.format,
      teamCount: league.teamCount,
      filledTeams,
      isCommissioner: league.commissionerUserId === userId,
      myTeamId: phase.myTeamId,
      draftId: draft?.id ?? null,
      draftStatus: draft?.status ?? null,
      record: phase.record,
      weekNumber: phase.currentWeek,
      weekStatus,
      matchup,
      nextAction: nextAction({
        isCommissioner: league.commissionerUserId === userId,
        filledTeams,
        teamCount: league.teamCount,
        myTeamId: phase.myTeamId,
        draftStatus: draft?.status ?? null,
        weekStatus,
      }),
    };
  });

  return { leagues };
}
