// EVERY READ A BUILD OF PEEK DOCUMENTS NEEDS, GATHERED ONCE FOR THE WHOLE PLAYER LIST (peek
// document design §3.3, 2026-09-07). `peek-document.ts` stays pure; this module is the only place
// the document's inputs touch the database, exactly the split `collect.ts` already makes for the
// capsule facts.
//
// NOTHING IS READ ONCE PER PLAYER. The expensive shapes are per POSITION and per SEASON, not per
// man: one read of the product's player universe serves identity, the position rank and the ADP
// percentile for everybody; one read of the current season's stat lines serves every position's
// chart; one read per (position, prior season) serves every prior season's chart. That is what makes
// a whole-hash build a bounded number of statements rather than seven hundred small ones.
//
// IT READS WHAT THE PRODUCT ALREADY READS. `player_peek_facts` for the dossier, the capsule store
// for the capsule, the harvest captures for the designation and the headlines, the observation and
// stat-line readers for the seasons. There is no second store and no second definition of anything.
import { eq, inArray, ne } from "drizzle-orm";
import type { Db } from "@research-ts/db/client";
import { nflPlayers, players, playerStatLines, statWeeks } from "@research-ts/db/schema";
import type { Player, Position, StatLine } from "@research-ts/domain/player";
import {
  kdefSeasonStatsFrom,
  percentileOf,
  seasonStatsFromLines,
  type PlayerSeasonStats,
} from "@/league-service/player-season-stats";
import { newsSnapshotForPlayers } from "@research-ts/reference/news";
import { injurySnapshot } from "@research-ts/reference/injuries";
import { nflPlayerIdsFor } from "@research-ts/projections/crosswalk";
import { kdefSeasonLines, type KdefSeasonLine } from "@research-ts/projections/kdef/season-lines";
import { STAT_LINE_SOURCE } from "@research-ts/projections/lines";
import { admitsDerivedForLiveSurface, DERIVED_STAT_LINE_SOURCE, statLinesAsOfForLiveSurface } from "@research-ts/projections/nflverse/derived-stat-lines";
import { finalWeekOf } from "@research-ts/projections/nflverse/team-eras";
import { BENCHMARK_SOURCES } from "@research-ts/projections/preseason/benchmarks";
import type { BoardReason } from "@research-ts/projections/preseason/board";
import { assertSingleGeneration, BOARD_SOURCE, boardReasons, preseasonProjectionsFor } from "@research-ts/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@research-ts/projections/preseason/current";
import { preseasonRankingsFor } from "@research-ts/projections/preseason/store";
import type { ScoringRules } from "@research-ts/scoring";
import { getStoredCapsulesFor } from "@research-ts/capsules/store";
import { priorSeasonCandidates, readPeekFactsFor } from "./peek-facts";
import { PEEK_FACTS_SOURCE } from "./peek-facts-row";
import type { PeekDocumentBasis } from "./peek-document-row";
import type { PeekDocumentInput } from "./peek-document";

/** What one build is FOR: a season, a rule set and its hash, and which players. */
export interface PeekDocumentRequest {
  readonly season: number;
  readonly scoringHash: string;
  readonly rules: ScoringRules;
  /** `null` means every player the product carries, which is what a whole-hash build asks for. */
  readonly playerIds: readonly string[] | null;
  readonly asOf: Date;
}

/** Whether this position's history lives in the kicker and team-defense archive rather than in the
 *  player observation store. One question, one spelling. */
function readsKdefArchive(position: Position): boolean {
  return position === "K" || position === "DEF";
}

/** Which stores fed a document's season numbers. A gap season names the derived pair rather than
 *  the published weekly feed, so a reader can see which definition of a carry produced them. */
function sourceKeysFor(priorSeason: number): readonly string[] {
  return [BOARD_SOURCE, PEEK_FACTS_SOURCE, admitsDerivedForLiveSurface(priorSeason) ? DERIVED_STAT_LINE_SOURCE : STAT_LINE_SOURCE];
}

/** One read of the whole product player universe. It is the peer population for BOTH ranks the card
 *  shows, so reading it once and folding both out of it is what the request path used to do and what
 *  a build does now for every player at once. */
interface PlayerUniverse {
  readonly rows: readonly Player[];
  readonly byPosition: ReadonlyMap<Position, readonly Player[]>;
  readonly rankedAdp: readonly number[];
}

async function playerUniverse(db: Db): Promise<PlayerUniverse> {
  const rows = await db.select().from(players);
  const universe: readonly Player[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    position: row.position,
    nflTeam: row.nflTeam,
    headshotUrl: row.headshotUrl,
    adp: row.adp,
  }));
  const byPosition = new Map<Position, Player[]>();
  for (const player of universe) {
    const bucket = byPosition.get(player.position);
    if (bucket === undefined) byPosition.set(player.position, [player]);
    else bucket.push(player);
  }
  return { rows: universe, byPosition, rankedAdp: universe.flatMap((player) => (player.adp === null ? [] : [player.adp])) };
}

/** Every current-season stat line for every player in the universe, in ONE read, grouped by the
 *  position of the man who produced it. That grouping IS the peer population `weekViews` and
 *  `peerPointsPerGame` each take, so the two never see a different set. */
async function currentSeasonLines(db: Db, universe: PlayerUniverse, played: readonly number[]): Promise<ReadonlyMap<Position, readonly StatLine[]>> {
  const byPosition = new Map<Position, StatLine[]>();
  if (played.length === 0) return byPosition;
  const positionOf = new Map(universe.rows.map((player) => [player.id, player.position] as const));
  const lines = await db.select().from(playerStatLines).where(inArray(playerStatLines.week, [...played]));
  for (const line of lines) {
    const position = positionOf.get(line.playerId);
    if (position === undefined) continue;
    const bucket = byPosition.get(position);
    if (bucket === undefined) byPosition.set(position, [line]);
    else bucket.push(line);
  }
  return byPosition;
}

/** A prior season's lines for one position, from the point-in-time store, keyed by nflverse id —
 *  the same reader the peek's own prior-season path has always used, so a season this holds a line
 *  for is a season the chart can actually draw. */
async function priorSeasonLines(db: Db, position: Position, season: number, asOf: Date): Promise<readonly StatLine[]> {
  const positionPeers = await db.select({ id: nflPlayers.id }).from(nflPlayers).where(eq(nflPlayers.position, position));
  if (positionPeers.length === 0) return [];
  const rows = await statLinesAsOfForLiveSurface(db, {
    season,
    week: { from: 1, to: finalWeekOf(season) },
    asOf,
    playerIds: positionPeers.map((peer) => peer.id),
  });
  return rows.map((row) => row.line);
}

/** Every prior season's lines for every position in play, keyed `<position>:<season>`. One read
 *  pair per (position, season), never one per player. */
async function priorSeasonLinesByKey(db: Db, positions: readonly Position[], seasons: readonly number[], asOf: Date): Promise<ReadonlyMap<string, readonly StatLine[]>> {
  const byKey = new Map<string, readonly StatLine[]>();
  for (const position of positions) {
    for (const season of seasons) {
      byKey.set(`${position}:${season}`, await priorSeasonLines(db, position, season, asOf));
    }
  }
  return byKey;
}

/** Every kicker's and team defense's archived season, keyed `<playerId>:<season>`. One call per
 *  candidate season over the whole list, which is what `kdefSeasonLines` already takes. */
async function kdefLinesByKey(db: Db, playerIds: readonly string[], seasons: readonly number[], rules: ScoringRules): Promise<ReadonlyMap<string, KdefSeasonLine>> {
  const byKey = new Map<string, KdefSeasonLine>();
  if (playerIds.length === 0) return byKey;
  for (const season of seasons) {
    for (const [playerId, line] of await kdefSeasonLines(db, { season, playerIds, rules })) {
      byKey.set(`${playerId}:${season}`, line);
    }
  }
  return byKey;
}

/** Everything one build read, held together so the per-player assembly below is pure arithmetic
 *  over it rather than a second wave of queries. */
interface BuildReads {
  readonly universe: PlayerUniverse;
  readonly subjects: readonly Player[];
  readonly played: readonly number[];
  readonly gsisIdByPlayerId: ReadonlyMap<string, string>;
  readonly peekFacts: Awaited<ReturnType<typeof readPeekFactsFor>>;
  readonly capsules: Awaited<ReturnType<typeof getStoredCapsulesFor>>;
  readonly injuries: Awaited<ReturnType<typeof injurySnapshot>>;
  readonly news: Awaited<ReturnType<typeof newsSnapshotForPlayers>>;
  readonly reasons: ReadonlyMap<string, readonly BoardReason[]>;
  readonly expertRankByGsisId: ReadonlyMap<string, number>;
  readonly modelRankByGsisId: ReadonlyMap<string, number>;
  readonly rookieSeasonByGsisId: ReadonlyMap<string, number | null>;
  readonly currentLines: ReadonlyMap<Position, readonly StatLine[]>;
  readonly priorLines: ReadonlyMap<string, readonly StatLine[]>;
  readonly kdefLines: ReadonlyMap<string, KdefSeasonLine>;
  readonly priorCandidates: readonly number[];
}

async function readEverything(db: Db, request: PeekDocumentRequest): Promise<BuildReads> {
  const universe = await playerUniverse(db);
  const wanted = request.playerIds === null ? null : new Set(request.playerIds);
  const subjects = wanted === null ? universe.rows : universe.rows.filter((player) => wanted.has(player.id));
  const subjectIds = subjects.map((player) => player.id);
  const gsisIdByPlayerId = await nflPlayerIdsFor(db, subjectIds);
  const gsisIds = [...new Set([...gsisIdByPlayerId.values()])];
  const priorCandidates = priorSeasonCandidates(request.season);

  // THE LOUD READ, once per build rather than once per player: it refuses a board stitched together
  // from more than one live generation, the same way the writer's own retire discipline promises
  // there never is one.
  await assertSingleGeneration(db, { season: PRODUCT_SEASON, source: BOARD_SOURCE, asOf: request.asOf });

  const [weekRows, peekFacts, capsules, injuries, news, reasons, consensus, board, rookies] = await Promise.all([
    db.select({ week: statWeeks.week }).from(statWeeks).where(ne(statWeeks.status, "scheduled")),
    readPeekFactsFor(db, subjectIds, request.season, request.asOf),
    getStoredCapsulesFor(db, subjectIds),
    injurySnapshot(db),
    newsSnapshotForPlayers(db, subjects.map((player) => player.name)),
    boardReasons(db, BOARD_SOURCE, PRODUCT_SEASON),
    preseasonRankingsFor(db, { season: PRODUCT_SEASON, source: BENCHMARK_SOURCES.ecr, asOf: request.asOf }, gsisIds),
    preseasonProjectionsFor(db, { season: PRODUCT_SEASON, source: BOARD_SOURCE, asOf: request.asOf }, gsisIds),
    gsisIds.length === 0 ? [] : db.select({ id: nflPlayers.id, rookieSeason: nflPlayers.rookieSeason }).from(nflPlayers).where(inArray(nflPlayers.id, gsisIds)),
  ]);

  const played = weekRows.map((row) => row.week).sort((a, b) => a - b);
  const positions = [...new Set(subjects.map((player) => player.position))];
  const [currentLines, priorLines, kdefLines] = await Promise.all([
    currentSeasonLines(db, universe, played),
    priorSeasonLinesByKey(db, positions.filter((position) => !readsKdefArchive(position)), priorCandidates, request.asOf),
    kdefLinesByKey(db, subjects.filter((player) => readsKdefArchive(player.position)).map((player) => player.id), priorCandidates, request.rules),
  ]);

  return {
    universe,
    subjects,
    played,
    gsisIdByPlayerId,
    peekFacts,
    capsules,
    injuries,
    news,
    reasons,
    expertRankByGsisId: new Map(consensus.map((row) => [row.playerId, row.rank] as const)),
    modelRankByGsisId: new Map(board.map((row) => [row.playerId, row.rank] as const)),
    rookieSeasonByGsisId: new Map(rookies.map((row) => [row.id, row.rookieSeason] as const)),
    currentLines,
    priorLines,
    kdefLines,
    priorCandidates,
  };
}

/** Which seasons this player actually has numbers for, newest first: the current one once the
 *  league has played a week and he has a line in it, then each prior season the right store holds a
 *  week of. A season with nothing behind it never enters the list, which is what keeps
 *  `availableSeasons` a statement about data rather than about hope. */
function seasonsFor(reads: BuildReads, player: Player, gsisId: string | null, rules: ScoringRules): readonly { readonly season: number; readonly stats: PlayerSeasonStats }[] {
  const seasons: { readonly season: number; readonly stats: PlayerSeasonStats }[] = [];
  const isKdef = readsKdefArchive(player.position);

  if (reads.played.length > 0) {
    const lines = reads.currentLines.get(player.position) ?? [];
    seasons.push({
      season: PRODUCT_SEASON,
      stats: seasonStatsFromLines({ lines, played: reads.played, playerId: player.id, position: player.position, rules, touchesKnown: true }),
    });
  }

  for (const season of reads.priorCandidates) {
    if (isKdef) {
      const line = reads.kdefLines.get(`${player.id}:${season}`);
      if (line !== undefined) seasons.push({ season, stats: kdefSeasonStatsFrom(line, finalWeekOf(season)) });
      continue;
    }
    if (gsisId === null) continue;
    const lines = reads.priorLines.get(`${player.position}:${season}`) ?? [];
    if (!lines.some((line) => line.playerId === gsisId)) continue;
    const lastWeek = finalWeekOf(season);
    seasons.push({
      season,
      stats: seasonStatsFromLines({
        lines,
        played: Array.from({ length: lastWeek }, (_, index) => index + 1),
        playerId: gsisId,
        position: player.position,
        rules,
        touchesKnown: false,
      }),
    });
  }
  return seasons;
}

/**
 * EVERY DOCUMENT INPUT FOR ONE BUILD. The reads happen once for the whole list; everything after
 * them is arithmetic.
 */
export async function collectPeekDocumentInputs(db: Db, request: PeekDocumentRequest): Promise<readonly PeekDocumentInput[]> {
  const reads = await readEverything(db, request);
  const priorSeason = request.season - 1;
  const lastFinalizedWeek = reads.played.length === 0 ? null : Math.max(...reads.played);

  return reads.subjects.map((player): PeekDocumentInput => {
    const gsisId = reads.gsisIdByPlayerId.get(player.id) ?? null;
    const facts = reads.peekFacts.get(player.id) ?? null;
    const capsule = reads.capsules.get(player.id);
    const seasons = seasonsFor(reads, player, gsisId, request.rules);
    const peers = reads.universe.byPosition.get(player.position) ?? [];
    const adp = player.adp;
    const basis: PeekDocumentBasis = {
      scoringHash: request.scoringHash,
      factsAsOf: facts?.asOf.toISOString() ?? null,
      capsuleGeneratedAt: capsule?.generatedAt.toISOString() ?? null,
      capsuleFactsHash: capsule?.factsHash ?? null,
      injuryCapturedAt: reads.injuries.capturedAt?.toISOString() ?? null,
      newsCapturedAt: reads.news.capturedAt?.toISOString() ?? null,
      lastFinalizedWeek,
      sourceKeys: sourceKeysFor(priorSeason),
    };
    return {
      player,
      // A CONFIRMED rookie fact, never inferred from an empty season list: a real veteran the
      // crosswalk has not placed also has nothing to chart, and answering him with "his first NFL
      // season" would be a biography claim nothing here can back up.
      isRookie: seasons.length === 0 && gsisId !== null && reads.rookieSeasonByGsisId.get(gsisId) === PRODUCT_SEASON,
      positionRank: adp === null ? null : 1 + peers.filter((peer) => peer.adp !== null && peer.adp < adp).length,
      adpPercentile: adp === null ? null : percentileOf(adp, reads.universe.rankedAdp, "lower"),
      expertRank: gsisId === null ? null : (reads.expertRankByGsisId.get(gsisId) ?? null),
      modelRank: gsisId === null ? null : (reads.modelRankByGsisId.get(gsisId) ?? null),
      injuryDesignation: reads.injuries.designations.get(player.id) ?? null,
      news: reads.news.byName.get(player.name) ?? [],
      reasons: gsisId === null ? [] : (reads.reasons.get(gsisId) ?? []),
      capsule:
        capsule === undefined
          ? null
          : { bodyCompact: capsule.bodyCompact, bodyFull: capsule.bodyFull, source: capsule.source, narrative: capsule.narrative ?? null },
      dossier: facts?.dossier ?? null,
      seasons,
      asOf: request.asOf,
      basis,
    };
  });
}
