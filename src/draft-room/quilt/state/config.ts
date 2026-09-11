/**
 * The Quilt's own tunables — one object, no magic numbers at call sites, the same shape
 * `DRAFT_ROOM_CONFIG` (`../../state/config`) keeps for the room's older surfaces.
 */
export const QUILT_CONFIG = {
  /**
   * PICK SAFETY (the mocks' Beat 3): how long a confirmed DRAFT sits in the local undo window
   * before it is actually submitted. The pick reaches the server — and therefore the room —
   * only when this expires, so an undone pick was never anywhere but this browser.
   */
  undoWindowMs: 3_000,
  /**
   * The squeeze rule: when the turn's own deadline is closer than the undo window plus this
   * margin, the pick submits immediately — losing a turn to safety theater is worse than
   * skipping the pill. The margin covers the request's own flight time.
   */
  undoSqueezeMarginMs: 1_500,
  /** The collapsed drawer's BEST AVAILABLE chip row: how many undrafted players it shows. */
  bestAvailableCount: 4,
  /** How many of the queue's top players the amber your-turn strip inlines. */
  clockQueueCount: 3,
  /** How many sheet players "Send top of sheet to queue" seeds. */
  sheetQueueSeedCount: 5,
  /** The half drawer's own height as a fraction of the room, and the full drawer's. */
  drawerHeight: { half: "45dvh", full: "100dvh" },
  /** Where the room stops inverting: Tailwind's `lg` (64rem), the one breakpoint the desktop
   *  and phone compositions split on. Only the matching composition mounts (fluidity round,
   *  2026-09-10); before it, both trees rendered and the hidden one did all the same work. */
  desktopStageQuery: "(min-width: 64rem)",
  /** The grabber's drag threshold: a pointer that travels less than this is a tap (space's own
   *  toggle), anything longer is one honest step up or down the heights. */
  drawerDragThresholdPx: 12,
  /**
   * The quilt's compaction (law 4): the active round renders full cells; this many rounds
   * after it render full-height EMPTY tracks so the eye can see what is coming; everything
   * beyond, and every round older than the window below, renders as micro color tiles. Zero
   * scroll at 15 rounds.
   */
  fullRoundsAhead: 1,
  /**
   * The window behind (founder ruling 2026-09-03): this many rounds BEFORE the active one
   * stay full too — the story so far, readable, not just the present tense. Clamped at the
   * draft's start (round 1 shows one full row, round 2 two). The shorter card constants in
   * `heights.ts` are what make four full rows fit where one did.
   */
  fullRoundsBehind: 3,
  /** localStorage key prefix for the cheat sheet, suffixed with the draft id. */
  sheetStorageKeyPrefix: "commish.draft-sheet.",
  /** Where the browser remembers the stream's width (open, rail, hidden). */
  streamWidthStorageKey: "commish.draft-stream-width",
  /**
   * YOUR SHEET (founder ruling 1, 2026-09-10): seven columns of up to `columnSize`, rows at the
   * research density (`TOKENS.density.denseRowPx`), tier bands at `bandPx`, and a windowed list
   * per column that renders `overscanRows` beyond the visible band so a scroll never shows a gap.
   */
  sheet: { columnSize: 50, rowPx: 44, bandPx: 28, overscanRows: 6 },
  /** The stream's two desktop widths, px (ruling 2): the rail and the open column. */
  stream: { railPx: 64, openPx: 320, presenceFaceCap: 4 },
  /** The consistency strip's own bar: a week at or over this many fantasy points counts as a
   *  hit and wears the position's color; under it stays quiet. One constant, stated beside the
   *  caption that quotes it. */
  weeklyGoodPoints: 12,
  /** A sheet note's ceiling, in characters — prep is a margin scribble, not an essay, and the
   *  codec truncates anything longer on decode so a tampered or ancient store can never bloat
   *  the room. */
  sheetNoteMaxChars: 280,
} as const;
