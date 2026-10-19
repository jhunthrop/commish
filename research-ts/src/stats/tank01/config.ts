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
  /**
   * How long the client waits before its single retry of a 429. RapidAPI's per-second burst
   * limit resets within a second; 1100ms clears it with margin without meaningfully delaying
   * a backfill. One retry only — a 429 that survives it is the monthly quota speaking.
   */
  burstRetryDelayMs: 1_100,
  baseUrl: "https://tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com",
  paths: {
    playerList: "/getNFLPlayerList",
    teams: "/getNFLTeams",
    gamesForWeek: "/getNFLGamesForWeek",
    boxScore: "/getNFLBoxScore",
    adp: "/getNFLADP",
    /**
     * The ephemeral feeds the capture job polls (`src/projections/capture-feeds.ts`). They live
     * here with the rest of the Tank01 surface so there is one place a path is written down.
     *
     * UNVERIFIED against the live API, unlike everything above them: `TANK01_API_KEY` is still
     * empty, so these are taken from the published endpoint list rather than from a probe. That is
     * survivable BECAUSE of how the capture treats them — a feed whose request fails is reported
     * and skipped, never fatal, so a wrong path shows up in the tick log as one dead feed on the
     * day a key arrives while the other six keep capturing. Confirm them with
     * `npm run stats:tank01:record` then, and correct any that are wrong.
     */
    teamRoster: "/getNFLTeamRoster",
    depthCharts: "/getNFLDepthCharts",
    changelog: "/getNFLChangelog",
    news: "/getNFLNews",
    bettingOdds: "/getNFLBettingOdds",
    dfs: "/getNFLDFS",
    /** The harvest widening (founder, 2026-08-30: "make sure we're harvesting all of the data").
     *  All four probed live before wiring: projections return playerProjections +
     *  teamDefenseProjections keyed maps with fantasyPointsDefault; injuriesByDate returns
     *  {injDate, injList[{playerID, designation, team, pos}]}; inactives takes `week` and
     *  returns per-game home/away player lists; currentInfo is the source's own calendar. */
    projections: "/getNFLProjections",
    injuriesByDate: "/getNFLInjuriesByDate",
    inactives: "/getNFLInactiveList",
    currentInfo: "/getNFLCurrentInfo",
  },
  /**
   * Which ADP market `/getNFLADP` answers with (`adpType` query parameter). `PPR` because it is
   * the product's default scoring (`PPR_SCORING` is `rankedPlayers`' fallback): an ADP feed is
   * one market-wide consensus, and the market this product's boards should mirror is the PPR
   * one. Verified against the live API 2026-08-25: the response echoes the type back
   * (`body.adpType: "PPR"`).
   */
  adpType: "PPR",
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
    /** Prefixes: "Final/OT" and "Final OT" read final too (Lane 89, 2026-10-19). */
    final: ["completed", "final"],
    in_progress: ["live - in progress", "in progress", "halftime"],
  },
  /** Upstream's `gameStatusCode`, read before the words (Lane 89, 2026-10-19). */
  gameStatusCodes: { "0": "scheduled", "1": "in_progress", "2": "final" },
  envVars: {
    apiKey: "TANK01_API_KEY",
    season: "TANK01_SEASON",
  },
} as const;
