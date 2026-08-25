import type { Player, StatLine } from "@/domain/player";
import type { AdpEntry, GameStatus, GameSummary, RequestCost, StatsProvider } from "@/stats/provider";

/** One game the fake provider knows about, plus the box score it hands back for it. */
export interface ScriptedGame {
  readonly gameId: string;
  readonly week: number;
  readonly status: GameStatus;
  readonly homeNflTeam: string;
  readonly awayNflTeam: string;
  readonly lines: readonly StatLine[];
}

/**
 * What `fakeStatsProvider` reads on every call. A plain, MUTABLE object rather than a value
 * handed to the factory once: a worker test drives a game through `scheduled -> in_progress ->
 * final` across several `tick()` calls, and the only way to do that against the same
 * `StatsProvider` instance is for the test to reassign `script.games[week]` between ticks and
 * have the provider read the live object, the same way `ticker.test.ts` drives time forward by
 * reassigning a shared `now` between calls rather than rebuilding the clock each time.
 */
export interface FakeStatsProviderScript {
  players?: readonly Player[];
  games: Partial<Record<number, readonly ScriptedGame[]>>;
  /** Defaults to `STATS_INGESTION_CONFIG.lastWeekOfSeason`'s old value of 18, which is past every
   *  week these scripts use — a test that cares about the season clamp sets its own. */
  lastWeekOfSeason?: number;
  /** Defaults to `metered`, which is what the worker's ledger tests need: a free provider is not
   *  debited at all, so a fake that claimed to be free could not demonstrate the arithmetic. */
  requestCost?: RequestCost;
  /** Defaults to none: the worker never reads ADP, so most scripts have no reason to carry any.
   *  A script driving the contract suite (or `ingestAdp`) sets its own. */
  adp?: readonly AdpEntry[];
}

const DEFAULT_LAST_WEEK = 18;

/**
 * A `StatsProvider` whose every answer comes straight out of `script`, for driving the ingestion
 * worker's tick-by-tick decisions deterministically. Not a decorated `createMockStatsProvider`:
 * that provider is keyed to the committed season dataset and always answers `final` (or one
 * fixed `liveWeek`), which cannot express "this exact game turns final on tick 2" — the scenario
 * the worker's request-budget tests are built around.
 */
export function fakeStatsProvider(script: FakeStatsProviderScript): StatsProvider {
  const gamesFor = (week: number): readonly ScriptedGame[] => script.games[week] ?? [];

  return {
    requestCost: script.requestCost ?? "metered",
    lastWeekOfSeason: script.lastWeekOfSeason ?? DEFAULT_LAST_WEEK,

    async listPlayers(): Promise<readonly Player[]> {
      return script.players ?? [];
    },

    async listGames(week: number): Promise<readonly GameSummary[]> {
      return gamesFor(week).map((game) => ({
        gameId: game.gameId, week: game.week, status: game.status,
        homeNflTeam: game.homeNflTeam, awayNflTeam: game.awayNflTeam,
      }));
    },

    async getGameStatLines(game: GameSummary): Promise<readonly StatLine[]> {
      const found = gamesFor(game.week).find((candidate) => candidate.gameId === game.gameId);
      return found?.lines ?? [];
    },

    async getWeeklyStatLines(week: number): Promise<readonly StatLine[]> {
      return gamesFor(week).flatMap((game) => game.lines);
    },

    async listAdp(): Promise<readonly AdpEntry[]> {
      return script.adp ?? [];
    },
  };
}
