"use client";

import { usePrefersReducedMotion } from "@/design/use-reduced-motion";

export interface CelebrationProps {
  readonly title: string;
  readonly detail?: string;
  /** "self" is the user's own moment and gets the louder treatment. */
  readonly emphasis: "self" | "peer";
  readonly testId?: string;
}

/**
 * A moment that matters, said once. `role="status"` so it is announced politely rather than
 * interrupting, and reduced motion is a real BRANCH — the panel still appears, it simply
 * carries no animation class, because losing the information would be worse than the motion.
 *
 * Timing is the caller's: `useTransientVisibility` decides how long it lives and what key it
 * is about, so this component stays a pure presentation of "this happened".
 */
export function Celebration({ title, detail, emphasis, testId }: CelebrationProps) {
  const reduced = usePrefersReducedMotion();
  const motion = reduced ? "" : emphasis === "self" ? "animate-celebrate-self" : "animate-celebrate-peer";
  const tone = emphasis === "self" ? "border-accent bg-accent/10" : "border-border bg-surface-elevated";

  return (
    <div role="status" data-testid={testId} data-emphasis={emphasis} className={`rounded-lg border p-3 text-center ${tone} ${motion}`}>
      <p className="text-lg font-semibold text-text-primary">{title}</p>
      {detail === undefined ? null : <p className="text-sm text-text-muted">{detail}</p>}
    </div>
  );
}
