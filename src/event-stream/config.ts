/**
 * The browser-side stream manager's own knobs (`./league-stream`), named here rather than left
 * as literals in the manager — the same rule every server config module follows.
 */
export const EVENT_STREAM_CONFIG = {
  /** The header's per-user notice stream (`GET /api/notices/stream`). */
  noticesStreamUrl: "/api/notices/stream",
  /**
   * A league stream url. The server's `createLeagueEventStream` reads the caller's own user key
   * on the same socket (Neon cost audit finding 3), so while one of these is open the notice
   * subscribers ride it instead of holding a second connection.
   */
  isCarrierUrl: (url: string): boolean => /^\/api\/leagues\/[^/]+\/events$/.test(url),
  /**
   * How long a tab may stay hidden before its stream closes. Most of a stream function's alive
   * time is background tabs nobody is looking at; a minute is long enough that a quick
   * tab-switch costs nothing, and the reopen on return resumes from `Last-Event-ID` inside the
   * server's catch-up window, so nothing is lost either way.
   */
  hiddenCloseMs: 60_000,
} as const;
