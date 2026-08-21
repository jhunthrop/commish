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
 * Whole days remaining until `iso`, never negative. Floored, not rounded: "how many FULL days
 * are left" is the honest question an expiry line answers, and rounding up would claim a day
 * that has not actually started yet. `now` is a parameter, not `new Date()` read inside, so a
 * test can pin it (fix round 1, F2 — the proposer's own card and the post-propose confirmation
 * both need this, and a real clock cannot be asserted against).
 */
export function daysUntil(iso: string, now: Date): number {
  const remainingMs = new Date(iso).getTime() - now.getTime();
  return Math.max(0, Math.floor(remainingMs / MS_PER_DAY));
}

/** "Expires today."/"Expires tomorrow."/"Expires in N days." — the one place a day count
 *  becomes a sentence, so every surface that shows an offer's expiry (`TradeCard`,
 *  `TradeComposer`'s post-send confirmation) says it identically. */
export function formatExpiry(days: number): string {
  if (days <= 0) return "Expires today.";
  if (days === 1) return "Expires tomorrow.";
  return `Expires in ${days} days.`;
}
