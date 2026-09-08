/** The team page's tunables, spelled once. Pure and browser-safe. */
export const TEAM_PAGE_CONFIG = {
  /** How many leaders each competition column names. Five is a receiving corps plus a back. */
  competitionLeaders: 5,
  /** How deep a depth chart group is shown. Four is a room's real depth; the release lists more. */
  depthChartSlots: 4,
  /** The offensive position groups a depth chart shows, in the order a room is read. */
  depthChartPositions: ["QB", "RB", "WR", "TE", "K"] as const,
  /** The route every team page lives under. */
  routeBase: "/app/teams",
} as const;
