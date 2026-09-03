import { QUILT_CONFIG } from "./config";

/**
 * PICK SAFETY, the model half (the hook half is `../hooks/use-pending-pick`). A confirmed DRAFT
 * becomes a `PendingPick` — a local fact, never yet a network one — and only the window's expiry
 * turns it into a real `MAKE_PICK`. Money leagues never lose a team to a slipped finger, and an
 * undone pick was never anywhere but this browser (nothing is sent and then recalled).
 */
export interface PendingPick {
  readonly playerId: string;
  /** Epoch ms the window closes and the pick actually submits. */
  readonly commitsAt: number;
  /**
   * The player this window REPLACED, when a second DRAFT landed while one pended — last word
   * wins, and the pill says so ("swapped from …") for the remainder of the window so a swap is
   * never silent (whole-branch review, MEDIUM). Null for a first, unswapped pick.
   */
  readonly swappedFromPlayerId: string | null;
}

/**
 * How long the undo window for a pick started NOW may honestly be, against the turn's own
 * deadline. The full window normally; zero — submit immediately — when the deadline is closer
 * than the window plus the squeeze margin, because a safety pill that costs the turn protects
 * nobody. A null deadline (paused clock, pre-deadline turn) gets the full window.
 */
export function undoWindowMs(now: number, deadlineAt: string | null): number {
  if (deadlineAt === null) return QUILT_CONFIG.undoWindowMs;
  const remaining = Date.parse(deadlineAt) - now;
  if (Number.isNaN(remaining)) return QUILT_CONFIG.undoWindowMs;
  return remaining <= QUILT_CONFIG.undoWindowMs + QUILT_CONFIG.undoSqueezeMarginMs ? 0 : QUILT_CONFIG.undoWindowMs;
}

/** The pending pick a DRAFT press begins, or null when the squeeze rule says submit now. */
export function beginPendingPick(playerId: string, now: number, deadlineAt: string | null, swappedFromPlayerId: string | null = null): PendingPick | null {
  const windowMs = undoWindowMs(now, deadlineAt);
  return windowMs === 0 ? null : { playerId, commitsAt: now + windowMs, swappedFromPlayerId };
}
