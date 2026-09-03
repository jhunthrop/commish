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
  /**
   * The quilt's compaction (law 4): the active round renders full cells; this many rounds
   * after it render full-height EMPTY tracks so the eye can see what is coming; everything
   * beyond, and every completed round, renders as micro color tiles. Zero scroll at 15 rounds.
   */
  fullRoundsAhead: 1,
  /** localStorage key prefix for the cheat sheet, suffixed with the draft id. */
  sheetStorageKeyPrefix: "commish.draft-sheet.",
  /** A sheet note's ceiling, in characters — prep is a margin scribble, not an essay, and the
   *  codec truncates anything longer on decode so a tampered or ancient store can never bloat
   *  the room. */
  sheetNoteMaxChars: 280,
} as const;
