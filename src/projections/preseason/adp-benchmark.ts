import type { Db, ReadonlyDb } from "@/db/client";
import { nflPlayers } from "@/db/schema";
import { resolveRankings, type RosterIdentity } from "./benchmarks";
import { BOARD_FORMAT_SPECS, type BoardFormat } from "./board-formats";
import { fetchAverageDraftPosition } from "./publishers";
import { preseasonRostersAsOf, recordPreseasonRankings } from "./store";

/**
 * ONE FORMAT'S PUBLISHED ADP BOARD, RESOLVED AND STORED (the scoring-formats round, 2026-09-08).
 *
 * Extracted from `scripts/preseason-ingest.ts`'s script-local benchmark loop so the three formats'
 * boards are ingested by ONE function whichever script asks for them: the full preseason ingest,
 * the ADP-only backfill (`scripts/adp-benchmark-ingest.ts`) and the daily snapshot
 * (`market/adp-snapshot.ts`) all resolve a published board against the season's own week-one
 * roster the same way, because `rosterIdentitiesFor` and `resolveRankings` are the same code.
 */

/** Far past any correction: a benchmark is SCORED AGAINST, never fed in, exactly like actuals. */
const FINAL = new Date("9999-12-31T00:00:00.000Z");

/** The season's own week-one roster, with names joined on, as the benchmark resolver needs it. */
export async function rosterIdentitiesFor(db: ReadonlyDb, season: number): Promise<readonly RosterIdentity[]> {
  const roster = await preseasonRostersAsOf(db, { season, asOf: FINAL });
  const names = new Map((await db.select({ id: nflPlayers.id, name: nflPlayers.name }).from(nflPlayers)).map((row) => [row.id, row.name]));
  return roster
    .map((row) => ({ playerId: row.playerId, name: names.get(row.playerId) ?? "", position: row.position, team: row.team }))
    .filter((identity) => identity.name !== "");
}

export interface AdpBenchmarkReport {
  readonly format: BoardFormat;
  /** `preseason_rankings.source` the rows landed under. */
  readonly source: string;
  readonly published: number;
  readonly resolved: number;
  /** Matched over published; `null` for an empty board, never a fabricated 1 or 0. */
  readonly resolutionRate: number | null;
  /** Rows that were genuinely new (the store is append-only on `(season, source, player, as_of)`). */
  readonly written: number;
  readonly publisherStamp: string;
  readonly publishedAt: Date;
  /** The first few names the resolver could not place, for the operator's eye. */
  readonly unresolvedSample: readonly string[];
}

const UNRESOLVED_SAMPLE_SIZE = 5;

/**
 * Fetches one format's board for one season, resolves it against `identities` and appends whatever
 * resolved to `preseason_rankings` under the format's own source. Throws exactly what
 * `fetchAverageDraftPosition` throws (an HTTP failure, an unpublished board), because whether an
 * unpublished half-PPR 2016 is an error or an expected gap is the caller's ruling, not this one's.
 */
export async function ingestAdpBenchmark(
  db: Db,
  season: number,
  format: BoardFormat,
  identities: readonly RosterIdentity[],
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<AdpBenchmarkReport> {
  const spec = BOARD_FORMAT_SPECS[format];
  const board = await fetchAverageDraftPosition(season, fetchImpl, spec.feedFormat);
  const resolution = resolveRankings(board.candidates, identities);
  const written = await recordPreseasonRankings(
    db,
    resolution.resolved.map((row) => ({ season, source: spec.adpSource, playerId: row.playerId, rank: row.rank, asOf: board.publishedAt })),
  );
  return {
    format,
    source: spec.adpSource,
    published: board.candidates.length,
    resolved: resolution.resolved.length,
    resolutionRate: resolution.resolutionRate,
    written,
    publisherStamp: board.publisherStamp,
    publishedAt: board.publishedAt,
    unresolvedSample: resolution.unresolved
      .slice(0, UNRESOLVED_SAMPLE_SIZE)
      .map((missed) => `${missed.name} (${missed.position}, ${missed.team ?? "no team"}) at ${missed.rank}`),
  };
}
