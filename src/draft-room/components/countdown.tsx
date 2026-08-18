"use client";

import { DRAFT_ROOM_CONFIG } from "../state/config";
import { formatCoarseRemaining, formatCountdown } from "../state/format";
import { useNow } from "../hooks/use-now";

export interface CountdownState {
  /** Ms remaining until `deadlineAt`, clamped to zero; null when there is no deadline. */
  readonly remainingMs: number | null;
  /** The wall-clock reading `remainingMs` was computed from — so a caller that also needs
   *  "now" (`RoomRail`'s tightening line) derives it from this one ticking interval
   *  instead of running a second `useNow` alongside it. */
  readonly now: number;
}

/**
 * Ms remaining until `deadlineAt`, clamped to zero (a passed deadline never goes negative) —
 * null when there is no deadline — plus the `now` it was computed from. Ticks on
 * `DRAFT_ROOM_CONFIG.countdownTickMs`, the one config value every countdown in the room
 * shares. Three surfaces once had their own copy of this `useNow` + `Date.parse` arithmetic;
 * this is the single place it lives now, and `RoomRail` is its single caller.
 */
export function useCountdown(deadlineAt: string | null): CountdownState {
  const now = useNow(DRAFT_ROOM_CONFIG.countdownTickMs);
  return { remainingMs: deadlineAt === null ? null : Math.max(0, Date.parse(deadlineAt) - now), now };
}

export type CountdownSize = "md" | "lg";
/** `hot` is the rail's my-turn morph: the same digits, in the negative family. */
export type CountdownTone = "default" | "hot";

export interface CountdownProps {
  readonly remainingMs: number;
  /** `lg` is the rail's headline clock; `md` is an inline one. */
  readonly size?: CountdownSize;
  readonly tone?: CountdownTone;
  readonly "data-testid"?: string;
}

const SIZE: Readonly<Record<CountdownSize, string>> = {
  md: "text-2xl",
  lg: "text-3xl",
};

const TONE: Readonly<Record<CountdownTone, string>> = {
  default: "text-text-primary",
  hot: "text-negative",
};

/**
 * The ticking digits, `aria-hidden`, paired with a plain-language `aria-live="polite"` sibling
 * (visually `sr-only`) that states the same time coarsely — "About 8 hours left", "Under a
 * minute left" — via `formatCoarseRemaining`. It deliberately lives OUTSIDE the `aria-hidden`
 * span: an `aria-hidden` ancestor hides everything beneath it from assistive tech regardless
 * of `sr-only`, so the live region has to be a sibling, not a child, to ever be announced.
 * Rounding to the minute/hour (not the second) is what keeps it announcing rarely instead of
 * every tick. Callers additionally pair this with a static sentence stating the same time in
 * words — that sentence differs by caller, so it stays where it is, not here.
 */
export function Countdown({ remainingMs, size = "md", tone = "default", "data-testid": testId }: CountdownProps) {
  return (
    <>
      <span data-testid={testId} aria-hidden="true" className={`font-mono font-semibold tabular-nums ${TONE[tone]} ${SIZE[size]}`}>
        {formatCountdown(remainingMs)}
      </span>
      <span className="sr-only" aria-live="polite">
        {formatCoarseRemaining(remainingMs)}
      </span>
    </>
  );
}
