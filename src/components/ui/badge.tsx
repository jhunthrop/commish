import type { HTMLAttributes } from "react";

export type BadgeTone = "neutral" | "accent" | "positive" | "negative" | "warning";

const TONE: Readonly<Record<BadgeTone, string>> = {
  neutral: "border border-line text-text-muted",
  accent: "bg-accent text-accent-text",
  positive: "text-positive border border-positive",
  negative: "text-negative border border-negative",
  warning: "text-warning border border-warning",
};

/** A tinted ring for a live/urgent state, built on `accentGlow`/`warningGlow` — the "an outcome
 *  is a glow, never a solid block" rule (`docs/design-system.md`) applied to a chip. Only
 *  `accent` and `warning` carry a glow token; any other tone ignores the prop. */
const GLOW: Readonly<Partial<Record<BadgeTone, string>>> = {
  accent: "ring-2 ring-accent-glow",
  warning: "ring-2 ring-warning-glow",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: BadgeTone;
  /** The live pill's tinted ring — a real state, not decoration: a caller sets this only when
   *  the thing the badge names is actually live right now. */
  readonly glow?: boolean;
}

export function Badge({ tone = "neutral", glow = false, className = "", children, ...rest }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-pill px-2 py-0.5 text-xs font-medium ${TONE[tone]} ${glow ? (GLOW[tone] ?? "") : ""} ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
}
