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
  /**
   * THE FAIL-FAST BOUNDS (draft-room performance round, item 4; `redis.ts`). A command is retried
   * this many times across reconnects and a non-blocking one is cut off after `commandTimeoutMs`
   * (queue time included), so a publish against a Redis that will not answer fails in seconds
   * rather than holding an advance until the sweep's attempt timeout. The connect timeout bounds
   * the socket itself. A subscriber's blocking read is exempt from the command timeout (its
   * `blockMs` is the wait) and keeps only the retry bound.
   */
  maxRetriesPerRequest: 2,
  connectTimeoutMs: 5_000,
  commandTimeoutMs: 3_000,
  /** THE RESYNC MARKER (review finding 3; `resync.ts`): the key a draft whose frame failed to
   *  publish is marked under, and how long the mark lives — one planned stream life, since a
   *  stream that opens later resyncs on its own open anyway. */
  resyncKey: (draftId: string): string => `realtime:resync:${draftId}`,
  resyncMarkerTtlMs: 280_000,
  /** SSE keepalive comment interval (ms) — keeps proxies from closing an idle stream. */
  keepaliveMs: 15_000,
  /**
   * THE PLANNED CLOSE (Neon cost audit 2026-09-07, finding 3). Every stream route declares
   * `maxDuration = 300`, and a stream left open to that cap is killed by the platform: an error
   * log line per connection every five minutes, and a reconnect the client did not plan. The
   * server now ends every stream itself this long after it opened — cleanly, with the body
   * closed — so the browser's own reconnect (after `retryHintMs`) is the ordinary path, and the
   * catch-up window below makes it lossless. Twenty seconds under the cap is the margin for a
   * slow last frame and the function's own teardown.
   */
  plannedCloseMs: 280_000,
  /** The `retry:` field sent in every stream's opening bytes: how long the browser waits before
   *  reconnecting after a planned close. Short, because the close is planned and lossless. */
  retryHintMs: 250,
  /**
   * Live SSE connections one user may hold open on a single instance. Each one pins a
   * dedicated Redis socket (XREAD BLOCK holds it) and an fd, so this is the blast-radius bound
   * that stops one member of one league from starving every league on the box.
   *
   * THE PER-TAB ARITHMETIC, which is what this number actually has to be derived from. A league
   * tab used to cost TWO connections: the league stream plus the header's per-user notice stream
   * (`NoticeInbox` in `TopBar`). Finding 3 of the Neon cost audit collapsed that to one: the
   * league stream now also carries the caller's own notice frames (`createLeagueEventStream`
   * reads both Redis keys), and the browser manager (`@/event-stream/league-stream`) attaches the
   * notice subscribers to the league connection whenever one is open. A hidden tab closes its
   * connection after `EVENT_STREAM_CONFIG.hiddenCloseMs`, so background tabs hold nothing.
   *
   * Six is four visible tabs (a room, a TV board, a spare tab, one more) at one connection each,
   * plus two for connections a network blip left behind that the server has not reaped yet. It
   * is not a licence for a second stream type per tab — a plan that adds one moves this number
   * and writes down why, or the cap goes back to meaning nothing. `sse.test.ts` pins the
   * arithmetic so raising the per-tab cost again cannot pass silently.
   */
  maxStreamsPerUser: 6,
  /**
   * How many live connections ONE signed-in tab on a league page opens. One: the league stream,
   * which carries the notice frames too. Named rather than left implicit so `maxStreamsPerUser`
   * above can be checked against it by a test instead of by memory.
   */
  streamsPerLeagueTab: 1,
  /**
   * How far back a client-supplied `Last-Event-ID` may resume (ms). Older cursors fall back to
   * live-only: replaying a long tail per connection is cheap amplification, and a client that
   * far behind refetches full state on reconnect anyway.
   */
  catchUpWindowMs: 60 * 60_000,
} as const;
