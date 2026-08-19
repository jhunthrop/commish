import type { Player, StatLine } from "@/domain/player";

/**
 * Where a fixture is in its life. Three values, because three is what any downstream decision
 * actually needs: do not poll it yet, poll it again, never poll it again.
 *
 * An UNRECOGNIZED upstream spelling maps to `in_progress`, never to `final` and never to
 * `scheduled` — see `mapGames` in `src/stats/tank01/map.ts`. `in_progress` is the only safe
 * default because it is the one value that costs a request and changes nothing else: a game
 * wrongly called `final` is never fetched again and its points are lost for the season, and a
 * game wrongly called `scheduled` locks nothing and is never fetched at all.
 */
export type GameStatus = "scheduled" | "in_progress" | "final";

export interface GameSummary {
  /** Stable for the life of the fixture. The unit of caching, and of request cost. */
  readonly gameId: string;
  readonly week: number;
  readonly status: GameStatus;
  /** NFL team abbreviations, matching `Player.nflTeam`. */
  readonly homeNflTeam: string;
  readonly awayNflTeam: string;
}

/**
 * The seam between the app and its stats source. Phase 1 used the deterministic mock; a licensed
 * feed (SportsDataIO / SportRadar / Genius — a business decision, Phase 8) plugs in as another
 * implementation of this interface, not a rewrite.
 *
 * REQUEST COST is part of this contract, because the whole ingestion cadence is built on it and
 * the dev tier of the adapter that exists today is 1,000 requests a month:
 *
 * | method                | upstream requests                                    |
 * |-----------------------|------------------------------------------------------|
 * | `listPlayers()`       | 2, memoized for the life of the provider instance     |
 * | `listGames(week)`     | 1                                                     |
 * | `getGameStatLines(g)` | 1                                                     |
 * | `getWeeklyStatLines(w)` | 1 + one per game in the week                        |
 *
 * An implementation that cannot honor that table must say so in its own docblock rather than
 * quietly costing more, because `src/stats-pipeline/budget.ts` reserves against these numbers.
 */
export interface StatsProvider {
  listPlayers(): Promise<readonly Player[]>;
  /** Empty outside the provider's season, which is what terminates the worker's week scan. */
  listGames(week: number): Promise<readonly GameSummary[]>;
  /** Only players `listPlayers()` also lists, only teams this game was played between. */
  getGameStatLines(game: GameSummary): Promise<readonly StatLine[]>;
  /**
   * Every stat line in the week, identical to the union of `getGameStatLines` over
   * `listGames(week)` — asserted by the shared contract suite, because two expressions of one
   * week is how a seeded season and a live season end up disagreeing.
   */
  getWeeklyStatLines(week: number): Promise<readonly StatLine[]>;
}
