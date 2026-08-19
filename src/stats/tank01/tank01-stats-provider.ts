import type { Player, StatLine } from "@/domain/player";
import type { StatsProvider } from "../provider";
import { createTank01Client, type Tank01ClientOptions } from "./client";
import { TANK01_CONFIG } from "./config";
import { mapBoxScoreToStatLines, mapGameIds, mapPlayerList, mapTeamsToDefensePlayers } from "./map";

export interface Tank01ProviderOptions extends Tank01ClientOptions {
  /** Defaults to `TANK01_CONFIG.defaultSeason`. A season is adapter config, not an interface parameter. */
  readonly season?: number;
}

export function createTank01StatsProvider(options: Tank01ProviderOptions): StatsProvider {
  const client = createTank01Client(options);
  const season = String(options.season ?? TANK01_CONFIG.defaultSeason);

  // Memoized so `getWeeklyStatLines` can intersect box scores against exactly the ids
  // `listPlayers()` mints (see map.ts's `mapBoxScoreToStatLines` doc) without a second round trip
  // when the caller already fetched the roster first, which `seedPlayers` always does.
  let players: Promise<readonly Player[]> | undefined;
  function fetchPlayers(): Promise<readonly Player[]> {
    players ??= (async () => {
      const [playerBody, teamBody] = await Promise.all([
        client.get(TANK01_CONFIG.paths.playerList),
        client.get(TANK01_CONFIG.paths.teams),
      ]);
      // Two calls in parallel because they are independent and both are once-per-seed.
      return [...mapPlayerList(playerBody), ...mapTeamsToDefensePlayers(teamBody)];
    })();
    return players;
  }

  return {
    async listPlayers() {
      return fetchPlayers();
    },

    async getWeeklyStatLines(week) {
      // Answered locally, without a request. `seedPlayers` walks weeks upward until it gets an
      // empty array, so an unbounded provider would burn a month's free-tier quota discovering
      // where the season ends.
      if (week < TANK01_CONFIG.weeks.first || week > TANK01_CONFIG.weeks.last) return [];

      const [listedPlayerIds, schedule] = await Promise.all([
        fetchPlayers().then((list) => new Set(list.map((player) => player.id))),
        client.get(TANK01_CONFIG.paths.gamesForWeek, {
          week: String(week),
          season,
          seasonType: TANK01_CONFIG.seasonType,
        }),
      ]);

      // SEQUENTIAL, not `Promise.all`. A week is around sixteen box scores; issuing them at once
      // is the fastest way to a 429 on any plan below Ultra, and a rate-limit failure part way
      // through a burst leaves you with no idea which games you got. One at a time fails on the
      // first refusal with every prior game already mapped.
      const lines: StatLine[] = [];
      for (const gameId of mapGameIds(schedule)) {
        const box = await client.get(TANK01_CONFIG.paths.boxScore, { gameID: gameId });
        lines.push(...mapBoxScoreToStatLines(box, week, listedPlayerIds));
      }
      return lines;
    },
  };
}
