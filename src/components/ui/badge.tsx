import type { HTMLAttributes } from "react";

export type BadgeTone = "neutral" | "accent" | "positive" | "negative" | "warning";

/**
 * NEW-5 (Phase 3.6 gauntlet fix wave): `accent` used to be `bg-accent text-accent-text` — a
 * solid green fill, pixel-identical to `Button`'s primary variant. Every caller of this tone is a
 * LABEL (a house rung, a role, a live state, a count), never a control, and `positive`'s own row
 * below already proves the house rule for a Badge: "good outcome, as text/glow/meter fill only —
 * never a solid button fill" (`docs/design-system.md`). Green as a solid block is reserved for the one
 * thing on this product that is actually clickable; a badge that copies it reads as a second,
 * unclickable "Take a seat" button sitting right next to the real one. `glow` (below) still gives
 * a genuinely live/urgent badge its own tinted ring — the outcome-is-a-glow escape hatch stays.
 */
const TONE: Readonly<Record<BadgeTone, string>> = {
  neutral: "border border-line text-text-muted",
  accent: "text-accent border border-accent",
  positive: "text-positive border border-positive",
  negative: "text-negative border border-negative",
  warning: "text-warning border border-warning",
};

/** A tinted ring for a live/urgent state, built on `accentGlow`/`warningGlow` — an outcome is a
 *  glow rather than a solid block, which is the palette rule "money is a fill only when it is
 *  money or an action" (`docs/design-system.md`) applied to a chip. Only
 *  `accent` and `warning` carry a glow token; any other tone ignores the prop. */
const GLOW: Readonly<Partial<Record<BadgeTone, string>>> = {
  accent: "ring-2 ring-accent-glow",
  warning: "ring-2 ring-warning-glow",
  // The live family's glow (competition review D1, 2026-08-27): an alpha of the existing
  // negative token rather than a new role — the rail's own hot tint (bg-negative/10) already
  // set that precedent, and a glow color is a tint of its family, not a fifth pigment.
  negative: "ring-2 ring-negative/25",
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
      // `whitespace-nowrap` (LED-11): a pill is a single glanceable shape, never a paragraph —
      // `StatPill`'s two-word labels ("Not started") have no business breaking onto a second
      // line just because the column beside it is narrow. Without it, a table's automatic
      // column-width algorithm is free to leave a badge's own cell exactly one glyph too narrow,
      // wrapping the label — a break the gauntlet caught only in one theme's screenshot because
      // it sits on a pixel-width knife's edge, not because either theme is doing anything the
      // other isn't (`week-status-badge.test.tsx`'s regression: the class is unconditional).
      className={`inline-flex items-center whitespace-nowrap rounded-pill px-2 py-0.5 text-xs font-medium ${TONE[tone]} ${glow ? (GLOW[tone] ?? "") : ""} ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
}
