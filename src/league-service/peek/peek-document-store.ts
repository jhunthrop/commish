// THE WRITER FOR `player_peek_documents` (peek document design §3.3, 2026-09-07).
//
// IT IS NOT A SECOND ASSEMBLY. `collectPeekDocumentInputs` reads what the product already reads and
// `buildPeekDocument` assembles what the screen already draws; this module is the thin layer that
// puts the result in a table and counts what actually moved. The peek's own request-time miss path
// calls the exact same two functions for one player, so there is one builder in this codebase and
// no chance of a stored document and a freshly built one disagreeing.
import { sql } from "drizzle-orm";
import type { Db } from "@research-ts/db/client";
import { playerPeekDocuments } from "@/db/schema";
import { changedRowWhere, excludedSetFor } from "@research-ts/db/upsert";
import { buildPeekDocument } from "./peek-document";
import { collectPeekDocumentInputs, type PeekDocumentRequest } from "./peek-document-inputs";
import { PEEK_DOCUMENT_SOURCE, type PeekDocumentRow } from "./peek-document-row";

/**
 * The columns the upsert neither writes nor compares: the natural key itself, plus `computedAt`.
 *
 * `computedAt` is in the list for the reason `peek-facts.ts` and `team-defense-weeks.ts` each put
 * their own stamp in theirs: it defaults to `now()`, so leaving it in the comparison would make
 * every re-run "changed" and the changed-row count would be reporting the clock rather than the
 * data. A row whose content did not move keeps the instant its content WAS computed.
 */
const NATURAL_KEYS: readonly string[] = ["playerId", "season", "scoringHash", "asOf", "computedAt"];

/** What one build did, for a job step's own summary line. */
export interface PeekDocumentWrite {
  readonly players: number;
  readonly changed: number;
  /** How many generations past the retention window this build dropped. */
  readonly pruned: number;
}

/** Every document one request asks for, built from one batch of reads. Exported so the request
 *  path's miss can build a single player's document through the very same code. */
export async function peekDocumentRowsFor(db: Db, request: PeekDocumentRequest): Promise<readonly PeekDocumentRow[]> {
  const inputs = await collectPeekDocumentInputs(db, request);
  return inputs.map((input) => ({
    playerId: input.player.id,
    season: request.season,
    scoringHash: request.scoringHash,
    document: buildPeekDocument(input),
    basis: input.basis,
    asOf: request.asOf,
  }));
}

/**
 * Upserts on the natural key and returns how many rows ACTUALLY changed — `changedRowWhere`'s own
 * row-value `IS DISTINCT FROM` over every non-key column, the same discipline every ingester here
 * keeps. Re-running a build at the same moment over unchanged inputs writes nothing at all rather
 * than being labelled a no-op after the fact, which is what makes an event-driven rebuild cheap
 * enough to fire on every input that moves.
 */
export async function writePeekDocumentRows(db: Db, rows: readonly PeekDocumentRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  let changed = 0;
  for (const batch of batches(rows, WRITE_BATCH)) {
    const written = await db
      .insert(playerPeekDocuments)
      .values(
        batch.map((row) => ({
          playerId: row.playerId,
          season: row.season,
          scoringHash: row.scoringHash,
          document: row.document,
          basis: row.basis,
          asOf: row.asOf,
          source: PEEK_DOCUMENT_SOURCE,
        })),
      )
      .onConflictDoUpdate({
        target: [playerPeekDocuments.season, playerPeekDocuments.scoringHash, playerPeekDocuments.playerId, playerPeekDocuments.asOf],
        set: excludedSetFor(playerPeekDocuments, NATURAL_KEYS),
        where: changedRowWhere(playerPeekDocuments, NATURAL_KEYS),
      })
      .returning({ playerId: playerPeekDocuments.playerId });
    changed += written.length;
  }
  return changed;
}

/** A document is kilobytes of JSON, so a whole-hash build is megabytes in one statement if it is
 *  not split. Two hundred rows a statement keeps each insert comfortably inside the driver's own
 *  parameter and payload limits without turning the write into one round trip per player. */
const WRITE_BATCH = 200;

function batches<T>(rows: readonly T[], size: number): readonly (readonly T[])[] {
  const out: T[][] = [];
  for (let index = 0; index < rows.length; index += size) out.push(rows.slice(index, index + size));
  return out;
}

/**
 * HOW MANY GENERATIONS OF A DOCUMENT SURVIVE (design §3.1's pruning rule).
 *
 * THREE, and the number is not arbitrary. One is the generation being served. The second is what a
 * reader standing slightly in the past is entitled to, which is the whole point of an `as_of <=`
 * store and is what a replay or an operator investigating "what did the card say an hour ago" reads.
 * The third is headroom for an event that fires while a build is in flight.
 *
 * WHY THERE HAS TO BE A NUMBER AT ALL. Every event stamps a new generation, and the harvest alone
 * fires eighteen times a day (`HARVEST_CONFIG`). At a few kilobytes a document across every player
 * and every scoring hash in use, an unpruned store would be gigabytes within a week, all of it rows
 * nothing will ever read again.
 */
const KEEP_GENERATIONS = 3;

/**
 * Drops every generation past the newest `KEEP_GENERATIONS` for each (season, hash, player), and
 * returns how many rows went. Ranked per player rather than per build, because a targeted rebuild
 * writes a new generation for a handful of players and leaves everyone else on an older one.
 *
 * IT CANNOT DELETE WHAT A READER IS SERVING: the peek always reads the newest generation at or
 * before its own moment, which is rank one, and nothing below rank three is reachable by any reader
 * that is not looking three generations into the past.
 */
export async function prunePeekDocuments(db: Db, season: number, scoringHash: string): Promise<number> {
  const deleted = await db.execute<{ readonly player_id: string }>(sql`
    delete from ${playerPeekDocuments} target
    using (
      select ctid, row_number() over (partition by season, scoring_hash, player_id order by as_of desc) as generation
      from ${playerPeekDocuments}
      where season = ${season} and scoring_hash = ${scoringHash}
    ) ranked
    where target.ctid = ranked.ctid and ranked.generation > ${KEEP_GENERATIONS}
    returning target.player_id
  `);
  return deleted.length;
}

/** The whole build: read once, assemble, write, count, then drop the generations nothing can read. */
export async function writePeekDocuments(db: Db, request: PeekDocumentRequest): Promise<PeekDocumentWrite> {
  const rows = await peekDocumentRowsFor(db, request);
  const changed = await writePeekDocumentRows(db, rows);
  const pruned = await prunePeekDocuments(db, request.season, request.scoringHash);
  return { players: rows.length, changed, pruned };
}
