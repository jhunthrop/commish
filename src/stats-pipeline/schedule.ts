import type { getDb } from "@research-ts/db/client";
import { nflGames } from "@research-ts/db/schema";
import { excludedSetFor } from "@research-ts/db/upsert";
import type { StatsProvider } from "@/stats/provider";
import { reserveBackfillOrThrow, type RequestBudget } from "./budget";

type Db = ReturnType<typeof getDb>;

export interface ScheduleIngestResult {
  readonly weeks: number;
  readonly games: number;
}

/**
 * THE SCHEDULE INGESTION (founder, 2026-08-30: "why don't we have the schedule? that's a core
 * component"). `/getNFLGamesForWeek` was always being fetched — the stats pipeline used it to
 * enumerate box scores, then threw the fixtures away. This walk persists them instead: one
 * request per week, every fixture upserted into `nfl_games` with the kickoff exactly as the
 * source publishes it, so the product can put "@ KC · Sun 4:05p" beside a player.
 *
 * Idempotent by construction (upsert on the fixture's own id), so re-running refreshes statuses
 * — which is also how a flexed game's new kickoff lands: the source's current answer overwrites
 * the stale row.
 */
export async function ingestSchedule(db: Db, provider: StatsProvider, budget: RequestBudget): Promise<ScheduleIngestResult> {
  let weeks = 0;
  let games = 0;
  for (let week = 1; week <= provider.lastWeekOfSeason; week++) {
    await reserveBackfillOrThrow(budget, 1, `week ${week}'s schedule`);
    const fixtures = await provider.listGames(week);
    if (fixtures.length === 0) continue;
    await db
      .insert(nflGames)
      .values(
        fixtures.map((game) => ({
          gameId: game.gameId,
          week: game.week,
          homeNflTeam: game.homeNflTeam,
          awayNflTeam: game.awayNflTeam,
          gameDate: game.gameDate,
          kickoffEt: game.kickoffEt,
          status: game.status,
        })),
      )
      .onConflictDoUpdate({ target: nflGames.gameId, set: excludedSetFor(nflGames, ["gameId"]) });
    weeks += 1;
    games += fixtures.length;
  }
  return { weeks, games };
}
