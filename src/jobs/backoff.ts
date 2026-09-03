import type { BackoffPolicy } from "./contract";

/**
 * Exponential backoff with half-jitter: attempt N's delay is `min(maxMs, baseMs * 2^(N-1))`,
 * jittered uniformly into [50%, 100%] of that. Half-jitter rather than full because a full-jitter
 * draw near zero would let an immediately-failing job spin its whole attempt budget in seconds —
 * the floor keeps every retry a real wait, while the jitter still spreads a herd of same-instant
 * failures apart. `random` is injected (a `() => number` in [0, 1)), never `Math.random` read
 * ambiently, so tests pin exact delays.
 */
export function backoffDelayMs(policy: BackoffPolicy, attempt: number, random: () => number): number {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error(`backoffDelayMs: attempt must be >= 1, got ${attempt}.`);
  const exponential = Math.min(policy.maxMs, policy.baseMs * 2 ** (attempt - 1));
  return Math.round(exponential * (0.5 + random() * 0.5));
}
