"use client";

import { DRAFT_ROOM_CONFIG } from "../state/config";
import { formatCountdown } from "../state/format";
import { useNow } from "../hooks/use-now";

/**
 * Ms remaining until `deadlineAt`, clamped to zero (a passed deadline never goes negative) —
 * null when there is no deadline. Ticks on `DRAFT_ROOM_CONFIG.countdownTickMs`, the one config
 * value every countdown in the room shares. `ClockBanner` and `AuctionLotPanel` both had their
 * own copy of this `useNow` + `Date.parse` arithmetic; this is the single place it lives now.
 */
export function useCountdown(deadlineAt: string | null): number | null {
  const now = useNow(DRAFT_ROOM_CONFIG.countdownTickMs);
  if (deadlineAt === null) return null;
  return Math.max(0, Date.parse(deadlineAt) - now);
}

export interface CountdownProps {
  readonly remainingMs: number;
  readonly "data-testid"?: string;
}

/**
 * The ticking digits, `aria-hidden`: a number changing every second inside a live region is
 * unusable with a screen reader. Callers pair this with a static sentence stating the same
 * time in words — that sentence differs by caller, so it stays where it is, not here.
 */
export function Countdown({ remainingMs, "data-testid": testId }: CountdownProps) {
  return (
    <span data-testid={testId} aria-hidden="true" className="ml-auto text-2xl font-semibold tabular-nums text-text-primary">
      {formatCountdown(remainingMs)}
    </span>
  );
}
