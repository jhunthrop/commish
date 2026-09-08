import type { PlayerFactsMarketMovement } from "./types";

/**
 * WHERE THE MARKET HAS MOVED HIM (spec §4, fact 12; inventory row 12).
 *
 * The sheet carries today's ADP and no history, so a player the room has spent a month pushing up
 * eleven picks and a player nobody has reconsidered read identically.
 *
 * BOTH DATES ARE PRINTED, AND THAT IS THE WHOLE DISCIPLINE HERE. The spec asked for "ADP now versus
 * thirty days ago"; production's `adp_snapshots` archive holds three days (measured 2026-09-07,
 * inventory row 12), so a sentence claiming thirty days would be a false claim about a real number.
 * This compares the newest capture to the OLDEST capture it was handed and states both instants, so
 * the window is whatever the archive actually covers and the reader is told which.
 *
 * TWO CAPTURES ON THE SAME DAY ARE NOT A MOVEMENT. The rendered sentence dates both ends, and two
 * ends carrying the same date is not a story about time, so it is refused rather than printed as a
 * same-day swing.
 */

/** One archived capture, as `collect-depth.ts` reads it off `adp_snapshots`. */
export interface AdpCapture {
  readonly adp: number;
  readonly capturedAt: Date;
}

function day(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** One tenth of a pick: an ADP is published to a fraction and a movement is read the same way. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The newest capture against the oldest one the archive holds, or `null` when that is not a real
 *  comparison. */
export function marketMovementFor(history: readonly AdpCapture[]): PlayerFactsMarketMovement | null {
  if (history.length < 2) return null;
  const sorted = [...history].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
  const earlier = sorted[0]!;
  const latest = sorted[sorted.length - 1]!;
  const earlierAt = day(earlier.capturedAt);
  const latestAt = day(latest.capturedAt);
  if (earlierAt === latestAt) return null;

  return { latestAdp: latest.adp, latestAt, earlierAdp: earlier.adp, earlierAt, picks: round1(earlier.adp - latest.adp) };
}
