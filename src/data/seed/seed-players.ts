import type { Db } from "@research-ts/db/client";
import { players, playerStatLines } from "@research-ts/db/schema";
import { excludedSetFor } from "@research-ts/db/upsert";
import type { StatLine } from "@research-ts/domain/player";
import { dedupedByPlayerId } from "@/stats-pipeline/persist";
import { LIST_PLAYERS_REQUEST_COST, type StatsProvider } from "@/stats/provider";
import { reserveBackfillOrThrow, type RequestBudget } from "@/stats-pipeline/budget";
import type { ReferenceCache } from "@/stats-pipeline/reference-cache";
import { assertLocalSeedTarget } from "./guard";

const BATCH = 500;

/** No Redis connection needed: every existing caller of `seedPlayers` keeps working untouched. */
const NOOP_REFERENCE_CACHE: Pick<ReferenceCache, "invalidatePlayers"> = {
  invalidatePlayers: async () => {},
};

/**
 * The default when no ledger is injected: grant everything. The seed's own entry point
 * (`./index.ts`) wires the real budget, and that is the path a real API key travels; a test or a
 * script driving the mock provider spends nothing upstream and has nothing to count.
 */
const UNMETERED_BUDGET: Pick<RequestBudget, "reserveBackfill"> = {
  reserveBackfill: async () => ({ granted: true }),
};

function chunks<T>(arr: readonly T[], size: number): readonly (readonly T[])[] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Idempotent: upserts players AND stat lines from the provider — existing rows are updated
 * to the provider's current values, not left stale (a licensed feed can revise a stat line
 * mid-week). The returned counts are the number of players / stat lines the provider
 * supplied for this run, not the number of rows newly inserted (the two are identical only
 * on a fresh, empty database). Safe to run repeatedly.
 *
 * Guarded in its own right, not only at the entry point: this is the largest write in the
 * repo (every player × every week) and the one that used to run before any check at all.
 *
 * `cache` is injected with a no-op default so every existing caller keeps working without a
 * Redis connection. When a real cache is supplied, the player index is invalidated after the
 * upsert completes, because the seed is the only writer of `players` today.
 *
 * `budget` is injected the same way, and every upstream call below is reserved against it FIRST,
 * at the exact count that call costs — `STATS_INGESTION_CONFIG.reservedForBackfill` is only a
 * real reservation if the backfill actually draws on it, and until this existed the largest
 * spender in the repo was the one path that spent nothing through the ledger. The week loop reads
 * per GAME rather than through `getWeeklyStatLines`, for the same reason the worker does: a
 * `listGames` first makes the week's cost exactly knowable (1 + one per game) before a single
 * box score is fetched, so the reservation is the real number and never a worst case. The
 * contract suite asserts the two reads return identical lines, so the seeded rows are unchanged.
 *
 * The loop is bounded by the PROVIDER's own `lastWeekOfSeason` rather than walking until it gets
 * an empty answer. Walking one week past the end reserved a request for a call the adapter
 * answers locally without one (`tank01-stats-provider.ts` short-circuits outside its week range),
 * which put the measured backfill at 309 against a `reservedForBackfill` of 308 — a reservation
 * that is one larger than the thing it reserves for is not a measurement, it is a rounding error
 * with a number attached.
 *
 * NOT ATOMIC, and it does not pretend to be. A denial partway through leaves the weeks already
 * written durably in place and throws, naming what landed. That is safe rather than tidy because
 * the whole function is idempotent — every write is an upsert of absolute values — so the recovery
 * is to run `npm run seed` again once the ledger allows it, and the second run overwrites the
 * partial one and finishes the rest. Rolling a season-sized backfill into one transaction would
 * hold a background connection open for its whole duration to buy nothing the rerun does not
 * already give.
 */
export async function seedPlayers(
  db: Db,
  provider: StatsProvider,
  cache: Pick<ReferenceCache, "invalidatePlayers"> = NOOP_REFERENCE_CACHE,
  budget: Pick<RequestBudget, "reserveBackfill"> = UNMETERED_BUDGET,
): Promise<{ players: number; statLines: number }> {
  assertLocalSeedTarget();
  await reserveBackfillOrThrow(budget, LIST_PLAYERS_REQUEST_COST, "the player list");
  const allPlayers = await provider.listPlayers();
  for (const batch of chunks(allPlayers, BATCH)) {
    await db
      .insert(players)
      .values(batch.map((p) => ({ id: p.id, name: p.name, position: p.position, nflTeam: p.nflTeam, headshotUrl: p.headshotUrl })))
      // `adp` is excluded from the update set alongside the conflict key: the seed inserts rows
      // WITHOUT an adp value, so `excluded.adp` is always NULL, and including it would make every
      // seed re-run silently wipe the ADP enrichment `ingestAdp` (`src/stats-pipeline/adp.ts`)
      // wrote — the column has exactly one writer, and this function is not it.
      //
      // `headshotUrl` is DELIBERATELY NOT in this exclusion list (founder directive 2026-08-26):
      // unlike `adp`, the seed IS this column's only writer, and the incoming value is always the
      // provider's current one — a re-run should overwrite a stale or missing URL rather than
      // leave it behind, so `excludedSetFor`'s default (assign every non-key column) is exactly
      // right here without a carve-out.
      .onConflictDoUpdate({ target: players.id, set: excludedSetFor(players, ["id", "adp"]) });
  }
  void cache.invalidatePlayers();

  let statCount = 0;
  let weeksWritten = 0;
  // Ask the provider week by week — the interface is week-scoped so a live feed can be polled the same way.
  for (let week = 1; week <= provider.lastWeekOfSeason; week++) {
    try {
      await reserveBackfillOrThrow(budget, 1, `week ${week}'s schedule`);
      const games = await provider.listGames(week);
      // A week inside the season with no games is a gap in the schedule, not the end of it — the
      // end is `lastWeekOfSeason`, which the provider names and the contract suite pins.
      if (games.length === 0) continue;

      await reserveBackfillOrThrow(budget, games.length, `week ${week}'s ${games.length} box scores`);
      const lines: StatLine[] = [];
      for (const game of games) lines.push(...(await provider.getGameStatLines(game)));
      if (lines.length === 0) continue;
      // Deduped for the same reason `persistTick` dedupes: a player who appears in two of a week's
      // box scores would otherwise repeat the `(player_id, week)` conflict key inside one
      // multi-row upsert, and Postgres rejects that statement whole (21000).
      const weekLines = dedupedByPlayerId(lines);
      for (const batch of chunks(weekLines, BATCH)) {
        await db
          .insert(playerStatLines)
          .values([...batch])
          .onConflictDoUpdate({
            target: [playerStatLines.playerId, playerStatLines.week],
            set: excludedSetFor(playerStatLines, ["playerId", "week"]),
          });
      }
      statCount += weekLines.length;
      weeksWritten += 1;
    } catch (error: unknown) {
      // Say exactly what landed before rethrowing. A backfill that stops halfway looks identical
      // to a complete one from the database's point of view, and "run it again" is only useful
      // advice if the operator can see that it stopped.
      console.error(
        `[seed] the player backfill stopped during week ${week}: ${weeksWritten} week(s) and ${statCount} stat lines were written and are durable. Re-run \`npm run seed\` to finish — every write is an idempotent upsert, so a re-run completes the rest without duplicating anything.`,
      );
      throw error;
    }
  }
  return { players: allPlayers.length, statLines: statCount };
}
