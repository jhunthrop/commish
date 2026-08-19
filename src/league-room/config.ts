/** Every tunable the league room's client components need. No component may inline one of these. */
export const LEAGUE_ROOM_CONFIG = {
  /** How long the matchup-win / clinch highlight stays up, ms — mirrors `DRAFT_ROOM_CONFIG.celebrationMs`. */
  celebrationMs: 3_200,
  /**
   * How often `HomeBoard` (`./components/home-board.tsx`) re-fetches `/api/home`, ms. Gated
   * behind two conditions before it fires at all — document visibility and at least one
   * league's week actually being in progress — so this interval is never the only thing
   * standing between the page and a wasted request; see that component's docblock.
   */
  homeRefreshIntervalMs: 30_000,
} as const;
