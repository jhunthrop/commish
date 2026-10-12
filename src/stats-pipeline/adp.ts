import { sql } from "drizzle-orm";
import type { Db } from "@research/db/client";
import { players } from "@research/db/schema";
import { LIST_ADP_REQUEST_COST, LIST_PLAYERS_REQUEST_COST, type StatsProvider } from "@/stats/provider";
import { reserveBackfillOrThrow, type RequestBudget } from "./budget";

export interface AdpIngestResult {
  /** Entries the provider's feed supplied — already intersected with the provider's OWN listed
   *  players (a contract-suite law), but not yet with what the database holds. */
  readonly adpEntries: number;
  /** `players` rows that actually took a value. Differs from `adpEntries` only when the feed
   *  ranks a player the roster backfill has not seeded yet — an honest count, so a permanently
   *  short update is visible instead of looking like a healthy run. */
  readonly playersUpdated: number;
}

/**
 * The ADP enrichment: one feed read, one column write. Fetches the provider's current Average
 * Draft Position list and lands each value on its `players.adp` row — the column `rankedPlayers`
 * (`src/draft-service/pool.ts`) orders the draft pool by.
 *
 * The ONLY writer of `players.adp`. `seedPlayers` deliberately excludes the column from its
 * upsert's update set (it inserts rows without a value, so `excluded.adp` is always NULL), which
 * makes the two idempotent against each other in either order: seed → adp ranks a fresh
 * database, adp → seed does not wipe the ranking.
 *
 * UPDATE, not upsert: an ADP entry whose player has no row yet (a rookie the feed ranks before
 * the roster backfill ran) must not mint a half-empty `players` row missing a name and position —
 * it lands on nothing and the returned counts say so. A player the feed no longer ranks keeps its
 * last value rather than being nulled; ADP only ever moves via the feed, and "absent from one
 * read" is indistinguishable from a trimmed response.
 *
 * Every upstream call is reserved against the ledger FIRST, at its documented cost
 * (`LIST_PLAYERS_REQUEST_COST` + `LIST_ADP_REQUEST_COST` — see `StatsProvider`'s table), through
 * the backfill share: like `seedPlayers`, this is an operator-run enrichment, never the worker's
 * recurring tick. `listPlayers()` is fetched explicitly before `listAdp()` so the reservation
 * matches what the Tank01 adapter actually does — its `listAdp` intersects against the memoized
 * roster, fetching it (2 requests) when nothing has yet.
 *
 * Idempotent by construction: the write is an absolute-value UPDATE keyed by player id, so a
 * re-run rewrites the same values and a partial failure is recovered by running it again.
 */
export async function ingestAdp(
  db: Db,
  provider: StatsProvider,
  budget: Pick<RequestBudget, "reserveBackfill">,
): Promise<AdpIngestResult> {
  await reserveBackfillOrThrow(budget, LIST_PLAYERS_REQUEST_COST, "the player list");
  await provider.listPlayers();
  await reserveBackfillOrThrow(budget, LIST_ADP_REQUEST_COST, "the ADP feed");
  const entries = await provider.listAdp();
  if (entries.length === 0) return { adpEntries: 0, playersUpdated: 0 };

  // One statement, not a row-per-round-trip loop: the whole feed rides in a single jsonb
  // parameter (drizzle expands a JS array parameter into a `($1, $2, ...)` tuple, so a pair of
  // `unnest` arrays is not expressible here) and `jsonb_to_recordset` turns it back into rows
  // server-side. RETURNING is what makes `playersUpdated` the number of rows that actually took
  // a value rather than the number we hoped would.
  const feed = JSON.stringify(entries.map((entry) => ({ id: entry.playerId, adp: entry.adp, pos_adp: entry.posAdp ?? null })));
  const updated = await db.execute(sql`
    update ${players}
    set adp = data.adp, pos_adp = data.pos_adp
    from jsonb_to_recordset(${feed}::jsonb) as data(id text, adp real, pos_adp text)
    where ${players.id} = data.id
    returning ${players.id}
  `);
  return { adpEntries: entries.length, playersUpdated: updated.length };
}
