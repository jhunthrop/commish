"use client";

import { usePrefersReducedMotion } from "@/design/use-reduced-motion";
import { HOURS_PER_DAY, MINUTES_PER_HOUR, MS_PER_SECOND, SECONDS_PER_HOUR, SECONDS_PER_MINUTE, plural } from "@/domain/duration";
import { UI_CONFIG } from "./config";
import { useNow } from "./use-now";

const MS_PER_MINUTE = MS_PER_SECOND * SECONDS_PER_MINUTE;
const MS_PER_HOUR = MS_PER_MINUTE * MINUTES_PER_HOUR;
const MS_PER_DAY = MS_PER_HOUR * HOURS_PER_DAY;

export interface CountdownState {
  /** Ms remaining until `deadlineAt`, clamped to zero; null when there is no deadline — and
   *  null on the server render and the client's first (hydrating) render, before `useNow` has
   *  snapped (its own docblock owns the hydration argument). One null, two meanings, one
   *  consumer branch: "nothing to tick against yet" renders the non-ticking fallback either
   *  way. */
  readonly remainingMs: number | null;
  /** The wall-clock reading `remainingMs` was computed from — so a caller that also needs
   *  "now" (`RoomRail`'s tightening line) derives it from this one ticking interval
   *  instead of running a second `useNow` alongside it. Null until the client clock snaps,
   *  exactly as `useNow` is. */
  readonly now: number | null;
}

/**
 * Ms remaining until `deadlineAt`, clamped to zero (a passed deadline never goes negative) —
 * null when there is no deadline — plus the `now` it was computed from.
 *
 * Extracted here at its THIRD caller (Phase 3.5, Task 8): `RoomRail` (`@/draft-room/components/
 * room-rail`) used to own this as a private hook ticking on its own `DRAFT_ROOM_CONFIG`;
 * `DraftSchedulePanel` (`@/league-room/components/draft-schedule-panel`) formatted its own
 * remaining time a second way, from its own `useNow`; `WaitingRoom` is the third, and three is
 * where "centralize the first time" (the founder rule) stops being a preference. Both existing
 * consumers were refactored onto this in the same commit.
 *
 * Ticks on `UI_CONFIG.countdown.tickMs` — `usePrefersReducedMotion` slows that to
 * `reducedMotionTickMs` instead, a real branch rather than a cosmetic one: the countdown stays
 * correct (it is display-only — see below), it simply refreshes less often for someone who asked
 * for less motion, the same way `UI_CONFIG.toast.reducedMotionDismissMs` gives a reduced-motion
 * reader more time rather than dropping content.
 *
 * Display only: a countdown never decides anything — the server ticker owns clock expiry, and no
 * client write path reads `remainingMs` to decide whether a deadline has passed.
 */
export function useCountdown(deadlineAt: string | null): CountdownState {
  const reducedMotion = usePrefersReducedMotion();
  const tickMs = reducedMotion ? UI_CONFIG.countdown.reducedMotionTickMs : UI_CONFIG.countdown.tickMs;
  const now = useNow(tickMs);
  return { remainingMs: deadlineAt === null || now === null ? null : Math.max(0, Date.parse(deadlineAt) - now), now };
}

export interface CountdownLabelProps {
  readonly deadlineAt: string | null;
  readonly className?: string;
  /** What the label shows before the client clock snaps, and with no deadline at all. */
  readonly placeholder?: string;
  readonly "data-testid"?: string;
}

/**
 * THE CLOCK TICKS ALONE (draft-room fluidity round, 2026-09-10). The one-second tick used to
 * live in the draft room's root and travel down as a `clockLabel` prop, so every tick
 * re-rendered the whole room — measured at 65 commits in 28 s of drafting, up to 14,000
 * components each. This leaf owns its own `useCountdown`, so a tick re-renders exactly this
 * span; a parent hands it the deadline, which changes once per turn, and never a ticking label.
 * Two leaves on one screen mean two cheap intervals, which is the trade this round makes on
 * purpose: the alternative (one shared tick threaded through props) is the bug.
 */
export function CountdownLabel({ deadlineAt, className, placeholder = "…", "data-testid": testId }: CountdownLabelProps) {
  const { remainingMs } = useCountdown(deadlineAt);
  return (
    <span data-testid={testId} className={className}>
      {remainingMs === null ? placeholder : formatCountdown(remainingMs)}
    </span>
  );
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

/** "0:09", "2:05", "1:04:09". Clamped at zero — a passed deadline reads 0:00, never negative. */
export function formatCountdown(msRemaining: number): string {
  const total = Math.max(0, Math.ceil(msRemaining / MS_PER_SECOND));
  const hours = Math.floor(total / SECONDS_PER_HOUR);
  const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = total % SECONDS_PER_MINUTE;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** "5 minutes", "2 hours", "under a minute" — the building block `formatCoarseRemaining` below
 *  wraps into a full sentence, and the same one a caller with its own sentence to build (e.g.
 *  `WaitingRoom`'s "Starts in …") reuses directly rather than a second minute/hour formatter. */
export function formatCoarseDuration(msRemaining: number): string {
  const remaining = Math.max(0, msRemaining);
  if (remaining < UI_CONFIG.countdown.coarseRemainingMinuteMs) return "under a minute";
  if (remaining < UI_CONFIG.countdown.coarseRemainingHourMs) return plural(Math.round(remaining / MS_PER_MINUTE), "minute");
  if (remaining < UI_CONFIG.countdown.coarseRemainingDayMs) return plural(Math.round(remaining / MS_PER_HOUR), "hour");
  return plural(Math.round(remaining / MS_PER_DAY), "day");
}

/**
 * A coarse, rarely-changing summary of time remaining — "About 8 hours left", "About 2 minutes
 * left", "Under a minute left" — for a screen-reader `aria-live` region paired with `Countdown`'s
 * (`aria-hidden`) ticking digits. Rounds to the nearest whole minute or hour (via
 * `formatCoarseDuration`), so it updates on a boundary crossing rather than every second.
 */
export function formatCoarseRemaining(msRemaining: number): string {
  const remaining = Math.max(0, msRemaining);
  if (remaining < UI_CONFIG.countdown.coarseRemainingMinuteMs) return "Under a minute left";
  return `About ${formatCoarseDuration(msRemaining)} left`;
}

export type CountdownSize = "sm" | "md" | "lg" | "xl";
/** `hot` is the rail's my-turn morph: the same digits, in the negative family. */
export type CountdownTone = "default" | "hot";

export interface CountdownProps {
  /** Null renders the pre-snap placeholder — a caller holding `useCountdown`'s pre-hydration
   *  null passes it straight through rather than inventing a false `0` ("0:00" is a claim
   *  about time; a placeholder is not). */
  readonly remainingMs: number | null;
  /** `lg` is the rail's headline clock; `md` is an inline one; `sm` is a ledger-row clock at
   *  body size; `xl` is the waiting room's hero clock. */
  readonly size?: CountdownSize;
  readonly tone?: CountdownTone;
  readonly "data-testid"?: string;
}

const SIZE: Readonly<Record<CountdownSize, string>> = {
  /** The open-league card's ledger-row clock (Phase 3.7, Task 5): digits at the row's own text
   *  size, distinguished by mono, weight and tone rather than scale. */
  sm: "text-sm",
  md: "text-2xl",
  lg: "text-3xl",
  xl: "text-display-xl",
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
      {/* SIDELINE WAVE TWO (2026-09-11): the digits move from the mono face to the DISPLAY face
          with tabular figures. Sideline spends two faces and neither of them is a monospace; what
          the mono face was really buying here was non-jittering digits, and `tabular-nums` on
          Bricolage buys the identical thing while a ticking clock finally looks like every other
          number the product prints large. */}
      <span data-testid={testId} aria-hidden="true" className={`font-display font-bold tabular-nums ${TONE[tone]} ${SIZE[size]}`}>
        {/* Pre-snap (`remainingMs` null, one hydration frame): a non-breaking space holds the
            line box at the digits' own em height — no layout jump, and never "0:00", which
            would be a false time rather than a placeholder. */}
        {remainingMs === null ? "\u00A0" : formatCountdown(remainingMs)}
      </span>
      <span className="sr-only" aria-live="polite">
        {/* The live region exists from the first render (assistive tech tracks regions that
            were present at load far more reliably than ones inserted later); it simply has
            nothing to say until the clock snaps. */}
        {remainingMs === null ? null : formatCoarseRemaining(remainingMs)}
      </span>
    </>
  );
}
