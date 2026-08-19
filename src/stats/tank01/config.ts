/**
 * Every tunable the Tank01 adapter has.
 *
 * A SEASON lives here rather than on the `StatsProvider` interface. `getWeeklyStatLines(week)`
 * stays a one-parameter method because adding a season would ripple into `player_stat_lines`,
 * which is keyed `(player_id, week)` with no season column and does not need one until a phase
 * that runs more than one season at a time. A season is a property of THIS adapter's
 * configuration, and the mock provider does not have one at all.
 */
export const TANK01_CONFIG = {
  host: "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com",
  baseUrl: "https://tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com",
  paths: {
    playerList: "/getNFLPlayerList",
    teams: "/getNFLTeams",
    gamesForWeek: "/getNFLGamesForWeek",
    boxScore: "/getNFLBoxScore",
  },
  /** Tank01 holds data from 2022 onward. `season=2026` means the 2026-27 season. */
  defaultSeason: 2026,
  /** `reg` | `post` | `pre` | `all`. Only the regular season is scored. */
  seasonType: "reg",
  /**
   * The regular season's week range. A request outside it is answered locally with an empty
   * list and never reaches the API — which matters more than it looks: `seedPlayers` walks
   * weeks upward until it gets an empty array, so without this bound a seed would burn the
   * monthly request quota discovering where the season ends.
   */
  weeks: { first: 1, last: 18 },
  /**
   * Team defenses are not players in Tank01: they arrive as `body.DST.{home,away}` on a box
   * score, keyed by team abbreviation. The domain has a `DEF` position, so the adapter
   * synthesizes one player per NFL team with this prefix. The prefix is config, not a literal,
   * because `listPlayers` and `getWeeklyStatLines` must mint the SAME id or every defense's
   * stat line would reference a player nobody drafted.
   */
  defensePlayerIdPrefix: "DST-",
  /** The positions the scoring engine handles. Everything else in the player list is dropped. */
  scoredPositions: ["QB", "RB", "WR", "TE", "K"],
  /**
   * Upstream's `gameStatus` spellings, lowercased, mapped to the domain's three. Anything not in
   * this table — a new spelling, a missing field, a null — becomes `in_progress`, which is the
   * safe direction: it costs one more request and nothing else. See `GameStatus`.
   */
  gameStatuses: {
    scheduled: ["scheduled", "not started", "pre-game"],
    final: ["completed", "final"],
    in_progress: ["live - in progress", "in progress", "halftime"],
  },
  envVars: {
    apiKey: "TANK01_API_KEY",
    season: "TANK01_SEASON",
  },
} as const;
