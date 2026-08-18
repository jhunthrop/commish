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
} as const;

/**
 * The small-caps section-label treatment: a board header, a roster/queue heading, a sticky
 * column header. A class CONSTANT, not a component — the element varies (`span`/`h2`/`th`) and
 * the color is often conditional, so a caller composes this with its own color utility rather
 * than a component absorbing a `className` prop for the one thing it varies by.
 */
export const EYEBROW = "font-display text-xs font-semibold uppercase tracking-wide";
