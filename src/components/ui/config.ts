/** Tunables shared by the UI primitives. No component may inline one of these values. */
export const UI_CONFIG = {
  toast: {
    /** How long a toast stays up, in ms. */
    dismissMs: 5_000,
    /** Longer dwell for users who asked for reduced motion — they also want more reading time. */
    reducedMotionDismissMs: 10_000,
    /** Oldest toasts beyond this are dropped so the stack can never cover the page. */
    maxVisible: 3,
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
