/** Display only. Every number here was already computed and rounded on the server. */
export function formatRecord({ wins, losses, ties }: { readonly wins: number; readonly losses: number; readonly ties: number }): string {
  return ties === 0 ? `${wins}-${losses}` : `${wins}-${losses}-${ties}`;
}

export function formatPoints(points: number): string {
  return points.toFixed(2);
}

export function formatWeek(weekNumber: number): string {
  return `Week ${weekNumber}`;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole days remaining until `iso`, NEGATIVE once it has passed. Floored, not rounded: "how many
 * FULL days are left" is the honest question an expiry line answers, and rounding up would claim
 * a day that has not actually started yet. `now` is a parameter, not `new Date()` read inside, so
 * a test can pin it (fix round 1, F2 — the proposer's own card and the post-propose confirmation
 * both need this, and a real clock cannot be asserted against).
 *
 * The `Math.max(0, …)` clamp this used to carry is gone (final review, HIGH 3): it turned an
 * offer that died three days ago into `0`, which `formatExpiry` then rendered as "Expires today."
 * — actively false copy, not merely stale. A count that can go negative is what lets both
 * functions below tell the truth.
 */
export function daysUntil(iso: string, now: Date): number {
  const remainingMs = new Date(iso).getTime() - now.getTime();
  return Math.floor(remainingMs / MS_PER_DAY);
}

/** "Expires today."/"Expires tomorrow."/"Expires in N days." — the one place a day count
 *  becomes a sentence, so every surface that shows a LIVE offer's expiry (`TradeCard`,
 *  `TradeComposer`'s post-send confirmation) says it identically. A past-due count reads as
 *  expired rather than as today: callers that hold the date use `formatExpired` for the fuller
 *  sentence, and this stays honest for the ones that do not. */
export function formatExpiry(days: number): string {
  if (days < 0) return "Expired.";
  if (days === 0) return "Expires today.";
  if (days === 1) return "Expires tomorrow.";
  return `Expires in ${days} days.`;
}

/** The month and day an offer ran out on — "August 18", never a locale-dependent numeric date a
 *  reader has to decode. */
const EXPIRED_DATE_FORMAT = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

/** What a dead offer's own line says: "Expired August 18." — the state AND the day it happened,
 *  which is the difference between a card a manager can reason about and one that lies to them
 *  (final review, HIGH 3). */
export function formatExpired(iso: string): string {
  return `Expired ${EXPIRED_DATE_FORMAT.format(new Date(iso))}.`;
}
