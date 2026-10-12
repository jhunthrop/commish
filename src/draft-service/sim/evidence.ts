/**
 * THE SIM'S EVIDENCE POOL, READ FROM REAL STORES — the one bridge between `simulateDrafts`'s pure
 * arithmetic (`simulate.ts`) and the two real facts it needs: the evidence board's own projected
 * points (`preseasonProjectionsAsOf`, `BOARD_SOURCE` — the identical read
 * `@research-ts/board/service`'s `boardRows` already uses), and the market's own rank
 * (`players.adp`, the live feed `ingestAdp` writes, joined through `player_crosswalk` exactly the
 * way `boardRows` already joins it).
 *
 * NO BOARD RANK IS READ OR RETURNED. Our board's ORDER is value over replacement under a league's
 * shape, derived by `value-order.ts` where that shape is known; the stored `rank` column is a
 * rank by raw projected points and belongs to nothing here.
 *
 * `boardGeneration` is the evidence board's own `asOf` stamp, shared by every row under one
 * generation (`board-store.ts`'s `assertSingleGeneration` invariant) — the cache key's second
 * half (`store.ts`), so a board refresh naturally invalidates a stale cached run.
 */
import { eq, inArray } from "drizzle-orm";
import type { Db } from "@research-ts/db/client";
import { players as playersTable, playerCrosswalk } from "@research-ts/db/schema";
import { BOARD_SOURCE, preseasonProjectionsAsOf } from "@research-ts/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@research-ts/projections/preseason/current";
import type { SimPlayerEvidence } from "./types";

export interface EvidencePool {
  readonly pool: readonly SimPlayerEvidence[];
  readonly boardGeneration: string;
}

/**
 * `source` (the scoring-formats round, 2026-09-08) is which format's board the pool reads:
 * `BOARD_SOURCE` (PPR) for a league-free surface, or the league's own
 * (`league-service/board-format.ts`'s `leagueBoardFormat`) where the caller stands in a league.
 */
export async function evidencePoolFor(db: Db, asOf: Date = new Date(), source: string = BOARD_SOURCE): Promise<EvidencePool> {
  const projections = await preseasonProjectionsAsOf(db, { season: PRODUCT_SEASON, source, asOf });
  if (projections.length === 0) return { pool: [], boardGeneration: "" };

  const nflIds = projections.map((row) => row.playerId);
  const crosswalkRows = await db
    .select({ nflPlayerId: playerCrosswalk.nflPlayerId, playerId: playersTable.id, position: playersTable.position, adp: playersTable.adp })
    .from(playerCrosswalk)
    .innerJoin(playersTable, eq(playersTable.id, playerCrosswalk.playerId))
    .where(inArray(playerCrosswalk.nflPlayerId, nflIds));
  const byNflId = new Map(crosswalkRows.map((row) => [row.nflPlayerId as string, row]));

  const withIdentity = projections.flatMap((row) => {
    const identity = byNflId.get(row.playerId);
    return identity === undefined ? [] : [{ row, identity }];
  });

  const byAdpAscending = [...withIdentity]
    .filter(({ identity }) => identity.adp !== null)
    .sort((a, b) => a.identity.adp! - b.identity.adp!);
  const marketRankByPlayerId = new Map(byAdpAscending.map(({ identity }, index) => [identity.playerId, index] as const));

  // Read order only, carrying no meaning of its own: the stored board rank makes the returned
  // array stable run to run, and every consumer sorts it into whichever order it actually needs.
  const stable = [...withIdentity].sort((a, b) => a.row.rank - b.row.rank);
  const pool: readonly SimPlayerEvidence[] = stable.map(({ row, identity }) => ({
    playerId: identity.playerId,
    position: identity.position,
    marketRank: marketRankByPlayerId.get(identity.playerId) ?? null,
    projectedPoints: row.projectedPoints,
  }));

  return { pool, boardGeneration: projections[0]!.asOf.toISOString() };
}
