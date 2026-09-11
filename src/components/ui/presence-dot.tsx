"use client";

import { usePrefersReducedMotion } from "@/design/use-reduced-motion";

export interface PresenceDotProps {
  /** Announce the dot (a manager who is here, a game running now). Omit when the words beside
   *  it already say so, and the dot stays decorative. */
  readonly label?: string;
  readonly className?: string;
}

/**
 * THE LIVE GREEN DOT, breathing at 2s: presence, a game running, a room filling. The only
 * element in the product that moves without a cause, because its cause is continuous (something
 * is true right now), and it is the one exemption P4 names. Reduced motion leaves it still.
 */
export function PresenceDot({ label, className = "" }: PresenceDotProps) {
  const reduced = usePrefersReducedMotion();
  const a11y = label === undefined ? { "aria-hidden": true as const } : { role: "img", "aria-label": label };
  return <span {...a11y} data-testid="presence-dot" className={`inline-block size-2 shrink-0 rounded-full bg-live ${reduced ? "" : "animate-breathe"} ${className}`.trimEnd()} />;
}
