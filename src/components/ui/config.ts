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
