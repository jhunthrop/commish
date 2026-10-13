import type { Player, StatLine } from "@research-ts/domain/player";
import type { GameSummary, StatsProvider } from "../provider";
import { createTank01Client, type Tank01ClientOptions } from "@research-ts/stats/tank01/client";
import { TANK01_CONFIG } from "@research-ts/stats/tank01/config";
import { mapAdpList, mapBoxScoreToStatLines, mapGames, mapPlayerList, mapTeamsToDefensePlayers } from "./map";

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

  async function listGames(week: number): Promise<readonly GameSummary[]> {
    // Answered locally, without a request. `seedPlayers` walks weeks upward until it gets an
    // empty array, so an unbounded provider would burn a month's free-tier quota discovering
    // where the season ends.
    if (week < TANK01_CONFIG.weeks.first || week > TANK01_CONFIG.weeks.last) return [];
    const body = await client.get(TANK01_CONFIG.paths.gamesForWeek, {
      week: String(week),
      season,
      seasonType: TANK01_CONFIG.seasonType,
    });
    return mapGames(body, week);
  }

  // The player list is TODAY'S rosters, whatever season the provider reads — Tank01 has no
  // per-season list. So the two-teams cross-check below is only true for the CURRENT season; a
  // historical season's box score legitimately carries players who have since moved teams, and
  // filtering them against today's roster deletes their whole season (founder, 2026-08-30: "If
  // a player has switched teams it doesn't show any stats for the previous season" — the 2025
  // backfill lost every offseason mover).
  const historical = Number(season) < TANK01_CONFIG.defaultSeason;

  async function getGameStatLines(game: GameSummary): Promise<readonly StatLine[]> {
    const list = await fetchPlayers();
    const listedPlayerIds = new Set(list.map((player) => player.id));
    const box = await client.get(TANK01_CONFIG.paths.boxScore, { gameID: game.gameId });
    // The listed-players filter Plan A's fix wave added: a stat line for an id nobody lists is
    // a foreign-key failure at seed time.
    const lines = mapBoxScoreToStatLines(box, game.week, listedPlayerIds);
    if (historical) return lines;
    // Current season only, defense-in-depth: a box score keyed to the wrong fixture would
    // otherwise attribute real points to a real player in a game they did not play, which no
    // week-level check can catch.
    const teams = new Set([game.homeNflTeam, game.awayNflTeam]);
    const gameTeamPlayerIds = new Set(list.filter((player) => teams.has(player.nflTeam)).map((player) => player.id));
    return lines.filter((line) => gameTeamPlayerIds.has(line.playerId));
  }

  return {
    /** A paid RapidAPI account with a monthly quota. Every call below is a real request. */
    requestCost: "metered",
    /** The same bound `listGames` answers locally against — one number, read twice. */
    lastWeekOfSeason: TANK01_CONFIG.weeks.last,

    async listPlayers() {
      return fetchPlayers();
    },

    listGames,

    getGameStatLines,

    async getWeeklyStatLines(week) {
      // SEQUENTIAL, not `Promise.all` — unchanged reasoning: a week is around sixteen box scores,
      // issuing them at once is the fastest way to a 429 on any plan below Ultra, and a
      // rate-limit failure part way through a burst leaves you with no idea which games you got.
      const lines: StatLine[] = [];
      for (const game of await listGames(week)) {
        lines.push(...(await getGameStatLines(game)));
      }
      return lines;
    },

    async listAdp() {
      // The memoized roster, for the same reason `getGameStatLines` reads it: the intersection
      // against listed ids is decided ONCE, by `mapPlayerList`/`mapTeamsToDefensePlayers`, and
      // every downstream read only ever filters against what was already decided. Costs the
      // roster's 2 requests only when nothing has fetched it yet this instance — the contract
      // table names that.
      const list = await fetchPlayers();
      const listedPlayerIds = new Set(list.map((player) => player.id));
      const body = await client.get(TANK01_CONFIG.paths.adp, { adpType: TANK01_CONFIG.adpType });
      return mapAdpList(body, listedPlayerIds);
    },
  };
}
