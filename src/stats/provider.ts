import type { Player, StatLine } from "@research/domain/player";

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
  /** YYYYMMDD as the source publishes it, or "" when it does not say. Raw on purpose: kickoffs
   *  are published in Eastern time and a raw pair cannot carry a timezone-conversion bug. */
  readonly gameDate: string;
  /** Kickoff in Eastern as published (e.g. "4:05p"), or "" when the source does not say. */
  readonly kickoffEt: string;
}

/**
 * The request-cost table below, as importable numbers, for the two callers that reserve against
 * the monthly ledger BEFORE calling (`seedPlayers`, `ingestAdp`). One source: a reservation made
 * from a hand-written 2 goes quietly wrong the day the roster read gains or loses a call.
 */
export const LIST_PLAYERS_REQUEST_COST = 2;
export const LIST_ADP_REQUEST_COST = 1;

/**
 * One player's Average Draft Position: the market's consensus of where that player gets taken,
 * averaged over many real drafts — LOWER means drafted EARLIER, and fractional values ("1.6")
 * are the norm because it is an average, never a rank.
 */
export interface AdpEntry {
  /** The SAME id `listPlayers()` mints — the contract suite asserts the intersection, because an
   *  ADP keyed to an id nobody lists can never reach a `players` row. */
  readonly playerId: string;
  /** The market's position rank as the source words it ("RB1"), when it says one — the harvest
   *  widening (2026-08-30). Absent when the feed omits it; never synthesized from `adp`. */
  readonly posAdp?: string;
  /** Positive and finite. The contract suite pins both halves; a 0, negative or NaN ADP is a
   *  parsing bug, never a real market position. */
  readonly adp: number;
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
 * | `listAdp()`           | 1, plus `listPlayers()`'s 2 when the roster is not already memoized |
 *
 * An implementation that cannot honor that table must say so in its own docblock rather than
 * quietly costing more, because `src/stats-pipeline/budget.ts` reserves against these numbers.
 */
/**
 * Whether this provider's calls cost anything upstream.
 *
 * `metered` means a real account with a real monthly quota behind it, and every call has to be
 * counted through `RequestBudget`. `free` means the calls never leave the process — the committed
 * mock dataset, a fixture-backed adapter — so counting them is counting fiction: it spends a
 * ledger that exists to protect an API key, against calls no key ever sees. A developer who runs
 * `npm run seed` ten times in a month should not silently stop their own worker from ticking.
 */
export type RequestCost = "free" | "metered";

export interface StatsProvider {
  /** See `RequestCost`. Config on the provider, not a special case at the call site. */
  readonly requestCost: RequestCost;
  /**
   * The last week this provider will ever answer with games. The ingestion worker clamps its
   * forward-advancing week pointer to it, so a fully-settled season stops the pointer rather than
   * marching it past the season forever, spending a `listGames` request every tick on a week that
   * cannot exist.
   *
   * It lives on the PROVIDER and not in `STATS_INGESTION_CONFIG` because it is a property of the
   * data source, not of the pipeline: Tank01's regular season runs to week 18 and the committed
   * mock dataset is 17 weeks. A pipeline constant covering "every provider this product has" is
   * correct for at most one of them, and for the other it is a permanent stall — the worker asks
   * for week 18, the mock answers with no games, `tickWeek` returns before writing a row, the
   * pointer never advances, and every tick pays for the same empty listing forever.
   */
  readonly lastWeekOfSeason: number;
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
  /**
   * The current Average Draft Position of every listed player the source ranks, best (lowest)
   * first is NOT guaranteed — callers must not rely on order, only on the values. Read by
   * `ingestAdp` (`src/stats-pipeline/adp.ts`), which writes `players.adp`, which is what
   * `rankedPlayers` (`src/draft-service/pool.ts`) orders the draft pool by. A player the source
   * does not rank simply does not appear — absence is the signal, never a sentinel value.
   */
  listAdp(): Promise<readonly AdpEntry[]>;
}
