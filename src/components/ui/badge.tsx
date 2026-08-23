import type { HTMLAttributes } from "react";

export type BadgeTone = "neutral" | "accent" | "positive" | "negative" | "warning";

const TONE: Readonly<Record<BadgeTone, string>> = {
  neutral: "border border-line text-text-muted",
  accent: "bg-accent text-accent-text",
  positive: "text-positive border border-positive",
  negative: "text-negative border border-negative",
  warning: "text-warning border border-warning",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: BadgeTone;
}

export function Badge({ tone = "neutral", className = "", children, ...rest }: BadgeProps) {
  return (
    <span className={`inline-flex items-center rounded-pill px-2 py-0.5 text-xs font-medium ${TONE[tone]} ${className}`} {...rest}>
      {children}
    </span>
  );
}
