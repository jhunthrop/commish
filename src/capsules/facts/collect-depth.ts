import { coachRows } from "@/coaches/store";
import type { Db } from "@/db/client";
import type { Position } from "@/domain/player";
import type { PlayCallerRow } from "@/projections/nflverse/play-callers";
import { regularSeasonGamesPerTeam } from "@/projections/nflverse/schedule";
import { SCHEDULE_METRICS, SCHEDULE_SOURCE } from "@/projections/nflverse/schedule";
import { productTeamCode, sourceTeamCode } from "@/projections/nflverse/team-codes";
import { availabilityStoreCoverage } from "@/projections/availability/season-record";
import { firstKickoffFor } from "@/projections/team-store";
import { LAST_POSSIBLE_WEEK } from "@/projections/store";
import { rankWithinGroups, type RankableStat } from "../rank";
import { gamesMissedFor, seasonEndingsFor, type GamesMissedInput, type SeasonEndingInput } from "./availability";
import { priorSeasonsFor, volatilityFor, type SeasonHeadline } from "./career";
import { coachingFor } from "./coaching";
import { depthChartFor, type DepthRow } from "./depth-chart";
import {
  adpHistoryFor,
  depthSlotsFor,
  injuryReportsFor,
  namesFor,
  pedigreeRowsFor,
  rosterStatusesFor,
  scheduledGamesFor,
  scoringTalliesFor,
  seasonKey,
  seasonTargetsFor,
  teamMetricRowsFor,
  weekScoresFor,
  weeklySharesFor,
} from "./depth-reads";
import { injuryCapturesFor, latestRosterBios } from "./harvest-captures";
import { injuryHistoryFor } from "./injury-history";
import { marketMovementFor } from "./market-movement";
import { pedigreeFor } from "./pedigree";
import { roleTrendFor, targetCompetitionFor, type TeamPlayerTargets } from "./role";
import { scheduleFor } from "./schedule";
import { scoringUsageFor } from "./scoring-usage";
import { teamContextFor } from "./team-context";
import { EMPTY_DEPTH, type PlayerFactsDepth, type PlayerFactsPriorSeason } from "./types";

/**
 * THE ONE BATCHED DEPTH COLLECTOR — every store the depth facts read, once for the whole
 * population, then one pure assembly per player. `collect.ts` and `collect-one.ts` each call this
 * exactly once and add exactly one field to the input they already build.
 *
 * WHY A SEPARATE COLLECTOR RATHER THAN MORE OF `collect.ts`. That module is already the single place
 * the colour facts are read and is close to the size where a file stops being readable; more
 * importantly, a parallel round owns the writer half of the same directory, and one new call plus
 * one new field is a merge nobody has to adjudicate. Nothing here duplicates a read `collect.ts`
 * performs: the two overlap only on `statLinesAsOfForLiveSurface` for the prior season, and that
 * one is deliberate (see `weekScoresFor`'s own docblock, which explains why the two must agree).
 *
 * THE SUBJECT POPULATION AND THE RANKING POPULATION ARE DIFFERENT, on purpose. `playerIds` is who
 * gets a fact sheet; `positions` is who a rank is taken over. Reading the heavy per-player stores
 * (injury reports, roster weeks, ADP) for the ranking population would multiply the work by twenty
 * for facts no peer's sheet will ever print.
 */

/** The window an ADP movement is read over. Forty-five days covers the whole preseason drift the
 *  archive is capturing for, and the rendered sentence prints the two dates it actually found, so a
 *  thinner archive states a shorter window rather than a false one. */
const ADP_WINDOW_DAYS = 45;

/** How many harvest snapshots a designation history is built from. A daily feed over a preseason is
 *  a few dozen; the cap is what keeps a season's worth of multi-megabyte payloads out of memory. */
const INJURY_CAPTURE_LIMIT = 60;

/** HOW FAR BACK THE CAREER ARC LOOKS. Three is the spec's own number ("points, games and rank for
 *  each of the three prior seasons in one line"), and it is also the depth the stat store actually
 *  carries in production (2023 onward, measured in the inventory). A season with nothing behind it
 *  costs one empty read and produces no line, so this never invents history. */
const CAREER_SEASONS = 3;

/** The seasons a depth pass describes, newest first. */
export function depthPriorSeasons(productSeason: number): readonly number[] {
  return Array.from({ length: CAREER_SEASONS }, (_, index) => productSeason - 1 - index);
}

/** July of the product season: before any capture that could describe this season, and after every
 *  capture that described the last one. */
function seasonCaptureFloor(productSeason: number): Date {
  return new Date(Date.UTC(productSeason, 6, 1));
}

function daysBefore(at: Date, days: number): Date {
  return new Date(at.getTime() - days * 24 * 60 * 60 * 1000);
}

export interface DepthCollectOptions {
  readonly productSeason: number;
  /** Newest first. Every season the sheet may describe; a season the store holds nothing for simply
   *  produces no facts rather than an entry full of zeroes. */
  readonly priorSeasons: readonly number[];
  /** The ranking population, nflverse id to position — `activePeersFor`'s own output. */
  readonly positions: ReadonlyMap<string, Position>;
  /** The subjects, nflverse id to their CURRENT team code. */
  readonly teamByPlayerId: ReadonlyMap<string, string>;
  readonly asOf: Date;
}

export interface DepthFactsPass {
  readonly byPlayerId: ReadonlyMap<string, PlayerFactsDepth>;
}

/** One season's ranked headlines for a whole population, from that season's own week scores. */
function headlinesFor(season: number, weekScores: ReadonlyMap<string, readonly { readonly week: number; readonly points: number }[]>, positions: ReadonlyMap<string, Position>, names: ReadonlyMap<string, string>): ReadonlyMap<string, SeasonHeadline> {
  const byPosition = new Map<Position, RankableStat[]>();
  const totals = new Map<string, { readonly total: number; readonly games: number }>();
  for (const [playerId, weeks] of weekScores) {
    const position = positions.get(playerId);
    if (position === undefined || weeks.length === 0) continue;
    const total = Math.round(weeks.reduce((sum, week) => sum + week.points, 0) * 10) / 10;
    totals.set(playerId, { total, games: weeks.length });
    const entry: RankableStat = { playerId, name: names.get(playerId) ?? playerId, value: total };
    const list = byPosition.get(position);
    if (list === undefined) byPosition.set(position, [entry]);
    else list.push(entry);
  }
  const ranks = rankWithinGroups(byPosition);
  const out = new Map<string, SeasonHeadline>();
  for (const [playerId, { total, games }] of totals) {
    const rank = ranks.get(playerId);
    if (rank === undefined) continue;
    out.set(playerId, { season, points: total, gamesPlayed: games, positionRank: rank.positionRank, qualifierCount: rank.qualifierCount });
  }
  return out;
}

/** Everything one pass read, before it is narrowed to a single player. */
interface DepthPassData {
  readonly options: DepthCollectOptions;
  readonly names: ReadonlyMap<string, string>;
  readonly injuryReports: ReadonlyMap<string, readonly { readonly week: number; readonly reportStatus: string; readonly primaryInjury: string }[]>;
  readonly rosterStatuses: ReadonlyMap<string, readonly { readonly week: number; readonly status: string }[]>;
  /** The prior seasons BOTH designation archives hold rows for (`availabilityStoreCoverage`). */
  readonly coveredSeasons: ReadonlySet<number>;
  readonly weekScoresBySeason: ReadonlyMap<number, ReadonlyMap<string, readonly { readonly week: number; readonly points: number }[]>>;
  readonly headlinesBySeason: ReadonlyMap<number, ReadonlyMap<string, SeasonHeadline>>;
  readonly injuryHistoryByPlayerId: ReadonlyMap<string, ReturnType<typeof injuryHistoryFor>>;
  readonly pedigree: Awaited<ReturnType<typeof pedigreeRowsFor>>;
  readonly colleges: ReadonlyMap<string, { readonly college: string | null }>;
  readonly openingDay: Date | null;
  readonly depthRows: readonly DepthRow[];
  readonly weeklyShares: Awaited<ReturnType<typeof weeklySharesFor>>;
  readonly targetCompetitionByTeam: ReadonlyMap<string, ReturnType<typeof targetCompetitionFor>>;
  readonly scoringUsage: ReturnType<typeof scoringUsageFor>;
  readonly playCallers: readonly PlayCallerRow[];
  readonly priorTeamRows: Awaited<ReturnType<typeof teamMetricRowsFor>>;
  readonly weekOneTeamRows: Awaited<ReturnType<typeof teamMetricRowsFor>>;
  readonly games: Awaited<ReturnType<typeof scheduledGamesFor>>;
  readonly indoorsByWeekByTeam: ReadonlyMap<string, ReadonlyMap<number, boolean>>;
  readonly adpHistory: Awaited<ReturnType<typeof adpHistoryFor>>;
}

/** The two availability facts for one player, over every season the caller asked about. */
function availabilityFactsFor(playerId: string, data: DepthPassData): Pick<PlayerFactsDepth, "seasonEndings" | "gamesMissed"> {
  const endingInputs: SeasonEndingInput[] = [];
  const missedInputs: GamesMissedInput[] = [];
  for (const season of data.options.priorSeasons) {
    const key = seasonKey(playerId, season);
    const rosterRows = data.rosterStatuses.get(key) ?? [];
    const injuryRows = data.injuryReports.get(key) ?? [];
    const gamesPlayedWeeks = (data.weekScoresBySeason.get(season)?.get(playerId) ?? []).map((week) => week.week);
    endingInputs.push({ season, injuryRows, statusRows: rosterRows, gamesPlayedWeeks });
    missedInputs.push({ season, teamGames: regularSeasonGamesPerTeam(season), covered: data.coveredSeasons.has(season), rosterRows, injuryRows, gamesPlayedWeeks });
  }
  return { seasonEndings: seasonEndingsFor(endingInputs), gamesMissed: gamesMissedFor(missedInputs) };
}

/** The career facts for one player: last season's volatility and every prior season's headline. */
function careerFactsFor(playerId: string, data: DepthPassData): Pick<PlayerFactsDepth, "volatility" | "priorSeasons"> {
  const [mostRecent] = data.options.priorSeasons;
  const recentWeeks = mostRecent === undefined ? [] : (data.weekScoresBySeason.get(mostRecent)?.get(playerId) ?? []);
  const headlines: readonly (SeasonHeadline | null)[] = data.options.priorSeasons.map((season) => data.headlinesBySeason.get(season)?.get(playerId) ?? null);
  return {
    volatility: mostRecent === undefined ? null : volatilityFor(mostRecent, recentWeeks),
    priorSeasons: priorSeasonsFor(headlines) as readonly PlayerFactsPriorSeason[],
  };
}

/**
 * One player's whole depth group, assembled from the pass. Pure.
 *
 * TWO SPELLINGS OF HIS TEAM, AND BOTH ARE LOAD-BEARING (`nflverse/team-codes.ts` documents the
 * split). The product spells the Rams `LAR` and Washington `WSH`; nflverse spells them `LA` and
 * `WAS`, and so do the play-caller table, `team_week_observations` and `player_week_teams`. Looking
 * an nflverse-keyed store up by a product code silently returns nothing for exactly two franchises,
 * which reads on the page as "the store holds nothing about the Rams" rather than as the bug it is.
 * `sourceTeamCode` normalizes toward nflverse for those stores, `productTeamCode` back toward the
 * product for `nfl_games` and the depth chart, and the round trip also folds the `WAS`/`WSH` split
 * the product's own `players.nfl_team` column still carries.
 */
function depthFactsFor(playerId: string, team: string, data: DepthPassData): PlayerFactsDepth {
  const { options } = data;
  const position = options.positions.get(playerId);
  const [priorSeason] = options.priorSeasons;
  const pedigreeRow = data.pedigree.get(playerId);
  const sourceTeam = sourceTeamCode(team);
  const productTeam = productTeamCode(sourceTeam);
  return {
    ...availabilityFactsFor(playerId, data),
    injuryHistory: data.injuryHistoryByPlayerId.get(playerId) ?? [],
    coaching: coachingFor(sourceTeam, options.productSeason, data.playCallers),
    pedigree:
      pedigreeRow === undefined
        ? null
        : pedigreeFor({ ...pedigreeRow, openingDay: data.openingDay, productSeason: options.productSeason, college: data.colleges.get(playerId)?.college ?? null }),
    depthChart: position === undefined ? null : depthChartFor(playerId, productTeam, position, data.depthRows, data.names),
    roleTrend: priorSeason === undefined ? null : roleTrendFor(priorSeason, data.weeklyShares.get(playerId) ?? []),
    targetCompetition: data.targetCompetitionByTeam.get(sourceTeam) ?? null,
    scoringUsage: data.scoringUsage.get(playerId) ?? null,
    teamContext: priorSeason === undefined ? null : teamContextFor(priorSeason, data.priorTeamRows.get(sourceTeam) ?? [], data.weekOneTeamRows.get(sourceTeam) ?? []),
    schedule: scheduleFor(productTeam, data.games, data.indoorsByWeekByTeam.get(sourceTeam) ?? new Map()),
    marketMovement: marketMovementFor(data.adpHistory.get(playerId) ?? []),
    ...careerFactsFor(playerId, data),
  };
}

/** Every prior season's week scores and ranked headlines, one read per season. */
async function seasonPassesFor(db: Db, options: DepthCollectOptions, names: ReadonlyMap<string, string>): Promise<Pick<DepthPassData, "weekScoresBySeason" | "headlinesBySeason">> {
  const weekScoresBySeason = new Map<number, ReadonlyMap<string, readonly { readonly week: number; readonly points: number }[]>>();
  const headlinesBySeason = new Map<number, ReadonlyMap<string, SeasonHeadline>>();
  const perSeason = await Promise.all(options.priorSeasons.map(async (season) => [season, await weekScoresFor(db, season, options.positions, options.asOf)] as const));
  for (const [season, scores] of perSeason) {
    weekScoresBySeason.set(season, scores);
    headlinesBySeason.set(season, headlinesFor(season, scores, options.positions, names));
  }
  return { weekScoresBySeason, headlinesBySeason };
}

/** Which of a team's scheduled games the schedule store calls indoor, per team. */
function indoorsByTeam(teamRows: ReadonlyMap<string, readonly { readonly week: number; readonly metric: string; readonly value: number }[]>): ReadonlyMap<string, ReadonlyMap<number, boolean>> {
  const out = new Map<string, ReadonlyMap<number, boolean>>();
  for (const [team, rows] of teamRows) {
    const byWeek = new Map<number, boolean>();
    for (const row of rows) if (row.metric === SCHEDULE_METRICS.indoors) byWeek.set(row.week, row.value === 1);
    if (byWeek.size > 0) out.set(team, byWeek);
  }
  return out;
}

/** Last season's target competition, per team, from one season-wide targets read. */
function competitionByTeam(priorSeason: number | undefined, targets: Awaited<ReturnType<typeof seasonTargetsFor>>, names: ReadonlyMap<string, string>): ReadonlyMap<string, ReturnType<typeof targetCompetitionFor>> {
  const out = new Map<string, ReturnType<typeof targetCompetitionFor>>();
  if (priorSeason === undefined) return out;
  const byTeam = new Map<string, TeamPlayerTargets[]>();
  for (const [playerId, row] of targets.targets) {
    const team = targets.teamOf.get(playerId);
    if (team === undefined) continue;
    const list = byTeam.get(team) ?? [];
    list.push(row);
    byTeam.set(team, list);
  }
  for (const [team, rows] of byTeam) out.set(team, targetCompetitionFor(priorSeason, team, rows, names));
  return out;
}

/** Every depth fact for a whole population, in one bounded pass. */
export async function collectDepthFacts(db: Db, options: DepthCollectOptions): Promise<DepthFactsPass> {
  const subjectIds = [...options.teamByPlayerId.keys()];
  if (subjectIds.length === 0) return { byPlayerId: new Map() };
  const populationIds = [...options.positions.keys()];
  const [priorSeason] = options.priorSeasons;
  const { productSeason, asOf } = options;

  const names = await namesFor(db, [...new Set([...populationIds, ...subjectIds])]);
  const [injuryReports, rosterStatuses, coveredSeasons, seasonPasses, captures, colleges, pedigree, openingDay] = await Promise.all([
    injuryReportsFor(db, subjectIds, options.priorSeasons),
    rosterStatusesFor(db, subjectIds, options.priorSeasons),
    availabilityStoreCoverage(db, options.priorSeasons),
    seasonPassesFor(db, options, names),
    injuryCapturesFor(db, seasonCaptureFloor(productSeason), INJURY_CAPTURE_LIMIT),
    latestRosterBios(db),
    pedigreeRowsFor(db, subjectIds, productSeason),
    firstKickoffFor(db, productSeason),
  ]);

  const [depthSlots, weeklyShares, targets, tallies, priorTeamRows, weekOneTeamRows, scheduleTeamRows, games, adpHistory, playCallers] = await Promise.all([
    depthSlotsFor(db, productSeason, asOf),
    priorSeason === undefined ? Promise.resolve(new Map()) : weeklySharesFor(db, priorSeason, subjectIds, asOf),
    priorSeason === undefined ? Promise.resolve({ targets: new Map(), teamOf: new Map() }) : seasonTargetsFor(db, priorSeason, populationIds, asOf),
    priorSeason === undefined ? Promise.resolve(new Map()) : scoringTalliesFor(db, priorSeason, populationIds, asOf),
    priorSeason === undefined ? Promise.resolve(new Map()) : teamMetricRowsFor(db, priorSeason, { from: 1, to: LAST_POSSIBLE_WEEK }, asOf),
    teamMetricRowsFor(db, productSeason, 1, asOf, SCHEDULE_SOURCE.kickoff),
    teamMetricRowsFor(db, productSeason, { from: 1, to: LAST_POSSIBLE_WEEK }, asOf, SCHEDULE_SOURCE.schedule),
    scheduledGamesFor(db),
    adpHistoryFor(db, subjectIds, daysBefore(asOf, ADP_WINDOW_DAYS)),
    coachRows(db),
  ]);

  const injuryHistoryByPlayerId = new Map(subjectIds.map((playerId) => [playerId, injuryHistoryFor(playerId, captures)] as const));
  // Every depth-chart row is stamped with the PRODUCT spelling of its team, the same spelling
  // `depthFactsFor` looks it up by, so the two franchises the two feeds spell differently group
  // together rather than splitting into two half-empty position rooms.
  const depthRows: readonly DepthRow[] = [...depthSlots].flatMap(([playerId, slot]) => {
    const position = options.positions.get(playerId);
    const team = options.teamByPlayerId.get(playerId) ?? targets.teamOf.get(playerId);
    if (position === undefined || team === undefined) return [];
    return [{ playerId, team: productTeamCode(sourceTeamCode(team)), position, slot: slot.slot, season: productSeason, asOf: slot.asOf }];
  });

  const data: DepthPassData = {
    options,
    names,
    injuryReports,
    rosterStatuses,
    coveredSeasons,
    ...seasonPasses,
    injuryHistoryByPlayerId,
    pedigree,
    colleges,
    openingDay,
    depthRows,
    weeklyShares,
    targetCompetitionByTeam: competitionByTeam(priorSeason, targets, names),
    scoringUsage: priorSeason === undefined ? new Map() : scoringUsageFor(priorSeason, tallies, options.positions, names),
    playCallers,
    priorTeamRows,
    weekOneTeamRows,
    games,
    indoorsByWeekByTeam: indoorsByTeam(scheduleTeamRows),
    adpHistory,
  };

  const byPlayerId = new Map<string, PlayerFactsDepth>();
  for (const [playerId, team] of options.teamByPlayerId) byPlayerId.set(playerId, depthFactsFor(playerId, team, data));
  return { byPlayerId };
}

/** The honest empty pass, for a caller that has no subjects at all. */
export const EMPTY_DEPTH_PASS: DepthFactsPass = { byPlayerId: new Map() };

export { EMPTY_DEPTH };
