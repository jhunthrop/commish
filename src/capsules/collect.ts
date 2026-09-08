import { and, inArray, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { nflPlayers, playerStatLines, statWeeks } from "@/db/schema";
import type { Position, StatLine } from "@/domain/player";
import { PPR_SCORING } from "@/domain/scoring";
import { boardRows, isProjectedRow, type BoardOptions, type ProjectedBoardRow } from "@/draft-hq/board/service";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { injurySnapshot, type InjurySnapshot } from "@/league-service/injuries";
import { newsForPlayers, type NewsStory } from "@/league-service/news";
import { nflPlayerIdsFor } from "@/projections/crosswalk";
import { discoveryFactsForSeason, type DiscoveryFacts, type DiscoveryQuantityValues } from "@/projections/laws/discovery-facts";
import { isSkillPosition } from "@/projections/laws/populations";
import { chipEligibleLaws, registry } from "@/projections/laws/registry";
import { STAT_LINE_SOURCE } from "@/projections/lines";
import { loadArchivedPropLines, median, medianPropLinesByPlayer } from "@/projections/market/props-anchor";
import { statLinesAsOfForLiveSurface } from "@/projections/nflverse/derived-stat-lines";
import { PARTICIPATION_METRICS } from "@/projections/nflverse/map";
import { LIVE_ADMITTED_DERIVED_SEASONS } from "@/projections/nflverse/stat-lines";
import { sourceTeamCode } from "@/projections/nflverse/team-codes";
import { finalWeekOf } from "@/projections/nflverse/team-eras";
import { PROP_MARKETS, type PropMarket } from "@/projections/odds/props-store";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { LAST_POSSIBLE_WEEK, observationsAsOf } from "@/projections/store";
import { firstKickoffFor, teamObservationsAsOf } from "@/projections/team-store";
import { VEGAS_METRICS, VEGAS_SOURCE } from "@/projections/vegas/ingest";
import { computeFantasyPoints, roundPoints } from "@/scoring";
import {
  buildPlayerFacts,
  type PlayerFacts,
  type PlayerFactsBooksNumbers,
  type PlayerFactsInput,
  type PlayerFactsLastSeasonStory,
  type PlayerFactsPropsLine,
  type PlayerFactsRankedStat,
  type PlayerFactsSeasonSummary,
  type PlayerFactsTrend,
  type PlayerFactsUsage,
} from "./facts";
import { activePeersFor } from "./peers";
import { rankWithinGroups, type RankableStat } from "./rank";
import { buildTrendMetric } from "./trend";
import { collectDepthFacts, depthPriorSeasons } from "./facts/collect-depth";
import { EMPTY_DEPTH, type PlayerFactsDepth } from "./facts/types";

/**
 * THE FACTS COLLECTOR — every database read `buildPlayerFacts` needs, gathered ONCE for every
 * board-relevant player at a time (the sweep job's own unit of work), never one query per player.
 * `facts.ts` stays pure; this module is the only place that touches the database.
 *
 * THE GENERIC BOARD SHAPE. A capsule is a product-surface artifact, not a per-league one — the
 * same reasoning `draft-hq/hq/service.ts`/`draft-hq/sheet/seed.ts` already use for their own
 * board reads outside a specific league's own roster settings: `{teamCount: 12, rosterSlots:
 * STANDARD_ROSTER_SLOTS}`, the product's own generic default. The board's own `projectedPoints`/
 * `floorPoints`/`medianPoints`/`ceilingPoints`/`reasons` are shape-INDEPENDENT (composed once,
 * offline — `board/service.ts`'s own docblock); this module reads no shape-dependent field off
 * `BoardRow` (`valueOverReplacement`, `valueRank`, `positionRankInValue`, its own `tier` triad),
 * favouring the reasons-derived `scarcity`/`tier_cliff` facts instead, which are the same
 * shape-independent numbers `verdict.ts`/`groups.ts` already build the Outlook from.
 *
 * SEASON SUMMARY, CURRENT SEASON ONLY. `playerSeason` (the per-league player page) falls back to
 * a prior season's own point-in-time store when the current one has not kicked off yet; this
 * collector does not — a capsule fact sheet correctly has NO season summary in that common
 * preseason state (`facts.season` is `null`, and the writer/template both already handle that
 * honestly), rather than reaching for a borrowed prior year the way the full player page's own
 * UI widening does. Documented here as a deliberate scope line, not an oversight: adding the
 * prior-season fallback would mean porting `playerSeason`'s own crosswalk-and-observation-store
 * machinery into a league-free context, real additional engineering this task did not need to
 * duplicate to ship an honest preseason capsule.
 *
 * THE COLOR FACTS (spec §9 AMENDED 2026-09-05) ARE A DELIBERATELY SEPARATE READ from the scope line
 * just above: `lastSeasonStoriesFor`/`usageTouchesAndTrendFactsFor`/`propsLinesByPlayer`/`vegasWinTotalsByTeam`
 * below all target LAST season (or, for the props/win-total pair, the CURRENT season's own
 * pre-kickoff market) on purpose — a different question ("how did he do, what do the books say")
 * from the scope note above's ("has HE played a week of the CURRENT season yet"), so widening one
 * is not a reason to revisit the other. Each of the four is batched ONCE for the whole board, the
 * same discipline `currentSeasonSummaries` below already keeps.
 */

const GENERIC_BOARD_SHAPE: BoardOptions["shape"] = { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS };

/** `PROP_MARKETS`' own fixed order, as a lookup — the sort key `propsLinesByPlayer` uses so a
 *  player's `propsLines` array never depends on the database's own row order (facts.ts's own
 *  determinism rule: two calls with identical inputs produce byte-identical facts). */
const PROP_MARKET_ORDER: ReadonlyMap<PropMarket, number> = new Map(PROP_MARKETS.map((market, index) => [market, index] as const));

/** Display names for a set of nflverse player ids — the "who is the peer one rank above him" read
 *  `rankWithinGroups`'s named-neighbor field needs beyond a bare id. One query for the whole
 *  population passed in, never one per player; a name this function was not asked for is simply
 *  absent from the map, and every caller below falls back to the bare id in that rare case (a
 *  player `nfl_players` itself carries no name row for) rather than fail the whole sweep. */
async function namesForNflPlayerIds(db: Db, ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select({ id: nflPlayers.id, name: nflPlayers.name }).from(nflPlayers).where(inArray(nflPlayers.id, ids));
  return new Map(rows.map((row) => [row.id, row.name] as const));
}

/**
 * LAST SEASON'S STORY, for every skill-position player the prior-season stat store carries a
 * played week for — facts.ts's own "color facts" docblock, group (a). Built from the SAME
 * prior-season stat machinery `league-service/player.ts`'s `priorSeasonStats` already reads
 * (`statLinesAsOfForLiveSurface`, which already applies the gap-season derived-line substitution
 * on its own), but ONCE for the whole population rather than per player: a positional finish needs
 * every peer's own season total anyway, so batching is free precision a per-player read would not
 * have been able to afford (a peer population of one player is not a population).
 *
 * THE POPULATION IS EVERY SKILL-POSITION PLAYER THE STORE PLACES, not merely today's board — the
 * same "peers who played" rule as `league-service/player.ts`'s own peer reads: a player absent
 * from `rows` below never played a week and so never enters `weeksByPlayer`, which is what makes
 * "peers who played" true by construction rather than a filter this function has to apply itself.
 *
 * THE RANKED QUANTITIES (color v2, Task 1): total points and season-total receiving yards each
 * get a `rankWithinGroups` pass over this SAME "at least one played week" population, per
 * position — the honest qualifier this file's own `PlayerFactsLastSeasonStory.pointsRank`
 * docblock names. Receiving yards is summed straight off the same weekly `rows` the points totals
 * already walk, never a second database read — it is a genuine `StatLine` field
 * (`domain/player.ts`'s `STAT_FIELDS`), always present (zero, not absent) on a row this store
 * carries at all.
 *
 * TOUCHES IS DELIBERATELY NOT RANKED HERE (color v2, Task 1): `carries` is one of the "harvest
 * block" fields `STAT_FIELDS` excludes on purpose (`domain/player.ts`'s own docblock), so a
 * `StatLine` reconstructed from this point-in-time store NEVER carries a real one — reading it
 * here would silently under-count every rusher's touches. `usageAndProductionFactsFor` below ranks
 * touches instead, off `discoveryFactsForSeason`'s OWN `touches` quantity, which is built from the
 * real participation feed and already known-correct (`board-reasons.ts` already leans on it for
 * a law's own magnitude). `factsInputFor` merges that rank onto this function's own story object.
 */
export async function lastSeasonStoriesFor(db: Db, priorSeason: number, positions: ReadonlyMap<string, Position>, asOf: Date): Promise<ReadonlyMap<string, Omit<PlayerFactsLastSeasonStory, "touchesRank">>> {
  const skillPlayerIds = [...positions.entries()].filter(([, position]) => isSkillPosition(position)).map(([id]) => id);
  if (skillPlayerIds.length === 0) return new Map();

  const lastWeek = finalWeekOf(priorSeason);
  const rows = await statLinesAsOfForLiveSurface(db, { season: priorSeason, week: { from: 1, to: lastWeek }, asOf, playerIds: skillPlayerIds });
  const names = await namesForNflPlayerIds(db, skillPlayerIds);

  // Every week played at a position, pooled — the SAME population `league-service/player.ts`'s
  // `weekViews` judges a single week's percentile against — and every player's own weeks,
  // separately, for his own total/best-week/consistency read. Receiving yards is summed
  // alongside, from the identical rows, for the same players.
  const weeksByPosition = new Map<Position, number[]>();
  const weeksByPlayer = new Map<string, { readonly week: number; readonly points: number }[]>();
  const receivingYardsByPlayer = new Map<string, number>();
  for (const { line } of rows) {
    const position = positions.get(line.playerId);
    if (position === undefined) continue;
    const points = computeFantasyPoints(line, position, PPR_SCORING);
    const positionWeeks = weeksByPosition.get(position);
    if (positionWeeks === undefined) weeksByPosition.set(position, [points]);
    else positionWeeks.push(points);
    const playerWeeks = weeksByPlayer.get(line.playerId);
    if (playerWeeks === undefined) weeksByPlayer.set(line.playerId, [{ week: line.week, points }]);
    else playerWeeks.push({ week: line.week, points });
    receivingYardsByPlayer.set(line.playerId, (receivingYardsByPlayer.get(line.playerId) ?? 0) + line.receivingYards);
  }

  const medianByPosition = new Map<Position, number>();
  for (const [position, weeks] of weeksByPosition) medianByPosition.set(position, median(weeks));

  // Every player's own season total, by position — the rank population. A player never reaches
  // this map without at least one played week, which is what makes "peers who played" honest.
  const totalsByPosition = new Map<Position, { readonly playerId: string; readonly total: number }[]>();
  for (const [playerId, weeks] of weeksByPlayer) {
    const position = positions.get(playerId);
    if (position === undefined) continue;
    const total = roundPoints(weeks.reduce((sum, week) => sum + week.points, 0));
    const list = totalsByPosition.get(position);
    if (list === undefined) totalsByPosition.set(position, [{ playerId, total }]);
    else list.push({ playerId, total });
  }

  const nameOf = (playerId: string): string => names.get(playerId) ?? playerId;
  /** One `rankWithinGroups` pass, reusing `totalsByPosition`'s own grouping — the SAME "at least
   *  one played week" population for both of this function's ranked quantities, only the value
   *  being ranked changes. */
  const ranksFor = (valueOf: (entry: { readonly playerId: string; readonly total: number }) => number): ReadonlyMap<string, PlayerFactsRankedStat> =>
    rankWithinGroups(new Map([...totalsByPosition].map(([position, totals]) => [position, totals.map((t): RankableStat => ({ playerId: t.playerId, name: nameOf(t.playerId), value: valueOf(t) }))])));
  const pointsRanks = ranksFor((t) => t.total);
  const receivingYardsRanks = ranksFor((t) => receivingYardsByPlayer.get(t.playerId) ?? 0);

  const stories = new Map<string, Omit<PlayerFactsLastSeasonStory, "touchesRank">>();
  for (const [position, totals] of totalsByPosition) {
    const positionMedian = medianByPosition.get(position) ?? 0;
    for (const { playerId, total } of totals) {
      const weeks = weeksByPlayer.get(playerId)!;
      const bestWeek = weeks.reduce((best, week) => (week.points > best.points ? week : best), weeks[0]!);
      const weeksAboveMedian = weeks.filter((week) => week.points > positionMedian).length;
      stories.set(playerId, {
        season: priorSeason,
        pointsRank: pointsRanks.get(playerId)!,
        pointsPerGame: roundPoints(total / weeks.length),
        gamesPlayed: weeks.length,
        bestWeek: { week: bestWeek.week, points: roundPoints(bestWeek.points) },
        weeksAboveMedian,
        receivingYardsRank: receivingYardsRanks.get(playerId)!,
      });
    }
  }
  return stories;
}

/**
 * LAST SEASON'S USAGE, PLAIN — facts.ts's own "color facts" docblock, group (c). The SAME
 * `discoveryFactsForSeason` read a live board's own DISCOVERED law magnitudes are built from
 * (`board-reasons.ts`'s `magnitudeForDiscoveredLaw`, over `DiscoveryQuantityValues`) — one extra
 * batched read for the whole population, independent of whether any law actually fired for a given
 * player, which is the whole point: a share this real is worth stating even when no law claims it.
 *
 * `admitDerived` mirrors `preseason/source.ts`'s own `admitsDerivedPriorSeason` for a LIVE board's
 * prior season (this collector's board is always the live one — see this module's own "generic
 * board shape" docblock): `true` only when `priorSeason` is one of the narrow, explicitly-named
 * `LIVE_ADMITTED_DERIVED_SEASONS` nflverse never published a weekly stats file for.
 *
 * RANKING A RATE QUANTITY (color v2, Task 1, extended to touches below): the honest qualifier for
 * a share or a participation-derived quantity is different from a season TOTAL's
 * (`lastSeasonStoriesFor`'s own "at least one played week") — it is only ever ranked among the
 * peers `discoveryFactsForSeason` gave a REAL, non-null reading of that SAME quantity, per
 * position. A player this store saw for only a handful of snaps still gets an honest number if the
 * play-by-play/snap-count file admits one at all; the qualifier this file documents is exactly
 * "the store has real evidence for this quantity", never a separate, invented volume floor on top
 * of it.
 */
function rankedDiscoveryQuantity(discoveryFacts: ReadonlyMap<string, DiscoveryFacts>, names: ReadonlyMap<string, string>, select: (values: DiscoveryQuantityValues) => number | null): ReadonlyMap<string, PlayerFactsRankedStat> {
  const byPosition = new Map<Position, RankableStat[]>();
  for (const [playerId, playerFacts] of discoveryFacts) {
    const value = select(playerFacts.current);
    if (value === null) continue;
    const list = byPosition.get(playerFacts.position);
    const entry: RankableStat = { playerId, name: names.get(playerId) ?? playerId, value };
    if (list === undefined) byPosition.set(playerFacts.position, [entry]);
    else list.push(entry);
  }
  return rankWithinGroups(byPosition);
}

/** Season-total real yards (rushing plus receiving, both genuine `StatLine` fields) and season-
 *  total real targets (a raw PARTICIPATION count, the same observations `populations.ts`'s own
 *  private `seasonParticipation` reads, summed here directly since that function is not exported)
 *  — the two ingredients `yardsPerOpportunityFor` needs that `DiscoveryQuantityValues` does not
 *  carry (color v2, Task 2). */
interface SeasonYardsAndTargets {
  readonly totalYards: number;
  readonly targets: number;
}

async function seasonYardsAndTargetsFor(db: Db, season: number, skillPlayerIds: readonly string[], asOf: Date): Promise<ReadonlyMap<string, SeasonYardsAndTargets>> {
  if (skillPlayerIds.length === 0) return new Map();
  const lastWeek = finalWeekOf(season);
  const [statRows, participationRows] = await Promise.all([
    statLinesAsOfForLiveSurface(db, { season, week: { from: 1, to: lastWeek }, asOf, playerIds: skillPlayerIds }),
    observationsAsOf(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf, source: STAT_LINE_SOURCE, playerIds: skillPlayerIds }),
  ]);
  const totalYardsByPlayer = new Map<string, number>();
  for (const { line } of statRows) totalYardsByPlayer.set(line.playerId, (totalYardsByPlayer.get(line.playerId) ?? 0) + line.rushingYards + line.receivingYards);
  const targetsByPlayer = new Map<string, number>();
  for (const row of participationRows) {
    if (row.metric !== PARTICIPATION_METRICS.targets) continue;
    targetsByPlayer.set(row.playerId, (targetsByPlayer.get(row.playerId) ?? 0) + row.value);
  }
  const out = new Map<string, SeasonYardsAndTargets>();
  for (const playerId of skillPlayerIds) out.set(playerId, { totalYards: totalYardsByPlayer.get(playerId) ?? 0, targets: targetsByPlayer.get(playerId) ?? 0 });
  return out;
}

/** Nearest tenth — the same precision the task's own worked example states ("5.4 to 4.6"), never
 *  register precision on a rate this coarse. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** RB/QB read their workload in TOUCHES (carries plus receptions); WR/TE read it in raw TARGETS —
 *  a pure receiver's opportunity is better measured against every ball thrown his way, drops and
 *  broken-up passes included, than against catches alone (`PlayerFactsTrend.yardsPerOpportunity`'s
 *  own docblock). `null` when the chosen denominator itself has no real evidence, or is zero (a
 *  ratio with a zero denominator is not an honest number, never a fabricated infinity). */
function yardsPerOpportunityFor(position: Position, touches: number | null, yards: SeasonYardsAndTargets | undefined): number | null {
  if (yards === undefined) return null;
  const denominator = position === "WR" || position === "TE" ? yards.targets : touches;
  return denominator === null || denominator <= 0 ? null : round1(yards.totalYards / denominator);
}

/** Every real (non-null) reading of one quantity, pooled by position, across BOTH the current and
 *  the prior `DiscoveryQuantityValues` a `DiscoveryFacts` entry carries — the population
 *  `buildTrendMetric` measures materiality against (`trend.ts`'s own docblock: "pooled across both
 *  of the two seasons a trend measures"). */
function pooledDiscoveryValuesByPosition(discoveryFacts: ReadonlyMap<string, DiscoveryFacts>, select: (values: DiscoveryQuantityValues) => number | null): ReadonlyMap<Position, number[]> {
  const byPosition = new Map<Position, number[]>();
  const add = (position: Position, value: number | null) => {
    if (value === null) return;
    const list = byPosition.get(position);
    if (list === undefined) byPosition.set(position, [value]);
    else list.push(value);
  };
  for (const facts of discoveryFacts.values()) {
    add(facts.position, select(facts.current));
    if (facts.prior !== null) add(facts.position, select(facts.prior));
  }
  return byPosition;
}

/** `usageTouchesAndTrendFactsFor`'s own return: the usage shares, the touches rank
 *  `lastSeasonStoriesFor` cannot honestly compute itself (see that function's own docblock), and
 *  the year-over-year trend — all three come out of the SAME `discoveryFactsForSeason` read, so
 *  they are built together rather than paying for that read twice. */
export interface UsageTouchesAndTrendFacts {
  readonly usageByPlayerId: ReadonlyMap<string, PlayerFactsUsage>;
  readonly touchesRankByPlayerId: ReadonlyMap<string, PlayerFactsRankedStat>;
  readonly trendByPlayerId: ReadonlyMap<string, PlayerFactsTrend>;
}

/**
 * THE TREND (color v2, Task 2) — year-over-year deltas from his own prior two seasons.
 * `discoveryFactsForSeason(db, recentSeason, …)` already reads BOTH seasons in one call
 * (`current` = `recentSeason`, `prior` = `recentSeason - 1`), so `pointsPerGame` and `targetShare`
 * cost nothing extra; `yardsPerOpportunity` needs one more pair of season reads
 * (`seasonYardsAndTargetsFor`) since neither total yards nor a raw target count live on
 * `DiscoveryQuantityValues`. A player `discoveryFacts.prior` is `null` for (his own prior two
 * seasons do not both exist — a sophomore, most often) gets no entry in the returned map at all,
 * matching `PlayerFacts.trend`'s own `null` contract.
 */
async function trendsFor(db: Db, discoveryFacts: ReadonlyMap<string, DiscoveryFacts>, recentSeason: number, asOf: Date): Promise<ReadonlyMap<string, PlayerFactsTrend>> {
  const olderSeason = recentSeason - 1;
  const skillPlayerIds = [...discoveryFacts.keys()];
  const [recentYards, olderYards] = await Promise.all([
    seasonYardsAndTargetsFor(db, recentSeason, skillPlayerIds, asOf),
    seasonYardsAndTargetsFor(db, olderSeason, skillPlayerIds, asOf),
  ]);

  const yardsPerOpportunityByPlayer = new Map<string, { readonly recent: number | null; readonly older: number | null }>();
  for (const [playerId, facts] of discoveryFacts) {
    const recent = yardsPerOpportunityFor(facts.position, facts.current.touches, recentYards.get(playerId));
    const older = facts.prior === null ? null : yardsPerOpportunityFor(facts.position, facts.prior.touches, olderYards.get(playerId));
    yardsPerOpportunityByPlayer.set(playerId, { recent, older });
  }
  const yardsPerOpportunityPools = new Map<Position, number[]>();
  for (const [playerId, { recent, older }] of yardsPerOpportunityByPlayer) {
    const position = discoveryFacts.get(playerId)!.position;
    const list = yardsPerOpportunityPools.get(position) ?? [];
    if (recent !== null) list.push(recent);
    if (older !== null) list.push(older);
    if (list.length > 0) yardsPerOpportunityPools.set(position, list);
  }

  const pointsPerGamePools = pooledDiscoveryValuesByPosition(discoveryFacts, (v) => v.pointsPerGame);
  const targetSharePools = pooledDiscoveryValuesByPosition(discoveryFacts, (v) => v.targetShare);

  const trends = new Map<string, PlayerFactsTrend>();
  for (const [playerId, facts] of discoveryFacts) {
    if (facts.prior === null) continue;
    const pointsPerGame = buildTrendMetric(olderSeason, facts.prior.pointsPerGame, recentSeason, facts.current.pointsPerGame, pointsPerGamePools.get(facts.position) ?? []);
    const targetShare = buildTrendMetric(olderSeason, facts.prior.targetShare, recentSeason, facts.current.targetShare, targetSharePools.get(facts.position) ?? []);
    const opportunityYards = yardsPerOpportunityByPlayer.get(playerId)!;
    const yardsPerOpportunity = buildTrendMetric(olderSeason, opportunityYards.older, recentSeason, opportunityYards.recent, yardsPerOpportunityPools.get(facts.position) ?? []);
    if (pointsPerGame === null && targetShare === null && yardsPerOpportunity === null) continue;
    trends.set(playerId, { pointsPerGame, yardsPerOpportunity, targetShare });
  }
  return trends;
}

export async function usageTouchesAndTrendFactsFor(db: Db, priorSeason: number, positions: ReadonlyMap<string, Position>, asOf: Date): Promise<UsageTouchesAndTrendFacts> {
  const admitDerived = LIVE_ADMITTED_DERIVED_SEASONS.includes(priorSeason);
  const discoveryFacts = await discoveryFactsForSeason(db, priorSeason, positions, PPR_SCORING, admitDerived, asOf);
  const names = await namesForNflPlayerIds(db, [...discoveryFacts.keys()]);

  const snapShareRanks = rankedDiscoveryQuantity(discoveryFacts, names, (v) => v.snapShare);
  const targetShareRanks = rankedDiscoveryQuantity(discoveryFacts, names, (v) => v.targetShare);
  const redZoneShareRanks = rankedDiscoveryQuantity(discoveryFacts, names, (v) => v.redZoneTouchShare);
  const touchesRankByPlayerId = rankedDiscoveryQuantity(discoveryFacts, names, (v) => v.touches);
  const trendByPlayerId = await trendsFor(db, discoveryFacts, priorSeason, asOf);

  const usageByPlayerId = new Map<string, PlayerFactsUsage>();
  for (const [playerId, playerFacts] of discoveryFacts) {
    usageByPlayerId.set(playerId, {
      season: priorSeason,
      snapShare: playerFacts.current.snapShare,
      snapShareRank: snapShareRanks.get(playerId) ?? null,
      targetShare: playerFacts.current.targetShare,
      targetShareRank: targetShareRanks.get(playerId) ?? null,
      redZoneShare: playerFacts.current.redZoneTouchShare,
      redZoneShareRank: redZoneShareRanks.get(playerId) ?? null,
    });
  }
  return { usageByPlayerId, touchesRankByPlayerId, trendByPlayerId };
}

/**
 * THE BOOKS' OWN PROPS LINES, for every nflverse player id the leakage-gated archive captured a
 * pre-kickoff median for — facts.ts's own "color facts" docblock, group (b). Reuses
 * `medianPropLinesByPlayer` (`projections/market/props-anchor.ts`), the SAME leakage gate and
 * week-one window `propsAnchorForSeason` anchors the board with, rather than the blended points
 * figure that function folds the medians into — a capsule wants the raw line ("receiving yards
 * 1150.5"), never this engine's own derived points number.
 *
 * Empty when the season has no ingested schedule yet (`firstKickoffFor` returns `null`) or the
 * archive holds no pre-kickoff line at all — the identical "nothing to anchor on" state
 * `propsAnchorForSeason` itself already treats as empty, never an error.
 */
export async function propsLinesByPlayer(db: Db, season: number): Promise<ReadonlyMap<string, readonly PlayerFactsPropsLine[]>> {
  const firstKickoff = await firstKickoffFor(db, season);
  if (firstKickoff === null) return new Map();
  const lines = await loadArchivedPropLines(db, season, firstKickoff);
  const mediansByPlayer = medianPropLinesByPlayer(lines, firstKickoff);

  const out = new Map<string, readonly PlayerFactsPropsLine[]>();
  for (const [playerId, medians] of mediansByPlayer) {
    const sorted = [...medians.entries()].sort(([a], [b]) => PROP_MARKET_ORDER.get(a)! - PROP_MARKET_ORDER.get(b)!);
    out.set(playerId, sorted.map(([market, medianLine]) => ({ market, medianLine })));
  }
  return out;
}

/** Every team's posted regular-season win total for `season`, `team_week_observations` source
 *  `vegas_win_totals` — facts.ts's own "color facts" docblock, group (b). Keyed by the player's
 *  CURRENT team (`BoardRow.team`), never a prior season's, so a player who changed teams this
 *  offseason is never credited with his old team's number: a fact this direct has no honest
 *  approximation to fall back on. */
export async function vegasWinTotalsByTeam(db: Db, season: number, asOf: Date): Promise<ReadonlyMap<string, number>> {
  const rows = await teamObservationsAsOf(db, { season, week: 1, asOf, source: VEGAS_SOURCE });
  const winTotals = new Map<string, number>();
  for (const row of rows) if (row.metric === VEGAS_METRICS.winTotal) winTotals.set(row.team, row.value);
  return winTotals;
}

/** Every played-week total for `playerIds`, under this product's standard PPR scoring (the same
 *  fixed format the shipped board itself is composed under). A player with no played week yet
 *  this season is simply absent from the returned map — never a fabricated zero. */
export async function currentSeasonSummaries(db: Db, playerIds: readonly string[], positionOf: ReadonlyMap<string, Position>): Promise<ReadonlyMap<string, PlayerFactsSeasonSummary>> {
  const summaries = new Map<string, PlayerFactsSeasonSummary>();
  if (playerIds.length === 0) return summaries;

  const weekRows = await db.select({ week: statWeeks.week }).from(statWeeks).where(ne(statWeeks.status, "scheduled"));
  const played = weekRows.map((row) => row.week);
  if (played.length === 0) return summaries;

  const lines: readonly StatLine[] = await db
    .select()
    .from(playerStatLines)
    .where(and(inArray(playerStatLines.playerId, playerIds), inArray(playerStatLines.week, played)));

  const byPlayer = new Map<string, StatLine[]>();
  for (const line of lines) {
    const bucket = byPlayer.get(line.playerId);
    if (bucket === undefined) byPlayer.set(line.playerId, [line]);
    else bucket.push(line);
  }

  for (const [playerId, myLines] of byPlayer) {
    const position = positionOf.get(playerId);
    if (position === undefined) continue;
    let carries = 0;
    let rushingYards = 0;
    let targets = 0;
    let receptions = 0;
    let receivingYards = 0;
    let passingYards = 0;
    let touchdowns = 0;
    let fantasyPoints = 0;
    for (const line of myLines) {
      // The current season's own rows always default these to `0` in the database (see
      // `player_stat_lines`' own docblock) — the `?? 0` here satisfies `StatLine`'s wider,
      // optional-for-a-prior-season type, never standing in for a genuinely missing reading.
      carries += line.carries ?? 0;
      rushingYards += line.rushingYards;
      targets += line.targets ?? 0;
      receptions += line.receptions;
      receivingYards += line.receivingYards;
      passingYards += line.passingYards;
      touchdowns += line.rushingTouchdowns + line.receivingTouchdowns + line.passingTouchdowns;
      fantasyPoints += computeFantasyPoints(line, position, PPR_SCORING);
    }
    const gamesPlayed = myLines.length;
    summaries.set(playerId, {
      season: PRODUCT_SEASON,
      gamesPlayed,
      pointsPerGame: roundPoints(fantasyPoints / gamesPlayed),
      totals: { carries, rushingYards, targets, receptions, receivingYards, passingYards, touchdowns, fantasyPoints: roundPoints(fantasyPoints) },
    });
  }
  return summaries;
}

/** THE TRI-STATE READ (fix round 1, CRITICAL 2) — `injuries.capturedAt` is the read-PRESENCE
 *  signal: `null` means no snapshot has EVER been captured (`"unknown"`, never a healthy claim);
 *  a real capture instant with no designation for this player is a genuine, dated "clean" read;
 *  a real capture instant that DOES name him is `"designated"`. Collapsing "clean" and "unknown"
 *  into one nullable string (the prior shape) rendered "never checked" identically to "checked
 *  and healthy" — a real conflation `facts.ts`'s own `PlayerFactsInjuryStatus` docblock covers. */
function injuryStatusFor(playerId: string, injuries: InjurySnapshot): PlayerFactsInput["injury"] {
  if (injuries.capturedAt === null) return { state: "unknown" };
  const asOf = injuries.capturedAt.toISOString();
  const designation = injuries.designations.get(playerId);
  return designation === undefined ? { state: "clean", asOf } : { state: "designated", designation, asOf };
}

/** Every color fact this collector computes in one batched pass, per NFLVERSE (gsis) player id
 *  except `winTotalByTeam`, which is keyed by team — see each builder's own docblock above.
 *  `lastSeasonStoryByGsisId` and `touchesRankByGsisId` are two SEPARATE reads (`lastSeasonStoriesFor`
 *  cannot honestly compute a touches rank itself — see its own docblock); `factsInputFor` merges
 *  them into one `PlayerFactsLastSeasonStory` below. */
export interface ColorFacts {
  readonly lastSeasonStoryByGsisId: ReadonlyMap<string, Omit<PlayerFactsLastSeasonStory, "touchesRank">>;
  readonly touchesRankByGsisId: ReadonlyMap<string, PlayerFactsRankedStat>;
  readonly usageByGsisId: ReadonlyMap<string, PlayerFactsUsage>;
  readonly trendByGsisId: ReadonlyMap<string, PlayerFactsTrend>;
  readonly propsLinesByGsisId: ReadonlyMap<string, readonly PlayerFactsPropsLine[]>;
  readonly winTotalByTeam: ReadonlyMap<string, number>;
  readonly gsisIdByPlayerId: ReadonlyMap<string, string>;
  /** THE DEPTH FACTS (spec `2026-09-07-fact-sheet-depth-design.md`), from the one batched pass in
   *  `facts/collect-depth.ts`. Keyed by nflverse id like every other map here; a player the depth
   *  stores hold nothing for is simply absent and `factsInputFor` substitutes `EMPTY_DEPTH`. */
  readonly depthByGsisId: ReadonlyMap<string, PlayerFactsDepth>;
}

/** The subset of `BoardRow` (`draft-hq/board/service.ts`) `factsInputFor` actually reads — the
 *  shape-INDEPENDENT fields this module's own top docblock already names (never `valueOverReplacement`/
 *  `valueRank`/`positionRankInValue`/`tier`/`overallRank`/`nflPlayerId`/`headshotUrl`, all absent
 *  here on purpose). Narrowed to a `Pick` rather than the full `BoardRow` so `collect-one.ts`'s
 *  single-player collector can build one of these from a single narrow-scoped row read instead of
 *  running the whole-board value/tier recompute for one man; a real `BoardRow` still satisfies this
 *  type structurally, so `collectAllPlayerFacts` below passes one unchanged. */
export type FactsBoardRowInput = Pick<ProjectedBoardRow, "playerId" | "name" | "position" | "team" | "marketAdp" | "marketPositionAdp" | "rank" | "projectedPoints" | "floorPoints" | "medianPoints" | "ceilingPoints" | "byeWeek" | "reasons">;

function lastSeasonStoryFor(gsisId: string | undefined, color: ColorFacts): PlayerFactsLastSeasonStory | null {
  if (gsisId === undefined) return null;
  const story = color.lastSeasonStoryByGsisId.get(gsisId);
  if (story === undefined) return null;
  return { ...story, touchesRank: color.touchesRankByGsisId.get(gsisId) ?? null };
}

export function factsInputFor(
  row: FactsBoardRowInput,
  season: PlayerFactsSeasonSummary | undefined,
  injuries: InjurySnapshot,
  news: ReadonlyMap<string, readonly NewsStory[]>,
  laws: PlayerFactsInput["laws"],
  color: ColorFacts,
): PlayerFactsInput {
  const gsisId = color.gsisIdByPlayerId.get(row.playerId);
  const propsLines = gsisId === undefined ? [] : (color.propsLinesByGsisId.get(gsisId) ?? []);
  // THE WIN TOTAL IS KEYED BY THE NFLVERSE SPELLING, and the board row carries the PRODUCT one
  // (`nflverse/team-codes.ts`): the product says `LAR` and `WSH` where `team_week_observations`
  // says `LA` and `WAS`. Reading it by the board's own code silently returned nothing for exactly
  // those two franchises, which rendered as "the books have posted no win total for the Rams"
  // rather than as the lookup miss it was. `sourceTeamCode` is the one normalizer for this, and it
  // leaves every other code untouched.
  const booksNumbers: PlayerFactsBooksNumbers = { propsLines, teamVegasWinTotal: color.winTotalByTeam.get(sourceTeamCode(row.team)) ?? null };
  return {
    identity: { id: row.playerId, name: row.name, position: row.position, team: row.team },
    productSeason: PRODUCT_SEASON,
    reasons: row.reasons,
    laws,
    market: { adp: row.marketAdp, positionAdp: row.marketPositionAdp, boardRank: row.rank },
    projection: { projectedPoints: row.projectedPoints, floorPoints: row.floorPoints, medianPoints: row.medianPoints, ceilingPoints: row.ceilingPoints },
    byeWeek: row.byeWeek,
    season: season ?? null,
    injury: injuryStatusFor(row.playerId, injuries),
    news: news.get(row.name) ?? [],
    lastSeasonStory: lastSeasonStoryFor(gsisId, color),
    usage: (gsisId === undefined ? undefined : color.usageByGsisId.get(gsisId)) ?? null,
    trend: (gsisId === undefined ? undefined : color.trendByGsisId.get(gsisId)) ?? null,
    depth: (gsisId === undefined ? undefined : color.depthByGsisId.get(gsisId)) ?? EMPTY_DEPTH,
    booksNumbers,
  };
}

/**
 * ONE PASS'S WHOLE RESULT — the facts themselves plus the three things a SECOND consumer of the same
 * pass needs and `PlayerFacts` does not carry (peek-facts round, 2026-09-07).
 *
 * The precompute writer (`capsules/peek-facts.ts`) rides on this pass rather than running a second
 * heavy one of its own, which is the design's "no second heavy job" rule. What it needs beyond the
 * facts is the crosswalk map (to look a player's per-game rank up by nflverse id) and the two
 * numbers a stored fact's BASIS has to state: how many peers a rank was taken over, and whether the
 * prior-season read produced any players at all.
 */
export interface BoardFactsPass {
  readonly facts: readonly PlayerFacts[];
  /** Product player id to nflverse id, for every board player. */
  readonly gsisIdByPlayerId: ReadonlyMap<string, string>;
  /** How many ACTIVE peers each position's ranks were taken over — the qualifier a stored rank
   *  states in its basis. */
  readonly peerCountByPosition: ReadonlyMap<Position, number>;
  /** The season the color facts describe. */
  readonly priorSeason: number;
  /** How many players the prior-season read produced a story for. ZERO is the state the touches
   *  refusal exists for: a rank taken over an empty line set is not a rank. */
  readonly priorSeasonPlayerCount: number;
  readonly asOf: Date;
}

/** Every board-ranked player's facts, in one bounded pass: one `boardRows` read, one injury
 *  snapshot read, one news-snapshot read (serving every name at once,
 *  `newsForPlayers`), one season-stat-lines read, the law registry read once off disk, and the
 *  "color facts" reads (spec §9 AMENDED 2026-09-05 — `lastSeasonStoriesFor`/
 *  `usageTouchesAndTrendFactsFor`/`propsLinesByPlayer`/`vegasWinTotalsByTeam`, this module's own
 *  docblock), each batched once for the whole board rather than once per player. The sweep job
 *  calls this once per run and diffs each player's own `factsHash` against the stored row
 *  (`store.ts`) to decide who actually needs a fresh generation, then hands the SAME pass to the
 *  peek-facts writer rather than paying for it twice. */
export async function collectBoardFacts(db: Db, asOf: Date = new Date()): Promise<BoardFactsPass> {
  const priorSeason = PRODUCT_SEASON - 1;
  const empty: BoardFactsPass = { facts: [], gsisIdByPlayerId: new Map(), peerCountByPosition: new Map(), priorSeason, priorSeasonPlayerCount: 0, asOf };
  const rows = await boardRows(db, { shape: GENERIC_BOARD_SHAPE, asOf });
  if (rows.length === 0) return empty;

  const laws = chipEligibleLaws(registry());
  const positionOf = new Map(rows.map((row) => [row.playerId, row.position] as const));
  // THE ACTIVE POPULATION, NOT THE HISTORICAL UNIVERSE (peek-facts design §3.3). This used to be
  // `allPositions(db)` — every person nflverse has ever placed, 3,293 receivers back to 1999 — which
  // the color reads below then turned into chunked `IN` lists over the observation store. The ranks
  // themselves do not move: a peer with no week in the prior season never entered a ranked
  // population in the first place, and `activePeersFor`'s own membership test (a board row, or a
  // week in this season or the prior one) is a superset of that. What moves is the query cost.
  const [injuries, news, seasons, positions, gsisIdByPlayerId] = await Promise.all([
    injurySnapshot(db),
    newsForPlayers(db, rows.map((row) => row.name)),
    currentSeasonSummaries(db, rows.map((row) => row.playerId), positionOf),
    activePeersFor(db, [...new Set(rows.map((row) => row.position))], PRODUCT_SEASON),
    nflPlayerIdsFor(db, rows.map((row) => row.playerId)),
  ]);

  // THE DEPTH PASS'S OWN SUBJECT MAP: every board player's nflverse id against the team the board
  // has him on today. A board row the crosswalk never placed contributes nothing, exactly as it
  // already contributes nothing to any other nflverse-keyed colour fact.
  const teamByPlayerId = new Map<string, string>();
  for (const row of rows) {
    const gsisId = gsisIdByPlayerId.get(row.playerId);
    if (gsisId !== undefined) teamByPlayerId.set(gsisId, row.team);
  }

  const [lastSeasonStoryByGsisId, usageTouchesAndTrend, propsLinesByGsisId, winTotalByTeam, depthPass] = await Promise.all([
    lastSeasonStoriesFor(db, priorSeason, positions, asOf),
    usageTouchesAndTrendFactsFor(db, priorSeason, positions, asOf),
    propsLinesByPlayer(db, PRODUCT_SEASON),
    vegasWinTotalsByTeam(db, PRODUCT_SEASON, asOf),
    collectDepthFacts(db, { productSeason: PRODUCT_SEASON, priorSeasons: depthPriorSeasons(PRODUCT_SEASON), positions, teamByPlayerId, asOf }),
  ]);
  const color: ColorFacts = {
    lastSeasonStoryByGsisId,
    touchesRankByGsisId: usageTouchesAndTrend.touchesRankByPlayerId,
    usageByGsisId: usageTouchesAndTrend.usageByPlayerId,
    trendByGsisId: usageTouchesAndTrend.trendByPlayerId,
    propsLinesByGsisId,
    winTotalByTeam,
    gsisIdByPlayerId,
    depthByGsisId: depthPass.byPlayerId,
  };

  const peerCountByPosition = new Map<Position, number>();
  for (const position of positions.values()) peerCountByPosition.set(position, (peerCountByPosition.get(position) ?? 0) + 1);

  const facts = rows
    // A ROW WITH NO PROJECTION IS NOT A CAPSULE SUBJECT (the 2026-09-05 kicker and team defence
    // round). The board now carries market-order rows for a position the engine published nothing
    // for, and `PlayerFactsInput.projection` is four numbers rather than four maybe-numbers on
    // purpose: a capsule is written ABOUT a projection. Both positions are already outside
    // `isSkillPosition`, so nothing reaches here in practice, and this is the type-level statement
    // of the same rule: it drops the row rather than coercing an absence to a zero somebody would
    // later read as a measurement.
    .filter(isProjectedRow)
    .map((row) => buildPlayerFacts(factsInputFor(row, seasons.get(row.playerId), injuries, news, laws, color)));

  return { facts, gsisIdByPlayerId, peerCountByPosition, priorSeason, priorSeasonPlayerCount: lastSeasonStoryByGsisId.size, asOf };
}

/** The facts alone, for every caller that wants nothing else off the pass. A thin wrapper over
 *  `collectBoardFacts` rather than a second implementation of it. */
export async function collectAllPlayerFacts(db: Db, asOf: Date = new Date()): Promise<readonly PlayerFacts[]> {
  return (await collectBoardFacts(db, asOf)).facts;
}
