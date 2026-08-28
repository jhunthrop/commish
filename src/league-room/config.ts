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
  /**
   * How often `TradeCard`'s own `useNow` tick recomputes its expiry line, ms. Day-granularity
   * display (`daysUntil`/`formatExpiry`, `./lib/format.ts`) has no need for `DRAFT_ROOM_CONFIG
   * .countdownTickMs`'s second-by-second cadence — this is deliberately coarse, cheap enough for
   * every open card in an inbox to run its own tick without it mattering.
   */
  expiryTickMs: 300_000,
  /**
   * LED-1 (founder-delegated design ruling, 2026-08-24): how many chips `AttentionQueue`
   * (`./components/attention-queue.tsx`) renders before it folds the rest into one sentence.
   * The gauntlet found thirty-three chips, five rows deep, above a board that already sorts
   * needs-you first — the queue is meant to be the glance, not a second board. Three is the
   * veteran persona's own bar: a scan that finishes in under a second.
   */
  attentionQueueCap: 3,
  /**
   * R5 (the mock lobby design review's ruling): how often `MockLobby` (`./components/mock-
   * lobby.tsx`) re-fetches `GET /api/mock-drafts` in the background, ms. A lobby's whole
   * question is "is anyone here right now" — bounded, no gating condition (unlike
   * `homeRefreshIntervalMs` above, this list is cheap and always worth a glance while the page
   * is open), and no socket: ruling 10 (no anonymous or pre-seat SSE for a mock room) stays
   * intact, this is a plain client-side interval re-fetch through the same `fetchJson` path the
   * page already reads with on first paint. Matches `homeRefreshIntervalMs`'s own 30s by
   * coincidence of taste, not by a shared reference — the two surfaces are free to retune
   * independently.
   */
  mockLobbyPollIntervalMs: 30_000,
  /**
   * E7 (the same review): how many of the caller's own mock rooms `MockLobby` shows before
   * folding the rest behind a quiet "Show all N" disclosure. Eight is a Sunday-glance number —
   * enough to show a full week of daily mocks without the wall of rows the review's D2/E7
   * findings flagged (`MOCK_CONFIG.maxLobbyListing`'s own 20-row cap is what the LIST can hold;
   * this is what the FOLD shows before asking).
   */
  mockHistoryVisibleCount: 8,
} as const;
