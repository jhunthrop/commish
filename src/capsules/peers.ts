import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { Position } from "@/domain/player";
import { allPositions } from "@/projections/backtest";
import { BOARD_SOURCE } from "@/projections/preseason/board-store";

/**
 * THE ACTIVE POPULATION — who a fact about "his position's peers" is honestly measured against.
 *
 * THE BUG THIS EXISTS TO CLOSE (peek-facts design §3.3, measured on production 2026-09-07). Every
 * ranked color fact was handed `allPositions(db)`, which is the whole HISTORICAL universe: 3,293
 * receivers back to 1999, of whom 228 have a recent season. Two costs, one of them silent:
 *   - The reads underneath it are chunked `IN` lists over `player_week_observations`, sixteen of
 *     them at about half a second each for one peek. That is the ten seconds the peek was paying.
 *   - The qualifier counts a rank quotes ("RB4 of 228") were being computed by handing a store a
 *     population fourteen times the size of the one that could possibly answer, and getting the
 *     right answer only because a retired player has no row to rank. The right answer for the wrong
 *     reason is one ingestion away from being the wrong answer.
 *
 * WHO IS ACTIVE. A player who holds a row in the board generation for `season`, or a stat-line week
 * in `season` or the season before it. Nothing about a name, nothing about a roster status this
 * product does not carry: two facts already in the store, both of which mean "this man is someone
 * the current game is about".
 *
 * `allPositions(db)` STAYS WHAT IT IS. The backtest replays whole seasons and genuinely needs every
 * historical person the store places (`projections/backtest.ts`'s own docblock). This function is
 * the LIVE-surface reader beside it, and it reuses `allPositions` as its own position lookup rather
 * than issuing a second read of the same small table.
 *
 * WHY IT TAKES A POSITION LIST rather than the design's single `position` (ruling, recorded in the
 * round ledger): the two callers want different widths of the same answer — the whole-board sweep
 * wants every position on the board at once, a single-player peek wants one — and a list serves both
 * from ONE function and ONE pair of queries. A single-position reader would have forced the sweep to
 * run this six times, which is the "never a parallel system" rule failing by multiplication rather
 * than by duplication.
 */
export async function activePeersFor(db: Db, positions: readonly Position[], season: number): Promise<ReadonlyMap<string, Position>> {
  if (positions.length === 0) return new Map();
  const wanted = new Set(positions);
  // TWO ROUND TRIPS, NOT THREE. The position map and the active-id set are genuinely different
  // reads, but the two halves of "active" are one `UNION` rather than two statements: this function
  // sits on the peek's own request path now, where a saved round trip is a saved round trip.
  const [universe, active] = await Promise.all([allPositions(db), activeIdsFor(db, season)]);
  return new Map([...universe].filter(([id, position]) => wanted.has(position) && active.has(id)));
}

/** Every nflverse id the board ranks for `season` or the observation store holds a week for in
 *  `season` or the one before it, as one set. `UNION` (not `UNION ALL`) so the database does the
 *  de-duplication rather than shipping both id lists over the wire to be merged here. */
async function activeIdsFor(db: Db, season: number): Promise<ReadonlySet<string>> {
  const rows = await db.execute<{ id: string }>(sql`
    SELECT player_id AS id FROM preseason_projections WHERE season = ${season} AND source = ${BOARD_SOURCE}
    UNION
    SELECT player_id AS id FROM player_week_observations WHERE season IN (${season}, ${season - 1})
  `);
  return new Set([...rows].map((row) => row.id));
}
