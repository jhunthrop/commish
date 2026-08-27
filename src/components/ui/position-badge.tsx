import type { Position } from "@/domain/player";

export type PositionBadgeSize = "sm" | "md";

export interface PositionBadgeProps {
  readonly position: Position;
  readonly size?: PositionBadgeSize;
  readonly className?: string;
}

/**
 * The sticker chip. THE way a position is rendered anywhere in this product — the pool, a
 * roster slot, a board cell, the pick history — so that "QB is crimson" is learned once and
 * holds everywhere.
 *
 * The class strings are written out per position rather than composed from the position
 * string, because Tailwind only ships utilities it can see literally in the source; a
 * template-built `bg-pos-${role}` would generate no CSS at all.
 */
const FILL: Readonly<Record<Position, string>> = {
  QB: "bg-pos-qb text-pos-qb-on",
  RB: "bg-pos-rb text-pos-rb-on",
  WR: "bg-pos-wr text-pos-wr-on",
  TE: "bg-pos-te text-pos-te-on",
  K: "bg-pos-k text-pos-k-on",
  DEF: "bg-pos-def text-pos-def-on",
};

/** The on-fill label color alone, no fill — `FILL`'s second half, split out for a caller that
 *  sits INSIDE a `Sticker`'s own fill (which already paints the background) and only needs the
 *  text role. */
const ON_FILL_TEXT: Readonly<Record<Position, string>> = {
  QB: "text-pos-qb-on",
  RB: "text-pos-rb-on",
  WR: "text-pos-wr-on",
  TE: "text-pos-te-on",
  K: "text-pos-k-on",
  DEF: "text-pos-def-on",
};

const SIZE: Readonly<Record<PositionBadgeSize, string>> = {
  sm: "h-5 px-2 text-xs",
  md: "h-6 px-2 text-sm",
};

/**
 * The sticker fill + on-fill label color for a position, as Tailwind classes. The ONE
 * sanctioned way to color something that is not a `PositionBadge` — the draft board's cells
 * are sticker-sized, so they take the same pigment rather than nesting a badge inside a badge.
 * Nothing else may reach for `bg-pos-*` directly (docs/design-system.md).
 */
export function positionStickerClass(position: Position): string {
  return FILL[position];
}

/**
 * A secondary label sitting INSIDE a `Sticker`'s own fill — a caption that must stay legible
 * (≥3:1) without competing with the primary label beside it. `text-text-muted` (a page-ground
 * role) is the wrong tool here: it assumes a page surface behind it, and every position's
 * saturated fill measures well under 3:1 against it in both themes (operator review, finding D2 —
 * 1.07:1 dark, 1.15:1 light, measured on QB). `opacity-80` blends the on-fill role TOWARD the
 * fill it is already proven to clear ≥4.5:1 against (`PositionColor.stickerText`'s own docblock,
 * `@/design/tokens`), so the muted result stays inside that fill's own designed-contrast family
 * rather than introducing a second, unrelated color — proven ≥3:1 for all six positions, both
 * themes, by `held-trade-detail.test.tsx` (`contrastRatio`/`blendOver`, `@/design/test-support`).
 */
export function positionMutedOnFillTextClass(position: Position): string {
  return `${ON_FILL_TEXT[position]} opacity-80`;
}

export function PositionBadge({ position, size = "md", className = "" }: PositionBadgeProps) {
  return (
    <span
      className={
        "inline-flex shrink-0 items-center justify-center rounded-sm font-display font-semibold uppercase " +
        `leading-display tracking-wide ${FILL[position]} ${SIZE[size]} ${className}`
      }
    >
      {position}
    </span>
  );
}
