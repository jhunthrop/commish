export const REALTIME_CONFIG = {
  /** Redis Stream key for a league's event stream. */
  leagueStreamKey: (leagueId: string): string => `league:${leagueId}:events`,
  /**
   * Redis Stream key for ONE USER's own events. The second key format in this product, and the
   * reason it exists: every other event type is a league broadcast, and a notice about one
   * member ("your trade is on hold for review") must not be readable by their leaguemates. Same
   * mechanism, same XREAD, same Last-Event-ID resume, different key.
   */
  userStreamKey: (userId: string): string => `user:${userId}:events`,
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
   * that stops one member of one league from starving every league on the box.
   *
   * THE PER-TAB ARITHMETIC, which is what this number actually has to be derived from. It was 8
   * when a tab cost one connection: `league-stream.ts` exists specifically so a draft room, its
   * chat and its board share ONE league stream. Phase 3 Plan A mounted `NoticeInbox` inside
   * `TopBar`, which every signed-in page renders, and `useNotices` opens
   * `/api/notices/stream` on mount — correctly sharing this same ceiling (`sse.ts`), because a
   * per-user stream costs exactly what a league stream costs. So a league page now costs TWO
   * connections, and the old 8 silently became an effective four-tab budget, with the fifth tab
   * reading "You have too many live connections open."
   *
   * 10 restores a four-tab league budget (4 x 2 = 8) with two spare for a reconnect in flight,
   * which is the honest case this bound was always sized for: a room, a TV board, a spare tab,
   * and the old connection not yet reaped after a network blip. It is not a licence for a third
   * stream type — a plan that adds one moves this number and writes down why, or the cap goes
   * back to meaning nothing. `realtime.test.ts` pins the arithmetic so raising the per-tab cost
   * again cannot pass silently.
   */
  maxStreamsPerUser: 10,
  /**
   * How many live connections ONE signed-in tab on a league page opens: the league stream plus
   * the header's per-user notice stream. Named rather than left implicit so `maxStreamsPerUser`
   * above can be checked against it by a test instead of by memory.
   */
  streamsPerLeagueTab: 2,
  /**
   * How far back a client-supplied `Last-Event-ID` may resume (ms). Older cursors fall back to
   * live-only: replaying a long tail per connection is cheap amplification, and a client that
   * far behind refetches full state on reconnect anyway.
   */
  catchUpWindowMs: 60 * 60_000,
} as const;
