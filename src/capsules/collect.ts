import { and, inArray, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { playerStatLines, statWeeks } from "@/db/schema";
import type { Position, StatLine } from "@/domain/player";
import { PPR_SCORING } from "@/domain/scoring";
import { boardRows, type BoardOptions, type BoardRow } from "@/draft-hq/board/service";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { injurySnapshot, type InjurySnapshot } from "@/league-service/injuries";
import { newsForPlayers, type NewsStory } from "@/league-service/news";
import { allPositions } from "@/projections/backtest";
import { nflPlayerIdsFor } from "@/projections/crosswalk";
import { discoveryFactsForSeason } from "@/projections/laws/discovery-facts";
import { isSkillPosition } from "@/projections/laws/populations";
import { chipEligibleLaws, registry } from "@/projections/laws/registry";
import { loadArchivedPropLines, median, medianPropLinesByPlayer } from "@/projections/market/props-anchor";
import { statLinesAsOfForLiveSurface } from "@/projections/nflverse/derived-stat-lines";
import { LIVE_ADMITTED_DERIVED_SEASONS } from "@/projections/nflverse/stat-lines";
import { finalWeekOf } from "@/projections/nflverse/team-eras";
import { PROP_MARKETS, type PropMarket } from "@/projections/odds/props-store";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
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
  type PlayerFactsSeasonSummary,
  type PlayerFactsUsage,
} from "./facts";

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
 * just above: `lastSeasonStoriesFor`/`usageFactsFor`/`propsLinesByPlayer`/`vegasWinTotalsByTeam`
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
 */
async function lastSeasonStoriesFor(db: Db, priorSeason: number, positions: ReadonlyMap<string, Position>, asOf: Date): Promise<ReadonlyMap<string, PlayerFactsLastSeasonStory>> {
  const skillPlayerIds = [...positions.entries()].filter(([, position]) => isSkillPosition(position)).map(([id]) => id);
  if (skillPlayerIds.length === 0) return new Map();

  const lastWeek = finalWeekOf(priorSeason);
  const rows = await statLinesAsOfForLiveSurface(db, { season: priorSeason, week: { from: 1, to: lastWeek }, asOf, playerIds: skillPlayerIds });

  // Every week played at a position, pooled — the SAME population `league-service/player.ts`'s
  // `weekViews` judges a single week's percentile against — and every player's own weeks,
  // separately, for his own total/best-week/consistency read.
  const weeksByPosition = new Map<Position, number[]>();
  const weeksByPlayer = new Map<string, { readonly week: number; readonly points: number }[]>();
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

  const stories = new Map<string, PlayerFactsLastSeasonStory>();
  for (const [position, totals] of totalsByPosition) {
    const positionMedian = medianByPosition.get(position) ?? 0;
    for (const { playerId, total } of totals) {
      const weeks = weeksByPlayer.get(playerId)!;
      const positionRank = 1 + totals.filter((peer) => peer.total > total).length;
      const bestWeek = weeks.reduce((best, week) => (week.points > best.points ? week : best), weeks[0]!);
      const weeksAboveMedian = weeks.filter((week) => week.points > positionMedian).length;
      stories.set(playerId, {
        season: priorSeason,
        positionRank,
        pointsPerGame: roundPoints(total / weeks.length),
        gamesPlayed: weeks.length,
        bestWeek: { week: bestWeek.week, points: roundPoints(bestWeek.points) },
        weeksAboveMedian,
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
 */
async function usageFactsFor(db: Db, priorSeason: number, positions: ReadonlyMap<string, Position>, asOf: Date): Promise<ReadonlyMap<string, PlayerFactsUsage>> {
  const admitDerived = LIVE_ADMITTED_DERIVED_SEASONS.includes(priorSeason);
  const discoveryFacts = await discoveryFactsForSeason(db, priorSeason, positions, PPR_SCORING, admitDerived, asOf);
  const usage = new Map<string, PlayerFactsUsage>();
  for (const [playerId, playerFacts] of discoveryFacts) {
    usage.set(playerId, {
      season: priorSeason,
      snapShare: playerFacts.current.snapShare,
      targetShare: playerFacts.current.targetShare,
      redZoneShare: playerFacts.current.redZoneTouchShare,
    });
  }
  return usage;
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
async function propsLinesByPlayer(db: Db, season: number): Promise<ReadonlyMap<string, readonly PlayerFactsPropsLine[]>> {
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
async function vegasWinTotalsByTeam(db: Db, season: number, asOf: Date): Promise<ReadonlyMap<string, number>> {
  const rows = await teamObservationsAsOf(db, { season, week: 1, asOf, source: VEGAS_SOURCE });
  const winTotals = new Map<string, number>();
  for (const row of rows) if (row.metric === VEGAS_METRICS.winTotal) winTotals.set(row.team, row.value);
  return winTotals;
}

/** Every played-week total for `playerIds`, under this product's standard PPR scoring (the same
 *  fixed format the shipped board itself is composed under). A player with no played week yet
 *  this season is simply absent from the returned map — never a fabricated zero. */
async function currentSeasonSummaries(db: Db, playerIds: readonly string[], positionOf: ReadonlyMap<string, Position>): Promise<ReadonlyMap<string, PlayerFactsSeasonSummary>> {
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
 *  except `winTotalByTeam`, which is keyed by team — see each builder's own docblock above. */
interface ColorFacts {
  readonly lastSeasonStoryByGsisId: ReadonlyMap<string, PlayerFactsLastSeasonStory>;
  readonly usageByGsisId: ReadonlyMap<string, PlayerFactsUsage>;
  readonly propsLinesByGsisId: ReadonlyMap<string, readonly PlayerFactsPropsLine[]>;
  readonly winTotalByTeam: ReadonlyMap<string, number>;
  readonly gsisIdByPlayerId: ReadonlyMap<string, string>;
}

function factsInputFor(
  row: BoardRow,
  season: PlayerFactsSeasonSummary | undefined,
  injuries: InjurySnapshot,
  news: ReadonlyMap<string, readonly NewsStory[]>,
  laws: PlayerFactsInput["laws"],
  color: ColorFacts,
): PlayerFactsInput {
  const gsisId = color.gsisIdByPlayerId.get(row.playerId);
  const propsLines = gsisId === undefined ? [] : (color.propsLinesByGsisId.get(gsisId) ?? []);
  const booksNumbers: PlayerFactsBooksNumbers = { propsLines, teamVegasWinTotal: color.winTotalByTeam.get(row.team) ?? null };
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
    lastSeasonStory: (gsisId === undefined ? undefined : color.lastSeasonStoryByGsisId.get(gsisId)) ?? null,
    usage: (gsisId === undefined ? undefined : color.usageByGsisId.get(gsisId)) ?? null,
    booksNumbers,
  };
}

/** Every board-ranked player's facts, in one bounded pass: one `boardRows` read, one injury
 *  snapshot read, one news-snapshot read (serving every name at once,
 *  `newsForPlayers`), one season-stat-lines read, the law registry read once off disk, and the
 *  four "color facts" reads (spec §9 AMENDED 2026-09-05 — `lastSeasonStoriesFor`/`usageFactsFor`/
 *  `propsLinesByPlayer`/`vegasWinTotalsByTeam`, this module's own docblock), each batched once for
 *  the whole board rather than once per player. The sweep job calls this once per run and diffs
 *  each player's own `factsHash` against the stored row (`store.ts`) to decide who actually needs
 *  a fresh generation. */
export async function collectAllPlayerFacts(db: Db, asOf: Date = new Date()): Promise<readonly PlayerFacts[]> {
  const rows = await boardRows(db, { shape: GENERIC_BOARD_SHAPE, asOf });
  if (rows.length === 0) return [];

  const laws = chipEligibleLaws(registry());
  const positionOf = new Map(rows.map((row) => [row.playerId, row.position] as const));
  const priorSeason = PRODUCT_SEASON - 1;
  const [injuries, news, seasons, positions, gsisIdByPlayerId] = await Promise.all([
    injurySnapshot(db),
    newsForPlayers(db, rows.map((row) => row.name)),
    currentSeasonSummaries(db, rows.map((row) => row.playerId), positionOf),
    allPositions(db),
    nflPlayerIdsFor(db, rows.map((row) => row.playerId)),
  ]);

  const [lastSeasonStoryByGsisId, usageByGsisId, propsLinesByGsisId, winTotalByTeam] = await Promise.all([
    lastSeasonStoriesFor(db, priorSeason, positions, asOf),
    usageFactsFor(db, priorSeason, positions, asOf),
    propsLinesByPlayer(db, PRODUCT_SEASON),
    vegasWinTotalsByTeam(db, PRODUCT_SEASON, asOf),
  ]);
  const color: ColorFacts = { lastSeasonStoryByGsisId, usageByGsisId, propsLinesByGsisId, winTotalByTeam, gsisIdByPlayerId };

  return rows.map((row) => buildPlayerFacts(factsInputFor(row, seasons.get(row.playerId), injuries, news, laws, color)));
}
