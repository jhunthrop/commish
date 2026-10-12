/**
 * THE SEASON CALENDAR the research core and the league app share, named once (the prep site
 * carve-out, 2026-10-12). `LEAGUE_CONFIG` (`@/league/config`) reads both fields from here, so the
 * league app and the research core can never disagree about which season "this season" is or which
 * weeks a fantasy regular season spans.
 */
export const SEASON_CONFIG = {
  /**
   * THE ONE PLACE "this season" means a specific instant. `PRODUCT_SEASON`
   * (`@/projections/preseason/current`) is its calendar year, and nothing may re-derive "this
   * season" from `now()`, a league's own age, or an NFL calendar rule. The founder verified
   * 2026-08-01 as the boundary (2026-08-24); it rolls forward only when season rollover ships.
   */
  startedAt: "2026-08-01T00:00:00.000Z",
  /** A fantasy regular season's length in NFL weeks: the window a bye week is read inside. */
  fantasyRegularSeasonWeeks: 14,
} as const;
