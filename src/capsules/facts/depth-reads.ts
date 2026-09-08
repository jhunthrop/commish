import { readFileSync, statSync } from "node:fs";
import { and, desc, gte, inArray } from "drizzle-orm";
import type { Db, ReadonlyDb } from "@/db/client";
import { adpSnapshots, nflDraftPicks, nflGames, nflPlayers, nflverseInjuries, nflverseRosterWeeks, preseasonRosters } from "@/db/schema";
import type { Position } from "@/domain/player";
import { PPR_SCORING } from "@/domain/scoring";
import { PARTICIPATION_METRICS } from "@/projections/nflverse/map";
import { PBP_PLAYER_METRICS, PBP_PLAYER_SOURCE } from "@/projections/nflverse/pbp-players";
import { NFLVERSE_SOURCE } from "@/projections/nflverse/map";
import { parsePlayCallers, type PlayCallerRow } from "@/projections/nflverse/play-callers";
import { finalWeekOf } from "@/projections/nflverse/team-eras";
import { statLinesAsOfForLiveSurface } from "@/projections/nflverse/derived-stat-lines";
import { DEPTH_METRIC, DEPTH_SOURCE } from "@/projections/preseason/depth";
import { LAST_POSSIBLE_WEEK, observationsAsOf } from "@/projections/store";
import { playerTeamsAsOf, teamObservationsAsOf } from "@/projections/team-store";
import { computeFantasyPoints, roundPoints } from "@/scoring";
import type { WeeklyInjuryReport, WeeklyRosterStatus } from "@/projections/availability/season-end";
import type { ScoringTally } from "./scoring-usage";
import type { PlayerWeekShare, TeamPlayerTargets } from "./role";
import type { AdpCapture } from "./market-movement";
import type { WeekScore } from "./career";
import type { TeamMetricRow } from "./team-context";
import type { ScheduledGame } from "./schedule";

/**
 * EVERY DATABASE READ THE DEPTH FACTS NEED, each batched once for a whole population — the same
 * discipline `collect.ts` states for the colour facts, applied to a wider set of stores.
 *
 * ONE FILE FOR THE READS, ANOTHER FOR THE ASSEMBLY (`collect-depth.ts`). Each function here answers
 * one store's question and returns a plain map; nothing here decides what a fact sheet says. That
 * split is what lets every fact builder stay pure and unit tested without a database in the loop.
 *
 * NOTHING HERE READS A CLOCK. Every point-in-time read takes the caller's own `asOf`, so a replay
 * sees exactly what was knowable at that instant, the same guarantee `observationsAsOf` gives every
 * other consumer in this engine.
 */

/** The committed play-caller table, relative to the repo root, exactly as `nflverse/ingest.ts`
 *  reads it. A missing file is a broken checkout rather than a degraded feature, so this throws. */
const PLAY_CALLERS_CSV_PATH = "data/play-callers/play-callers.csv";

/**
 * PARSED ONCE PER PROCESS, keyed by path and by the file's own modification time.
 *
 * The table ships in the repository and cannot change under a running server, so re-reading and
 * re-parsing 944 rows on every board sweep and every single-player peek was pure waste: a peek is a
 * request-path call, and synchronous filesystem work on a request path blocks the event loop for
 * every other request in flight. The mtime is in the key rather than assumed away so a developer
 * editing the CSV between two calls in one long-lived dev process still sees his edit, which is the
 * only case a bare "read it once" memo would get wrong.
 *
 * `statSync` still throws for a missing file, so the loud failure this function has always had for
 * a broken checkout is unchanged.
 */
const playCallerCache = new Map<string, readonly PlayCallerRow[]>();

export function readPlayCallerTable(path: string = PLAY_CALLERS_CSV_PATH): readonly PlayCallerRow[] {
  const key = `${path}|${statSync(path).mtimeMs}`;
  const cached = playCallerCache.get(key);
  if (cached !== undefined) return cached;
  const rows = parsePlayCallers(readFileSync(path, "utf8"));
  playCallerCache.set(key, rows);
  return rows;
}

/** Display names for a set of nflverse ids. A player the universe has no row for is simply absent,
 *  and every caller falls back to the bare id rather than dropping him. */
export async function namesFor(db: ReadonlyDb, ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select({ id: nflPlayers.id, name: nflPlayers.name }).from(nflPlayers).where(inArray(nflPlayers.id, [...ids]));
  return new Map(rows.map((row) => [row.id, row.name] as const));
}

/** `playerId|season` — the key every per-player, per-season map below uses. */
export function seasonKey(playerId: string, season: number): string {
  return `${playerId}|${season}`;
}

function push<T>(into: Map<string, T[]>, key: string, value: T): void {
  const list = into.get(key);
  if (list === undefined) into.set(key, [value]);
  else list.push(value);
}

/** Every archived weekly injury report for these players across these seasons, keyed
 *  `playerId|season`. One query, never one per player-season. */
export async function injuryReportsFor(db: ReadonlyDb, playerIds: readonly string[], seasons: readonly number[]): Promise<ReadonlyMap<string, readonly WeeklyInjuryReport[]>> {
  const out = new Map<string, WeeklyInjuryReport[]>();
  if (playerIds.length === 0 || seasons.length === 0) return out;
  const rows = await db
    .select({ season: nflverseInjuries.season, week: nflverseInjuries.week, playerId: nflverseInjuries.playerId, reportStatus: nflverseInjuries.reportStatus, primaryInjury: nflverseInjuries.primaryInjury })
    .from(nflverseInjuries)
    .where(and(inArray(nflverseInjuries.playerId, [...playerIds]), inArray(nflverseInjuries.season, [...seasons])));
  for (const row of rows) push(out, seasonKey(row.playerId, row.season), { week: row.week, reportStatus: row.reportStatus, primaryInjury: row.primaryInjury });
  return out;
}

/** Every archived weekly roster status for these players across these seasons, same key. */
export async function rosterStatusesFor(db: ReadonlyDb, playerIds: readonly string[], seasons: readonly number[]): Promise<ReadonlyMap<string, readonly WeeklyRosterStatus[]>> {
  const out = new Map<string, WeeklyRosterStatus[]>();
  if (playerIds.length === 0 || seasons.length === 0) return out;
  const rows = await db
    .select({ season: nflverseRosterWeeks.season, week: nflverseRosterWeeks.week, playerId: nflverseRosterWeeks.playerId, status: nflverseRosterWeeks.status })
    .from(nflverseRosterWeeks)
    .where(and(inArray(nflverseRosterWeeks.playerId, [...playerIds]), inArray(nflverseRosterWeeks.season, [...seasons])));
  for (const row of rows) push(out, seasonKey(row.playerId, row.season), { week: row.week, status: row.status });
  return out;
}

/** One season's played weeks and points, per player, for a whole population. The SAME
 *  `statLinesAsOfForLiveSurface` read `collect.ts`'s own `lastSeasonStoriesFor` performs, so the
 *  points behind a rank here and the points behind last season's story cannot disagree. */
export async function weekScoresFor(db: ReadonlyDb, season: number, positions: ReadonlyMap<string, Position>, asOf: Date): Promise<ReadonlyMap<string, readonly WeekScore[]>> {
  const playerIds = [...positions.keys()];
  const out = new Map<string, WeekScore[]>();
  if (playerIds.length === 0) return out;
  const rows = await statLinesAsOfForLiveSurface(db, { season, week: { from: 1, to: finalWeekOf(season) }, asOf, playerIds });
  for (const { line } of rows) {
    const position = positions.get(line.playerId);
    if (position === undefined) continue;
    push(out, line.playerId, { week: line.week, points: roundPoints(computeFantasyPoints(line, position, PPR_SCORING)) });
  }
  return out;
}

/** One player's pedigree row, before `pedigreeFor` shapes it. Every field is independently absent. */
export interface PedigreeRow {
  readonly birthDate: string | null;
  readonly draftYear: number | null;
  readonly draftPick: number | null;
  readonly draftClub: string | null;
  readonly rookieSeason: number | null;
  readonly draftRound: number | null;
}

/** The preseason roster's own biography half, newest stamp first so the latest row wins. */
async function rosterBiographiesFor(db: ReadonlyDb, playerIds: readonly string[], season: number): Promise<ReadonlyMap<string, Omit<PedigreeRow, "rookieSeason" | "draftRound">>> {
  const rows = await db
    .select({ playerId: preseasonRosters.playerId, birthDate: preseasonRosters.birthDate, draftYear: preseasonRosters.draftYear, draftPick: preseasonRosters.draftPick, draftClub: preseasonRosters.draftClub })
    .from(preseasonRosters)
    .where(and(inArray(preseasonRosters.playerId, [...playerIds]), gte(preseasonRosters.season, season)))
    .orderBy(desc(preseasonRosters.asOf));
  const out = new Map<string, Omit<PedigreeRow, "rookieSeason" | "draftRound">>();
  for (const row of rows) if (!out.has(row.playerId)) out.set(row.playerId, row);
  return out;
}

/** Pedigree for a whole population, in three batched reads. */
export async function pedigreeRowsFor(db: ReadonlyDb, playerIds: readonly string[], season: number): Promise<ReadonlyMap<string, PedigreeRow>> {
  if (playerIds.length === 0) return new Map();
  const [biographies, universe, picks] = await Promise.all([
    rosterBiographiesFor(db, playerIds, season),
    db.select({ id: nflPlayers.id, rookieSeason: nflPlayers.rookieSeason }).from(nflPlayers).where(inArray(nflPlayers.id, [...playerIds])),
    db.select({ playerId: nflDraftPicks.playerId, round: nflDraftPicks.round, pick: nflDraftPicks.pick, season: nflDraftPicks.season }).from(nflDraftPicks).where(inArray(nflDraftPicks.playerId, [...playerIds])),
  ]);
  const rookieSeasonOf = new Map(universe.map((row) => [row.id, row.rookieSeason] as const));
  const pickOf = new Map(picks.map((row) => [row.playerId, row] as const));

  const out = new Map<string, PedigreeRow>();
  for (const playerId of playerIds) {
    const biography = biographies.get(playerId);
    const pick = pickOf.get(playerId);
    out.set(playerId, {
      birthDate: biography?.birthDate ?? null,
      // The draft archive's own season and pick stand in where the roster row carries none: both
      // describe the same event, and neither is derived from the other.
      draftYear: biography?.draftYear ?? pick?.season ?? null,
      draftPick: biography?.draftPick ?? pick?.pick ?? null,
      draftClub: biography?.draftClub ?? null,
      rookieSeason: rookieSeasonOf.get(playerId) ?? null,
      draftRound: pick?.round ?? null,
    });
  }
  return out;
}

/** Every depth-chart slot the release published for a season, keyed by player. Week one, which is
 *  the only week the ingester writes (`preseason/depth.ts`). */
export async function depthSlotsFor(db: ReadonlyDb, season: number, asOf: Date): Promise<ReadonlyMap<string, { readonly slot: number; readonly asOf: Date }>> {
  const rows = await observationsAsOf(db, { season, week: 1, asOf, source: DEPTH_SOURCE });
  const out = new Map<string, { readonly slot: number; readonly asOf: Date }>();
  for (const row of rows) if (row.metric === DEPTH_METRIC) out.set(row.playerId, { slot: row.value, asOf: row.asOf });
  return out;
}

/** One season's weekly snap and target shares for a set of players, from the two participation
 *  stores. A week with no team denominator yields no share for that week, never a zero. */
export async function weeklySharesFor(db: ReadonlyDb, season: number, playerIds: readonly string[], asOf: Date): Promise<ReadonlyMap<string, readonly PlayerWeekShare[]>> {
  const out = new Map<string, PlayerWeekShare[]>();
  if (playerIds.length === 0) return out;
  const window = { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf, playerIds } as const;
  const [snaps, participation] = await Promise.all([
    observationsAsOf(db, { ...window, source: NFLVERSE_SOURCE.snapCounts }),
    observationsAsOf(db, { ...window, source: NFLVERSE_SOURCE.playerWeek }),
  ]);
  const byPlayerWeek = new Map<string, Map<string, number>>();
  for (const row of [...snaps, ...participation]) {
    const key = seasonKey(row.playerId, row.week);
    const metrics = byPlayerWeek.get(key) ?? new Map<string, number>();
    metrics.set(row.metric, row.value);
    byPlayerWeek.set(key, metrics);
  }
  const shareOf = (metrics: Map<string, number>, part: string, whole: string): number | null => {
    const numerator = metrics.get(part);
    const denominator = metrics.get(whole);
    return numerator === undefined || denominator === undefined || denominator <= 0 ? null : numerator / denominator;
  };
  for (const [key, metrics] of byPlayerWeek) {
    const [playerId, weekRaw] = key.split("|");
    const snapShare = shareOf(metrics, PARTICIPATION_METRICS.offensiveSnaps, PARTICIPATION_METRICS.teamOffensiveSnaps);
    const targetShare = shareOf(metrics, PARTICIPATION_METRICS.targets, PARTICIPATION_METRICS.teamTargets);
    if (snapShare === null && targetShare === null) continue;
    push(out, playerId!, { week: Number(weekRaw), snapShare, targetShare });
  }
  return out;
}

/** Season-total targets and team targets, per player, plus the team the store places him on most
 *  often that season. The teams come from `player_week_teams`, never from a current roster: a
 *  player who changed teams must be counted against the offence he actually played in. */
export async function seasonTargetsFor(db: ReadonlyDb, season: number, playerIds: readonly string[], asOf: Date): Promise<{ readonly targets: ReadonlyMap<string, TeamPlayerTargets>; readonly teamOf: ReadonlyMap<string, string> }> {
  if (playerIds.length === 0) return { targets: new Map(), teamOf: new Map() };
  const [rows, teams] = await Promise.all([
    observationsAsOf(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf, source: NFLVERSE_SOURCE.playerWeek, playerIds }),
    playerTeamsAsOf(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf }),
  ]);
  const totals = new Map<string, { targets: number; teamTargets: number }>();
  for (const row of rows) {
    if (row.metric !== PARTICIPATION_METRICS.targets && row.metric !== PARTICIPATION_METRICS.teamTargets) continue;
    const entry = totals.get(row.playerId) ?? { targets: 0, teamTargets: 0 };
    if (row.metric === PARTICIPATION_METRICS.targets) entry.targets += row.value;
    else entry.teamTargets += row.value;
    totals.set(row.playerId, entry);
  }
  const weeksByTeam = new Map<string, Map<string, number>>();
  for (const row of teams) {
    const counts = weeksByTeam.get(row.playerId) ?? new Map<string, number>();
    counts.set(row.team, (counts.get(row.team) ?? 0) + 1);
    weeksByTeam.set(row.playerId, counts);
  }
  const teamOf = new Map<string, string>();
  for (const [playerId, counts] of weeksByTeam) {
    // Most weeks, then the team code, so a player split evenly between two clubs resolves the same
    // way on every run rather than by row order.
    teamOf.set(playerId, [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0]);
  }
  const targets = new Map<string, TeamPlayerTargets>([...totals].map(([playerId, entry]) => [playerId, { playerId, ...entry }] as const));
  return { targets, teamOf };
}

const SCORING_METRIC_FIELDS: readonly (readonly [string, keyof ScoringTally])[] = [
  [PBP_PLAYER_METRICS.redZoneCarries, "redZoneCarries"],
  [PBP_PLAYER_METRICS.redZoneTargets, "redZoneTargets"],
  [PBP_PLAYER_METRICS.insideTenCarries, "insideTenCarries"],
  [PBP_PLAYER_METRICS.insideTenTargets, "insideTenTargets"],
  [PBP_PLAYER_METRICS.airYards, "airYards"],
  [PBP_PLAYER_METRICS.airYardTargets, "airYardTargets"],
];

/** Season sums of the six scoring-range metrics, per player. A player the play-by-play never
 *  placed is absent from the map entirely rather than carrying six zeroes he did not earn. */
export async function scoringTalliesFor(db: ReadonlyDb, season: number, playerIds: readonly string[], asOf: Date): Promise<ReadonlyMap<string, ScoringTally>> {
  const out = new Map<string, ScoringTally>();
  if (playerIds.length === 0) return out;
  const rows = await observationsAsOf(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf, source: PBP_PLAYER_SOURCE, playerIds });
  const fieldOf = new Map(SCORING_METRIC_FIELDS);
  for (const row of rows) {
    const field = fieldOf.get(row.metric);
    if (field === undefined) continue;
    const tally = out.get(row.playerId) ?? { redZoneCarries: 0, redZoneTargets: 0, insideTenCarries: 0, insideTenTargets: 0, airYards: 0, airYardTargets: 0 };
    out.set(row.playerId, { ...tally, [field]: tally[field] + row.value });
  }
  return out;
}

/** Every team's own metric rows for one season, keyed by team. */
export async function teamMetricRowsFor(db: ReadonlyDb, season: number, week: number | { readonly from: number; readonly to: number }, asOf: Date, source?: string): Promise<ReadonlyMap<string, readonly TeamMetricRow[]>> {
  const rows = await teamObservationsAsOf(db, source === undefined ? { season, week, asOf } : { season, week, asOf, source });
  const out = new Map<string, TeamMetricRow[]>();
  for (const row of rows) push(out, row.team, { week: row.week, metric: row.metric, value: row.value });
  return out;
}

/** The product season's published schedule, straight off `nfl_games`. */
export async function scheduledGamesFor(db: ReadonlyDb): Promise<readonly ScheduledGame[]> {
  const rows = await db.select({ week: nflGames.week, homeTeam: nflGames.homeNflTeam, awayTeam: nflGames.awayNflTeam }).from(nflGames);
  return rows;
}

/** Every archived ADP capture at or after `since`, per player. */
export async function adpHistoryFor(db: ReadonlyDb, playerIds: readonly string[], since: Date): Promise<ReadonlyMap<string, readonly AdpCapture[]>> {
  const out = new Map<string, AdpCapture[]>();
  if (playerIds.length === 0) return out;
  const rows = await db
    .select({ playerId: adpSnapshots.playerId, adp: adpSnapshots.adp, capturedAt: adpSnapshots.capturedAt })
    .from(adpSnapshots)
    .where(and(inArray(adpSnapshots.playerId, [...playerIds]), gte(adpSnapshots.capturedAt, since)));
  for (const row of rows) push(out, row.playerId, { adp: row.adp, capturedAt: row.capturedAt });
  return out;
}

/** `Db` is accepted where a caller already holds one; every read here only ever reads. */
export type DepthReadDb = Db | ReadonlyDb;
