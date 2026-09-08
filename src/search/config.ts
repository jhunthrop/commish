/**
 * The site search's tunables, spelled once. Pure and browser-safe: the overlay reads the debounce
 * and the result cap, the endpoint reads the query bounds and the rate ceiling, and the index
 * reads the fuzzy floor, all from this one object.
 */
export const SEARCH_CONFIG = {
  /** How many results one query answers with. Eight rows fit a phone screen above the keyboard. */
  maxResults: 8,
  /** Below this many characters a query answers nothing rather than the whole board. */
  minQueryLength: 1,
  /** A query longer than this is refused at the boundary: no name or team is that long. */
  maxQueryLength: 64,
  /**
   * A typo is forgiven only from this many characters: "gibs" for Gibbs is a typo, "gi" for anything
   * is a prefix, and forgiving one edit on a two-letter query would match half the board.
   */
  fuzzyMinLength: 4,
  /** How long the overlay waits after the last keystroke before asking the endpoint. */
  debounceMs: 120,
  /** One caller's ceiling on the endpoint inside one window, the same shape every other read
   *  route on this product holds (`createRateLimiter`). Typing a whole name at speed is a handful
   *  of debounced requests; a loop is hundreds. */
  rateLimit: { maxRequests: 120, windowMs: 60_000 },
  /** The placeholder and the empty line, spelled here so the overlay and its tests agree. */
  copy: {
    placeholder: "Search players and teams",
    noMatch: "No player or team matches that.",
    dialogTitle: "Search",
  },
} as const;
