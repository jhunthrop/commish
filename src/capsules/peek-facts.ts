import { and, desc, eq, inArray, lte } from "drizzle-orm";
import type { Db, ReadonlyDb } from "@/db/client";
import { playerPeekFacts } from "@/db/schema";
import { changedRowWhere, excludedSetFor } from "@/db/upsert";
import { boardWidePerGameFacts, dossierFactsFrom, type PlayerDossierFacts, type PlayerDossierRank } from "@/league-service/dossier-facts";
import { STAT_LINE_SOURCE } from "@/projections/lines";
import { admitsDerivedForLiveSurface, DERIVED_STAT_LINE_SOURCE, statLinesAsOfForLiveSurface } from "@/projections/nflverse/derived-stat-lines";
import { NFLVERSE_SOURCE } from "@/projections/nflverse/map";
import { PBP_PLAYER_SOURCE } from "@/projections/nflverse/pbp-players";
import { finalWeekOf } from "@/projections/nflverse/team-eras";
import { BOARD_SOURCE } from "@/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { enqueuePeekDocumentRebuildsQuietly } from "@/jobs/defs/peek-document-job";
import { collectBoardFacts, type BoardFactsPass } from "./collect";
import type { PlayerFacts } from "./facts";
import { PEEK_FACTS_SOURCE, PEEK_HISTORY_SEASONS, type PeekFactsBasis, type PeekFactsRow, type PeekLastSeasonLine } from "./peek-facts-row";

/**
 * THE PRECOMPUTE WRITER AND READER for `player_peek_facts` (peek-facts design, 2026-09-07).
 *
 * IT IS NOT A SECOND JOB. `collectBoardFacts` (`collect.ts`) already computes every color fact for
 * the whole board once a night inside the capsule sweep; this module turns that same pass into
 * stored rows. The only reads it adds are the ones the pass genuinely does not produce: the
 * whole-board per-game rank (one read, shared across every player) and which prior seasons the
 * store holds a week of (one read per candidate season, batched over every board player at once).
 *
 * TWO TRIGGERS, both already scheduled: the nightly capsule sweep, and the `season-week` job after
 * weekly stats finalize. Both write the CURRENT product season's rows and nothing else, because
 * `PRODUCT_SEASON` is the only season a peek asks about.
 */

/**
 * The columns the upsert neither writes nor compares: the natural key itself, plus `computedAt`.
 *
 * `computedAt` is in the list for the reason `team-defense-weeks.ts` puts `ingestedAt` in its own:
 * it defaults to `now()`, so leaving it in the comparison would make every re-run "changed" and the
 * changed-row count would report the clock rather than the data. A row whose content did not move
 * keeps the instant its content WAS computed, which is the honest reading of the column.
 */
const NATURAL_KEYS: readonly string[] = ["playerId", "season", "asOf", "computedAt"];

/** The seasons a peek can offer, newest first — `PEEK_HISTORY_SEASONS` back from the product one. */
export function priorSeasonCandidates(season: number = PRODUCT_SEASON): readonly number[] {
  return Array.from({ length: PEEK_HISTORY_SEASONS }, (_, back) => season - (back + 1));
}

/**
 * Which of the candidate prior seasons the point-in-time store holds at least one week of, per
 * NFLVERSE player id, newest first.
 *
 * ONE READ PER CANDIDATE SEASON over EVERY board player at once, which is what makes this worth
 * precomputing at all: the peek used to ask the identical question three times per open, one narrow
 * round trip each, and three round trips per click is three more than none.
 *
 * `statLinesAsOfForLiveSurface` is the same reader the peek's own prior-season path uses, so a
 * season this says is held is a season that path can actually draw.
 */
export async function priorSeasonsHeldFor(db: ReadonlyDb, gsisIds: readonly string[], asOf: Date): Promise<ReadonlyMap<string, readonly number[]>> {
  const held = new Map<string, number[]>();
  if (gsisIds.length === 0) return held;
  for (const season of priorSeasonCandidates()) {
    const rows = await statLinesAsOfForLiveSurface(db, { season, week: { from: 1, to: finalWeekOf(season) }, asOf, playerIds: gsisIds });
    for (const { line } of rows) {
      const seasons = held.get(line.playerId);
      if (seasons === undefined) held.set(line.playerId, [season]);
      else if (!seasons.includes(season)) seasons.push(season);
    }
  }
  return new Map([...held].map(([playerId, seasons]) => [playerId, [...seasons].sort((a, b) => b - a)] as const));
}

/** Which observation sources actually fed a row's prior-season numbers. A gap season names the
 *  play-by-play pair rather than the published weekly feed, so a reader can see which definition of
 *  a carry produced the touches figure. */
function sourceKeysFor(priorSeason: number): readonly string[] {
  return [
    BOARD_SOURCE,
    admitsDerivedForLiveSurface(priorSeason) ? DERIVED_STAT_LINE_SOURCE : STAT_LINE_SOURCE,
    PBP_PLAYER_SOURCE,
    NFLVERSE_SOURCE.snapCounts,
  ];
}

/** The touches rank, or the writer's refusal to store one, with the reason it refused. */
interface TouchesReading {
  readonly rank: number | null;
  readonly qualifierCount: number | null;
  readonly refusal: string | null;
}

/**
 * THE REFUSAL (design §3.4). The writer does not store a touches rank computed against an empty
 * line set: a rank whose population is empty is a number with nothing behind it, and a peek that
 * printed it would be making a claim this store cannot back. Absence, with the reason stated on the
 * row, is the honest answer instead.
 *
 * Three ways the answer is absent, and they are different facts, so they are different sentences:
 * the prior-season read produced no players at all, this player has no touches evidence of his own,
 * or the rank came back with no qualifying peers to have been taken over.
 */
function touchesReadingFor(facts: PlayerFacts, priorSeason: number, priorSeasonPlayerCount: number): TouchesReading {
  if (priorSeasonPlayerCount === 0) {
    return { rank: null, qualifierCount: null, refusal: `No ${priorSeason} stat line was read for any player, so no touches rank was computed.` };
  }
  const ranked = facts.lastSeasonStory?.touchesRank ?? null;
  if (ranked === null) {
    return { rank: null, qualifierCount: null, refusal: `The participation feed placed no ${priorSeason} touches for him.` };
  }
  if (ranked.qualifierCount < 1) {
    return { rank: null, qualifierCount: null, refusal: `No peer at his position had a real ${priorSeason} touches reading to rank him against.` };
  }
  return { rank: ranked.positionRank, qualifierCount: ranked.qualifierCount, refusal: null };
}

/** The stored dossier with its touches rank stripped, for a player the writer refused one for — so
 *  the blob and the promoted scalars state the same thing rather than two different ones. */
function withoutTouchesRank(dossier: PlayerDossierFacts): PlayerDossierFacts {
  if (dossier.lastSeasonStory === null || dossier.lastSeasonStory.touchesRank === null) return dossier;
  return { ...dossier, lastSeasonStory: { ...dossier.lastSeasonStory, touchesRank: null } };
}

/** Last season league-agnostically, off the story the pass already built — points, games and the
 *  average, under this product's standard PPR format. `null` for a player with no story. */
function lastSeasonLineFor(facts: PlayerFacts): PeekLastSeasonLine | null {
  const story = facts.lastSeasonStory;
  if (story === null) return null;
  return { season: story.season, points: story.pointsRank.value, games: story.gamesPlayed, pointsPerGame: story.pointsPerGame };
}

interface RowInput {
  readonly facts: PlayerFacts;
  readonly perGameRank: PlayerDossierRank | null;
  readonly priorSeasonsHeld: readonly number[];
  readonly peerPopulation: number;
  readonly priorSeason: number;
  readonly priorSeasonPlayerCount: number;
  readonly asOf: Date;
}

/** One row, assembled from the pass. Pure: every read it needs has already happened. */
export function peekFactsRowFor(input: RowInput): PeekFactsRow {
  const touches = touchesReadingFor(input.facts, input.priorSeason, input.priorSeasonPlayerCount);
  const dossier = dossierFactsFrom(input.facts, input.perGameRank);
  const basis: PeekFactsBasis = {
    priorSeason: input.priorSeason,
    sourceKeys: sourceKeysFor(input.priorSeason),
    peerPopulation: input.peerPopulation,
    priorSeasonPlayerCount: input.priorSeasonPlayerCount,
    refusals: touches.refusal === null ? [] : [touches.refusal],
    scoringLabel: dossier.basis.scoringLabel,
  };
  return {
    playerId: input.facts.identity.id,
    season: PRODUCT_SEASON,
    dossier: touches.refusal === null ? dossier : withoutTouchesRank(dossier),
    touchesRank: touches.rank,
    touchesQualifierCount: touches.qualifierCount,
    priorSeasonsHeld: input.priorSeasonsHeld,
    lastSeasonLine: lastSeasonLineFor(input.facts),
    basis,
    asOf: input.asOf,
  };
}

/** Every board player's row, built from one already-completed pass plus the two reads that pass
 *  does not produce. */
export async function peekFactsRowsFor(db: Db, pass: BoardFactsPass): Promise<readonly PeekFactsRow[]> {
  if (pass.facts.length === 0) return [];
  const gsisIds = [...new Set(pass.facts.flatMap((facts) => {
    const gsisId = pass.gsisIdByPlayerId.get(facts.identity.id);
    return gsisId === undefined ? [] : [gsisId];
  }))];
  const [perGameRanks, seasonsHeld] = await Promise.all([
    boardWidePerGameFacts(db, pass.asOf),
    priorSeasonsHeldFor(db, gsisIds, pass.asOf),
  ]);

  return pass.facts.map((facts) => {
    const gsisId = pass.gsisIdByPlayerId.get(facts.identity.id);
    return peekFactsRowFor({
      facts,
      perGameRank: gsisId === undefined ? null : (perGameRanks.get(gsisId) ?? null),
      priorSeasonsHeld: gsisId === undefined ? [] : (seasonsHeld.get(gsisId) ?? []),
      peerPopulation: pass.peerCountByPosition.get(facts.identity.position) ?? 0,
      priorSeason: pass.priorSeason,
      priorSeasonPlayerCount: pass.priorSeasonPlayerCount,
      asOf: pass.asOf,
    });
  });
}

/**
 * Upserts on the natural key and returns WHICH players' rows actually changed — `changedRowWhere`'s
 * own row-value `IS DISTINCT FROM` over every non-key column, the same discipline every ingester
 * here keeps. Re-running the writer at the same moment over unchanged inputs writes nothing at all
 * rather than being labelled a no-op after the fact.
 *
 * The ids rather than a count (peek document round, 2026-09-07): they are exactly the scope of the
 * document rebuild this write triggers, and a count would force the caller to rebuild everybody to
 * be safe.
 */
export async function writePeekFacts(db: Db, rows: readonly PeekFactsRow[]): Promise<readonly string[]> {
  if (rows.length === 0) return [];
  const values = rows.map((row) => ({
    playerId: row.playerId,
    season: row.season,
    dossier: row.dossier,
    touchesRank: row.touchesRank,
    touchesQualifierCount: row.touchesQualifierCount,
    priorSeasonsHeld: [...row.priorSeasonsHeld],
    lastSeasonLine: row.lastSeasonLine,
    basis: row.basis,
    asOf: row.asOf,
    source: PEEK_FACTS_SOURCE,
  }));
  const written = await db
    .insert(playerPeekFacts)
    .values(values)
    .onConflictDoUpdate({
      target: [playerPeekFacts.playerId, playerPeekFacts.season, playerPeekFacts.asOf],
      set: excludedSetFor(playerPeekFacts, NATURAL_KEYS),
      where: changedRowWhere(playerPeekFacts, NATURAL_KEYS),
    })
    .returning({ playerId: playerPeekFacts.playerId });
  return written.map((row) => row.playerId);
}

/** What one refresh did, for a job step's own summary line. */
export interface PeekFactsRefresh {
  readonly players: number;
  readonly changed: number;
  readonly withTouchesRank: number;
}

/** The whole precompute, for a caller that has no pass of its own to hand over (the `season-week`
 *  job's post-finalize step). A caller that DOES have one — the capsule sweep, which already ran
 *  it — calls `peekFactsRowsFor` and `writePeekFacts` directly rather than paying twice. */
export async function refreshPeekFacts(db: Db, asOf: Date): Promise<PeekFactsRefresh> {
  return await writeRefresh(db, await collectBoardFacts(db, asOf));
}

/** Rows out of a pass and into the table, counted. Shared by both triggers. */
export async function writeRefresh(db: Db, pass: BoardFactsPass): Promise<PeekFactsRefresh> {
  const rows = await peekFactsRowsFor(db, pass);
  const changed = await writePeekFacts(db, rows);
  // THE EVENT (peek document design §3.4, row three): a written facts row is a changed document
  // input, for every scoring hash in use. Only the players whose rows actually MOVED are named, and
  // a refresh that changed nothing enqueues nothing at all. The reason stamp is the pass instant, so
  // two writers reaching the same pass (the nightly sweep and a retried tick) coalesce into one build.
  if (changed.length > 0) {
    await enqueuePeekDocumentRebuildsQuietly(db, { now: () => pass.asOf.toISOString() }, {
      playerIds: changed,
      reason: `facts:${pass.asOf.toISOString()}`,
    });
  }
  return { players: rows.length, changed: changed.length, withTouchesRank: rows.filter((row) => row.touchesRank !== null).length };
}

/**
 * THE BATCHED READ — the latest row per player at or before `asOf`, for a whole build's worth of
 * players in ONE statement (peek document design §3.3). `DISTINCT ON (player_id)` with the same
 * `as_of <=` gate and the same descending order the single-player read uses, so the two can never
 * disagree about which generation is current. A player with no row is honestly absent from the map.
 */
export async function readPeekFactsFor(db: ReadonlyDb, playerIds: readonly string[], season: number, asOf: Date): Promise<ReadonlyMap<string, PeekFactsRow>> {
  if (playerIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([playerPeekFacts.playerId])
    .from(playerPeekFacts)
    .where(and(inArray(playerPeekFacts.playerId, [...playerIds]), eq(playerPeekFacts.season, season), lte(playerPeekFacts.asOf, asOf)))
    .orderBy(playerPeekFacts.playerId, desc(playerPeekFacts.asOf));
  return new Map(rows.map((row) => [row.playerId, toPeekFactsRow(row)] as const));
}

/** One stored row as the shape every reader here passes around. */
function toPeekFactsRow(row: typeof playerPeekFacts.$inferSelect): PeekFactsRow {
  return {
    playerId: row.playerId,
    season: row.season,
    dossier: row.dossier,
    touchesRank: row.touchesRank,
    touchesQualifierCount: row.touchesQualifierCount,
    priorSeasonsHeld: row.priorSeasonsHeld,
    lastSeasonLine: row.lastSeasonLine,
    basis: row.basis,
    asOf: row.asOf,
  };
}

/**
 * THE PEEK'S OWN READ — the latest row for this player and season stamped at or before `asOf`, the
 * same `as_of <=` gate every reader in this engine uses. `null` when no row has been written for
 * him yet, which the peek renders as absence rather than as a stale or guessed dossier.
 */
export async function readPeekFacts(db: ReadonlyDb, playerId: string, season: number, asOf: Date): Promise<PeekFactsRow | null> {
  const [row] = await db
    .select()
    .from(playerPeekFacts)
    .where(and(eq(playerPeekFacts.playerId, playerId), eq(playerPeekFacts.season, season), lte(playerPeekFacts.asOf, asOf)))
    .orderBy(desc(playerPeekFacts.asOf))
    .limit(1);
  return row === undefined ? null : toPeekFactsRow(row);
}
