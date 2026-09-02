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
    /**
     * THE OFFICIAL INJURY REPORT, back to 2009, with the league's own filing timestamp on every row.
     *
     * One of only two sources here whose facts become knowable BEFORE the game they describe, which
     * is what makes a news pass possible at all. Everything else in this adapter is a record of
     * something that already happened.
     */
    injuries: "injuries",
    /**
     * WEEK-ONE ROSTERS — the only source whose facts predate the SEASON they describe. Cutdown to
     * fifty-three is a league-wide deadline in late August, so a week-1 roster is knowable before
     * the opener, and it is the only way a preseason board can know that a receiver changed teams
     * in March. See `rosters.ts` for what is deliberately discarded.
     */
    weeklyRosters: "weekly_rosters",
    /**
     * PUBLISHED DEPTH CHARTS, back to 2019, one file a season keyed on season, week and club.
     *
     * The second source whose facts predate the games they describe, and the only one in this
     * adapter that carries NO DATE of its own — see `preseason/depth.ts` for how its stamp is
     * derived and what that derivation is allowed to claim.
     */
    depthCharts: "depth_charts",
    /**
     * EVERY NFL DRAFT PICK, one file for the whole history, keyed on the NFL's own `gsis_id` the
     * same way `players` is. Courtesy of Pro Football Reference; nflverse's own release notes say
     * it dates back to 1980, and it is what `preseason/rookie-curve.ts` is fit against — see that
     * module for why a dedicated table beats reusing `preseason_rosters.draft_pick`.
     */
    draftPicks: "draft_picks",
  },
  /** Asset names. Only the ones covering the whole history are fixed; the rest carry a season. */
  files: {
    players: "players.csv",
    draftPicks: "draft_picks.csv",
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
  /**
   * Only the regular season is scored.
   *
   * THERE IS NO `scoredPositions` HERE ANY MORE (fit-round Task 1). It used to sit beside this line
   * as `["QB", "RB", "WR", "TE"]` and was matched against each file's own `position` column — a
   * second, narrower opinion about who this engine projects, competing with `projectedPosition`
   * (`players.ts`), which is the real one and which maps FB and HB to RB deliberately. Where the two
   * disagreed the file's spelling won and the row was dropped before the universe was ever asked,
   * costing 4,828 skill player-weeks across 2003-2024. `isProjectedCandidate` (`players.ts`) is the
   * one gate now; deleting the constant is what stops the second opinion coming back.
   */
  seasonType: "REG",
} as const;
