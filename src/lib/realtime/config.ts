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
} as const;
