/** Tunables shared by the UI primitives. No component may inline one of these values. */
export const UI_CONFIG = {
  shell: {
    /**
     * The viewport width, px, at and above which `TOKENS.font.sizeDense` replaces
     * `TOKENS.font.size` (`src/design/generate-css.ts`'s `@media (min-width: …)` block) — the
     * mocks' 13–14px desktop density is deliberate, a 13px body on a 360px phone is not.
     * Matches Tailwind's `lg` breakpoint, the same width the shell's rail grid switches on
     * (Task 2), so density and layout change together rather than at two different widths.
     */
    denseFromPx: 1024,
    /** `AppShell`'s `grid-cols-[var(--rail)_1fr]` column width, px, at `lg` and above — read
     *  into a `--rail` custom property (`AppShell`'s own inline style, the same "a dynamic
     *  value has to reach the DOM as a style, not a class" idiom `UI_CONFIG.infoTip.minTargetPx`
     *  already uses) rather than a Tailwind arbitrary value hardcoded at the call site. */
    railWidthPx: 64,
    /** `LeagueRail`'s crest tile, px — the mocks' own 40px tiles reading "BB", "TS", "GH". */
    crestSizePx: 40,
  },
  countdown: {
    /** How often `useCountdown` re-renders, ms. One second is the smallest unit `Countdown`
     *  displays. Phase 3.5, Task 8: moved from `DRAFT_ROOM_CONFIG.countdownTickMs` when the hook
     *  and its presentation centralized here at their third caller (`WaitingRoom`) — every
     *  countdown in the app now shares this one value rather than the draft room's own. */
    tickMs: 1_000,
    /** The tick interval `useCountdown` uses instead, once `usePrefersReducedMotion` reports
     *  true — a real BRANCH, the same idiom `UI_CONFIG.toast.reducedMotionDismissMs` already
     *  sets: the countdown stays correct, it simply refreshes less often, since a display-only
     *  clock (`useCountdown`'s own docblock) loses nothing by updating less frequently for
     *  someone who asked for less motion. */
    reducedMotionTickMs: 30_000,
    /**
     * Below this, `formatCoarseRemaining`'s screen-reader announcement reads "Under a minute
     * left" rather than a minute count.
     */
    coarseRemainingMinuteMs: 60_000,
    /**
     * At or above this, `formatCoarseRemaining` rounds to the nearest hour instead of the
     * nearest minute — deliberately coarser than `Countdown`'s ticking digits, so the
     * `aria-live` region built on it changes on a boundary crossing, not every second.
     */
    coarseRemainingHourMs: 3_600_000,
    /**
     * At or above this, `formatCoarseDuration` rounds to the nearest day instead of the nearest
     * hour — the bucket a schedule days out needs (`DraftSchedulePanel`'s own "in 7 days"), which
     * the hour bucket alone would render as an unreadable triple-digit hour count.
     */
    coarseRemainingDayMs: 86_400_000,
  },
  toast: {
    /** How long a toast stays up, in ms. */
    dismissMs: 5_000,
    /** Longer dwell for users who asked for reduced motion — they also want more reading time. */
    reducedMotionDismissMs: 10_000,
    /** Oldest toasts beyond this are dropped so the stack can never cover the page. */
    maxVisible: 3,
  },
  seatMeter: {
    /**
     * Below this many remaining seats (and above zero), `SeatMeter` appends its own "{n} seat(s)
     * left" clause to the seat sentence. At or above it, the raw count is not yet the thing a
     * reader needs to act on — the base "{filled} of {total} seated" sentence already answers
     * "how full", and a clause on every render would be noise, not signal.
     */
    lowSeatsThreshold: 3,
  },
  table: {
    /** `Table`'s `density="dense"` vertical cell padding, px — the mocks' own spec. `comfortable`
     *  keeps the table's original, more generous padding for a context that has not adopted the
     *  shell's density. */
    denseRowPaddingPx: 11,
  },
  infoTip: {
    /**
     * WCAG 2.2 SC 2.5.8 (Target Size, Minimum — Level AA): a pointer target must be at least
     * 24x24 CSS pixels on each axis, even when the visible glyph inside stays smaller. `InfoTip`
     * applies this as the trigger's `min-width`/`min-height`, not a Tailwind size class — a
     * dynamic `h-[${…}px]` string is invisible to Tailwind's static class scanner and would
     * silently ship no rule at all, so the number has to reach the DOM as an inline style.
     */
    minTargetPx: 24,
  },
} as const;

/**
 * The small-caps section-label treatment: a board header, a roster/queue heading, a sticky
 * column header. A class CONSTANT, not a component — the element varies (`span`/`h2`/`th`) and
 * the color is often conditional, so a caller composes this with its own color utility rather
 * than a component absorbing a `className` prop for the one thing it varies by.
 */
export const EYEBROW = "font-display text-xs font-semibold uppercase tracking-wide";
