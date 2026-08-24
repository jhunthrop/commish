import { desc, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { lineupSlots, matchups, statWeeks, weeks } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { computeStandings, LEAGUE_CONFIG, nextAction, seasonProgress, type WeekStatus } from "@/league";
import type { HomeBody, HomeLeagueCard, LiveState, MatchupSummary } from "@/league-room/contract";
import { STATS_INGESTION_CONFIG } from "@/stats-pipeline/config";
import type { ScoreCache, ScoreCacheBatchRequest } from "@/stats-pipeline/score-cache";
import { isCommissionerOf } from "./authority";
import { myLeaguesOverview, toSummary } from "./read";

/** The outermost edge is the only place a wall clock is allowed — see `read.ts`'s identical
 *  constant. Only used for `liveStateFor`'s weekday, below. */
const systemClock: Clock = { now: () => new Date().toISOString() };

/** Real NFL game days — Thursday Night Football, the Sunday slate, Monday Night Football. Gates
 *  `liveStateFor` (below) against the coarsest false-positive it would otherwise produce: a week
 *  whose own `stat_weeks.status` is still `"in_progress"` days after Monday night settles (a
 *  correction sweep can lag), or days before Thursday's kickoff even opens it. */
const NFL_GAME_WEEKDAYS: ReadonlySet<string> = new Set(["Thursday", "Sunday", "Monday"]);

const WEEKDAY_FORMAT = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });

/**
 * The top bar's one live fact (Task 10, Step 3), from `stat_weeks.games_total`/`games_final` —
 * columns `crossLeagueHome` already selects for `weekStatus`, so this costs no extra read.
 *
 * COARSE BY DESIGN, and the coarseness is named rather than hidden: `stat_weeks` carries an
 * aggregate `gamesFinal`/`gamesTotal` for the whole week, not a per-game "is this one being
 * played RIGHT NOW" flag, so a week that is genuinely mid-gap (Tuesday, with Monday night long
 * over and Thursday's kickoff days away) can still read `status: "in_progress"` if the
 * correction sweep has not yet stamped the week final. The weekday gate is what keeps that gap
 * from lighting a pill that lies: only a real NFL game day can ever render one, exactly the same
 * "coarse and correct beats fine and absent" tradeoff `isLineupLocked`'s own docblock states for
 * the identical reason (a per-game kickoff window this product does not model). `off-season`
 * (no `in_progress` week at all), `mid-week` (an `in_progress` week, but not a game day) and
 * `pre-kickoff` (the week has not started at all — `status !== "in_progress"`) all return `null`
 * — ruling 12, nothing live means no pill.
 */
export function liveStateFor(
  statWeekRows: readonly { readonly status: WeekStatus; readonly gamesTotal: number; readonly gamesFinal: number }[],
  now: Date,
): LiveState | null {
  const active = statWeekRows.find((row) => row.status === "in_progress");
  if (active === undefined) return null;
  const weekday = WEEKDAY_FORMAT.format(now);
  if (!NFL_GAME_WEEKDAYS.has(weekday)) return null;
  const gamesLive = active.gamesTotal - active.gamesFinal;
  return gamesLive > 0 ? { weekday, gamesLive } : null;
}

/** No Redis connection needed: every existing caller of `crossLeagueHome` keeps working
 *  untouched, the same idiom `matchupWeek`'s `referenceCache` and `setLineup`'s `cache`
 *  parameters use. */
const NOOP_SCORE_CACHE: Pick<ScoreCache, "readMany"> = {
  readMany: async () => new Map(),
};

export interface CrossLeagueHomeDeps {
  readonly scoreCache?: Pick<ScoreCache, "readMany">;
  /** Only `liveStateFor`'s weekday needs a clock — defaults to the real one, exactly like every
   *  other service module's own outermost-edge constant, injectable so a test can pin the day. */
  readonly clock?: Clock;
}

const DEFAULT_DEPS: CrossLeagueHomeDeps = {};

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
 * quietly disagree about which leagues a user is in. Four more queries cover everything else:
 * the matchups across every one of those leagues, the `weeks` rows across every one of them too
 * (their stored medians, for a league with the Task 2 toggle on — a per-league query inside the
 * standings loop below would be exactly the N+1 the data-layer rules forbid), the `stat_weeks`
 * rows for the distinct current weeks among them (usually just one, since Phase 1's calendar is
 * shared across leagues), and (Phase 3.6, Task 10, Step 1b) ONE grouped `lineup_slots` read over
 * every caller's own team ids, answering `HomeLeagueCard.lineupSet` for every league in one round
 * trip regardless of how many different "current weeks" they are each on. That is eight queries
 * total — `myLeaguesOverview`'s four (membership, leagues, teams, drafts), plus these four —
 * however many leagues the caller is in, ten or fifty: the query-count discipline
 * `listLeaguesForUser`'s own docblock commits to, extended rather than re-earned.
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
  if (leagueRows.length === 0) return { leagues: [], liveState: null };
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

  // Every league's stored medians, in ONE grouped query before the per-league loop below reads
  // them — never a per-league query inside that loop, which is exactly the N+1 the data-layer
  // rules forbid. A week absent here (unsettled, or a league with the toggle off) simply
  // contributes no median entry, the same "absent means no second result" `computeStandings`
  // already treats a half-scored matchup with.
  const allWeeks = await db.select({ leagueId: weeks.leagueId, weekNumber: weeks.weekNumber, medianScore: weeks.medianScore }).from(weeks).where(inArray(weeks.leagueId, ids));
  const medianByWeekByLeague = new Map<string, Map<number, number>>();
  for (const row of allWeeks) {
    if (row.medianScore === null) continue;
    const bucket = medianByWeekByLeague.get(row.leagueId) ?? new Map<number, number>();
    bucket.set(row.weekNumber, row.medianScore);
    medianByWeekByLeague.set(row.leagueId, bucket);
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
    const standings = computeStandings({
      teamIds: leagueTeams.map((row) => row.id),
      matchups: leagueMatchups,
      medianByWeek: medianByWeekByLeague.get(league.id),
    });
    const myStanding = myTeamId === null ? undefined : standings.find((row) => row.teamId === myTeamId);
    const record = myStanding === undefined ? null : { wins: myStanding.wins, losses: myStanding.losses, ties: myStanding.ties };
    phaseByLeague.set(league.id, { currentWeek, myTeamId, nameById, mine, record });
  }

  // Always non-empty: `leagueRows.length === 0` already returned above, and the loop just above
  // sets exactly one `phaseByLeague` entry per league row, so there is always at least one
  // current week here — no `currentWeeks.length === 0` guard needed for `inArray`.
  const currentWeeks = [...new Set([...phaseByLeague.values()].map((phase) => phase.currentWeek))];
  // `.orderBy(desc(week))` (fix round 1, L3): `liveStateFor`'s `.find(status === "in_progress")`
  // needs a stated, deterministic order across rows rather than trusting the database's own
  // return order — the latest week wins on the rare tick two weeks are briefly `in_progress` at
  // once (a settlement lag), which is the more useful one to report live.
  const statWeekRows = await db.select().from(statWeeks).where(inArray(statWeeks.week, currentWeeks)).orderBy(desc(statWeeks.week));
  const statWeekByWeek = new Map(statWeekRows.map((row) => [row.week, row]));

  const weekStatusFor = (weekNumber: number): WeekStatus => statWeekByWeek.get(weekNumber)?.status ?? "scheduled";

  // Step 1b (F1): the EIGHTH grouped query — `HomeLeagueCard.lineupSet`, the same
  // `notExists(lineupSlots WHERE teamId AND weekNumber)` predicate `leaguesNeedingAutoSetQuery`
  // (`@/league-service/auto-lineup.ts`) already asks, folded in here rather than a per-league
  // read. Every team id is globally unique (`teams.id` is the primary key), so one `IN` over
  // every caller's own team ids across every league answers every league's own current-week
  // question in a single round trip, whatever week each league happens to be on.
  const myTeamIds = [...new Set([...phaseByLeague.values()].map((phase) => phase.myTeamId).filter((id): id is string => id !== null))];
  const lineupRows =
    myTeamIds.length === 0
      ? []
      : await db.selectDistinct({ teamId: lineupSlots.teamId, weekNumber: lineupSlots.weekNumber }).from(lineupSlots).where(inArray(lineupSlots.teamId, myTeamIds));
  const lineupSetKeys = new Set(lineupRows.map((row) => `${row.teamId}:${row.weekNumber}`));
  const lineupSetFor = (teamId: string | null, weekNumber: number): boolean => teamId === null || lineupSetKeys.has(`${teamId}:${weekNumber}`);

  // Step 3: the top bar's one live fact, from the SAME `statWeekRows` read above — zero extra
  // queries. See `liveStateFor`'s own docblock for the coarseness this accepts.
  const liveState = liveStateFor(statWeekRows, new Date((deps.clock ?? systemClock).now()));

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
  const cacheHits = await (deps.scoreCache ?? NOOP_SCORE_CACHE).readMany(cacheRequests);

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
      isCommissioner: isCommissionerOf(league, userId),
      myTeamId: phase.myTeamId,
      draftId: draft?.id ?? null,
      draftStatus: draft?.status ?? null,
      record: phase.record,
      weekNumber: phase.currentWeek,
      weekStatus,
      matchup,
      lineupSet: lineupSetFor(phase.myTeamId, phase.currentWeek),
      medianGame: league.medianGame,
      medianScore: medianByWeekByLeague.get(league.id)?.get(phase.currentWeek) ?? null,
      kickoffAt: draft?.kickoffAt.toISOString() ?? null,
      startTrigger: draft?.startTrigger ?? null,
      kickoffRolls: draft?.kickoffRolls ?? 0,
      myTeamName: phase.myTeamId === null ? null : (phase.nameById.get(phase.myTeamId) ?? null),
      nextAction: nextAction({
        isCommissioner: isCommissionerOf(league, userId),
        filledTeams,
        teamCount: league.teamCount,
        myTeamId: phase.myTeamId,
        draftStatus: draft?.status ?? null,
        weekStatus,
        lineupSet: lineupSetFor(phase.myTeamId, phase.currentWeek),
      }),
    };
  });

  return { leagues, liveState };
}
