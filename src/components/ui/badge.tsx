import type { HTMLAttributes } from "react";
import { PresenceDot } from "./presence-dot";

/**
 * SIDELINE'S CHIP TONES. `neutral` is chalk with muted ink (the mock's `.chip`), `live` is live
 * ink on a live wash (the mock's `.chip.live`), `self` is amber ink on the amber wash (yours),
 * `negative` is your rival's rose, `positive` a good outcome, `accent` a link chip in Court blue
 * on chalk (blue ink never rides the blue wash: 4.44:1). `warning` survives as a name for the
 * thirteen call sites that spell it and IS the rose.
 */
export type BadgeTone = "neutral" | "accent" | "positive" | "negative" | "warning" | "live" | "self";

const TONE: Readonly<Record<BadgeTone, string>> = {
  neutral: "bg-surface text-text-muted",
  accent: "bg-surface text-accent",
  positive: "bg-positive/10 text-positive",
  negative: "bg-negative/10 text-negative",
  warning: "bg-negative/10 text-negative",
  live: "bg-live/10 text-live",
  self: "bg-self-glow text-self-ink",
};

/**
 * A chip that is live RIGHT NOW wears the breathing dot (`glow` on the `live` tone). On the
 * other tones `glow` is a tinted ring, a real state and never decoration: a caller sets it only
 * when the thing the chip names is actually happening.
 */
const GLOW: Readonly<Partial<Record<BadgeTone, string>>> = {
  accent: "ring-2 ring-accent-glow",
  warning: "ring-2 ring-warning-glow",
  negative: "ring-2 ring-warning-glow",
  self: "ring-2 ring-self-glow",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: BadgeTone;
  /** The thing this chip names is happening now: the live dot on `live`, a tinted ring elsewhere. */
  readonly glow?: boolean;
  /**
   * Accepted and ignored: every Sideline chip is the soft wash, so the v6 opt-in is the default.
   * Kept on the type so the call sites that spell it (the draft room's odds glance among them)
   * compile unchanged this round; it retires with the next sweep of that tree.
   */
  readonly soft?: boolean;
}

/**
 * THE CHIP: a pill of 11px semibold body text on a soft wash of its tone. `whitespace-nowrap`
 * because a pill is a single glanceable shape, never a paragraph.
 */
export function Badge({ tone = "neutral", glow = false, soft: _soft, className = "", children, ...rest }: BadgeProps) {
  void _soft;
  const glowClass = glow && tone !== "live" ? (GLOW[tone] ?? "") : "";
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill px-2 py-0.5 text-xs font-semibold ${TONE[tone]} ${glowClass} ${className}`.replace(/\s+/g, " ").trimEnd()}
      {...rest}
    >
      {glow && tone === "live" ? <PresenceDot /> : null}
      {children}
    </span>
  );
}
