/**
 * Every tunable the nflverse adapter has.
 *
 * nflverse is a COMMUNITY project with no SLA and no contract behind it, which is why this
 * adapter's output is ingested into our own point-in-time store and never read at runtime by a
 * product surface. A draft-week feature may not depend on a volunteer's GitHub release being up.
 * See the engine spec's Sources section.
 */
export const NFLVERSE_CONFIG = {
  /** Release assets, `.../releases/download/<release>/<file>`. */
  baseUrl: "https://github.com/nflverse/nflverse-data/releases/download/",
  releases: {
    /**
     * Per-player, per-game offensive/defensive/special-teams snaps. THE reason this module exists:
     * a box score says five catches on eight targets and cannot say whether the man played twenty
     * snaps or sixty, and those are two different players. Layer 1 forecasts opportunity, so it
     * needs the denominator.
     */
    snapCounts: "snap_counts",
    /** Per-player, per-week counting stats. The targets numerator, and the ACTUALS the backtest
     *  scores every projection against. */
    playerWeek: "player_stats",
    /**
     * THE HISTORICAL PLAYER UNIVERSE — every player back to 1999, with the gsis and pfr ids the
     * other two files key on. Phase 2, Task 1: without it, identity is a name join against a
     * current roster snapshot, which loses ten points of resolution per season going backwards
     * because retired players are genuinely absent from a roster. See `players.ts`.
     */
    players: "players",
    /**
     * THE OFFICIAL INJURY REPORT, back to 2009, with the league's own filing timestamp on every row.
     *
     * The one feed here whose facts become knowable BEFORE the game they describe, which is what
     * makes a news pass possible at all. Every other source in this adapter is a record of something
     * that has already happened.
     */
    injuries: "injuries",
  },
  /** Asset names. Only the universe's is fixed; the other two carry a season. */
  files: {
    players: "players.csv",
  },
  /**
   * How long after a game its numbers become knowable, for the `as_of` stamp.
   *
   * nflverse rebuilds these releases within hours of a game finishing, but the exact moment is not
   * recorded in the file, so this is a deliberate over-estimate. Being LATE with an `as_of` can
   * only ever hide a row from a replay that could legitimately have seen it — costing a little
   * accuracy — while being early leaks the future into the past and invalidates every number the
   * harness produces. Only one of those two errors is recoverable, so the stamp errs in that
   * direction.
   */
  publicationLagHours: 24,
  /** Only the regular season is scored, and only these positions are projected. */
  seasonType: "REG",
  scoredPositions: ["QB", "RB", "WR", "TE"],
} as const;
