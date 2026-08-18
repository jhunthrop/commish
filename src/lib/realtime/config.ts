export const REALTIME_CONFIG = {
  /** Redis Stream key for a league's event stream. */
  leagueStreamKey: (leagueId: string): string => `league:${leagueId}:events`,
  /**
   * Approximate max entries retained per stream (XADD MAXLEN ~). Streams are a live/catch-up
   * channel, not the permanent record — Postgres is. Sized generously for a full live draft
   * plus a Sunday of scoring updates so a client backgrounded for a while can still catch up.
   */
  streamMaxLen: 10_000,
  /** How long a single XREAD BLOCK call waits before looping (ms). Bounds shutdown latency. */
  blockMs: 5_000,
  /** SSE keepalive comment interval (ms) — keeps proxies from closing an idle stream. */
  keepaliveMs: 15_000,
  /**
   * Live SSE connections one user may hold open on a single instance. Each one pins a
   * dedicated Redis socket (XREAD BLOCK holds it) and an fd, so this is the blast-radius bound
   * that stops one member of one league from starving every league on the box. Generous enough
   * for the honest case — a room, a TV board and a spare tab, times a reconnect in flight.
   */
  maxStreamsPerUser: 8,
  /**
   * How far back a client-supplied `Last-Event-ID` may resume (ms). Older cursors fall back to
   * live-only: replaying a long tail per connection is cheap amplification, and a client that
   * far behind refetches full state on reconnect anyway.
   */
  catchUpWindowMs: 60 * 60_000,
} as const;
