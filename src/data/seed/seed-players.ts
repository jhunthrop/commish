import type { Db } from "@/db/client";
import { players, playerStatLines } from "@/db/schema";
import { excludedSetFor } from "@/db/upsert";
import type { StatLine } from "@/domain/player";
import type { StatsProvider } from "@/stats/provider";
import type { RequestBudget } from "@/stats-pipeline/budget";
import type { ReferenceCache } from "@/stats-pipeline/reference-cache";
import { assertLocalSeedTarget } from "./guard";

const BATCH = 500;

/** The documented cost of `listPlayers()`: the player list, plus the teams call that mints one
 *  synthetic player per team defense. See `StatsProvider`'s request-cost table. */
const LIST_PLAYERS_REQUESTS = 2;

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

/** Fails the seed LOUDLY rather than silently backfilling half a season: a partially seeded
 *  `player_stat_lines` table looks exactly like a complete one to every reader. */
async function reserveOrThrow(budget: Pick<RequestBudget, "reserveBackfill">, count: number, what: string): Promise<void> {
  const reservation = await budget.reserveBackfill(count);
  if (reservation.granted) return;
  throw new Error(
    `The monthly upstream request budget could not cover ${what} (${count} requests, denied: ${reservation.denial}). ` +
      `Raise STATS_MONTHLY_REQUEST_BUDGET to the purchased quota, or wait for the calendar month to roll over.`,
  );
}

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
 */
export async function seedPlayers(
  db: Db,
  provider: StatsProvider,
  cache: Pick<ReferenceCache, "invalidatePlayers"> = NOOP_REFERENCE_CACHE,
  budget: Pick<RequestBudget, "reserveBackfill"> = UNMETERED_BUDGET,
): Promise<{ players: number; statLines: number }> {
  assertLocalSeedTarget();
  await reserveOrThrow(budget, LIST_PLAYERS_REQUESTS, "the player list");
  const allPlayers = await provider.listPlayers();
  for (const batch of chunks(allPlayers, BATCH)) {
    await db
      .insert(players)
      .values(batch.map((p) => ({ id: p.id, name: p.name, position: p.position, nflTeam: p.nflTeam })))
      .onConflictDoUpdate({ target: players.id, set: excludedSetFor(players, ["id"]) });
  }
  void cache.invalidatePlayers();

  let statCount = 0;
  // Ask the provider week by week — the interface is week-scoped so a live feed can be polled the same way.
  for (let week = 1; ; week++) {
    await reserveOrThrow(budget, 1, `week ${week}'s schedule`);
    const games = await provider.listGames(week);
    // An empty schedule is how a provider says "past the end of the season" — the same boundary
    // an empty stat-line list marks, asserted by the contract suite so the two always agree.
    if (games.length === 0) break;

    await reserveOrThrow(budget, games.length, `week ${week}'s ${games.length} box scores`);
    const lines: StatLine[] = [];
    for (const game of games) lines.push(...(await provider.getGameStatLines(game)));
    if (lines.length === 0) continue;
    for (const batch of chunks(lines, BATCH)) {
      await db
        .insert(playerStatLines)
        .values([...batch])
        .onConflictDoUpdate({
          target: [playerStatLines.playerId, playerStatLines.week],
          set: excludedSetFor(playerStatLines, ["playerId", "week"]),
        });
    }
    statCount += lines.length;
  }
  return { players: allPlayers.length, statLines: statCount };
}
