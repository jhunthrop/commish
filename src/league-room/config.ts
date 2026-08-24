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
} as const;
