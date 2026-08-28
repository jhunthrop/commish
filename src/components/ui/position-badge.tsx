import type { Position } from "@/domain/player";

export type PositionBadgeSize = "sm" | "md";

export interface PositionBadgeProps {
  readonly position: Position;
  /**
   * Where this player ranks AMONG HIS OWN POSITION on whatever board is rendering him — the "4"
   * in "RB4". Optional, and every existing caller omits it, because most surfaces have no ranked
   * board behind them and an invented rank is worse than an absent one for the reason
   * `PlayerFace` refuses an invented jersey number: a manager reads it as a fact.
   *
   * TWO FACTS IN ONE STICKER, which is the whole point. "RB" and "RB4" cost the same pixels and
   * the same eye stop, and the second one answers the question a manager scanning a board is
   * actually asking. The sticker was already the position's one address in this product, so the
   * rank rides it rather than earning a column of its own.
   *
   * Non-positive or non-integer ranks render as a plain position rather than "RB0" or "RB1.5" —
   * a caller bug should cost the rank, never print a lie.
   */
  readonly rank?: number;
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
 *  text role. Exported through `positionOnFillTextClass` below rather than directly, so every
 *  caller goes through the one function whose own docblock states the contrast this role is
 *  proven to clear. */
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
 * A secondary label sitting INSIDE a `Sticker`'s own fill — a caption that must stay legible as
 * AA body text (≥4.5:1) without competing with the primary label beside it. `text-text-muted` (a
 * page-ground role) is the wrong tool here: it assumes a page surface behind it, and every
 * position's saturated fill measures well under 3:1 against it in both themes (operator review,
 * finding D2 — 1.07:1 dark, 1.15:1 light, measured on QB).
 *
 * Wave-1 review B1: this used to blend the on-fill role toward the fill with `opacity-80`, which
 * only ever had to clear a UI-boundary floor of 3:1. At 12px this text IS AA body text, not a UI
 * boundary — the correct floor is 4.5:1 — so the caption renders the sticker's OWN on-fill role at
 * full strength, the exact color `PositionColor.stickerText` is already proven to clear ≥4.5:1
 * against (`@/design/tokens`), and is set apart from the primary label beside it by size and
 * weight alone (`text-xs`, no `font-medium`), never by dimming the color. Proven ≥4.5:1 for all
 * six positions, both themes, by `held-trade-detail.test.tsx` (`contrastRatio`,
 * `@/design/test-support`).
 */
export function positionOnFillTextClass(position: Position): string {
  return ON_FILL_TEXT[position];
}

/** A rank is printable only if it is a real ordinal. Anything else costs the rank rather than
 *  printing "RB0", and the caller still gets a correct sticker. */
function isOrdinal(rank: number | undefined): rank is number {
  return rank !== undefined && Number.isInteger(rank) && rank > 0;
}

export function PositionBadge({ position, rank, size = "md", className = "" }: PositionBadgeProps) {
  return (
    <span
      className={
        "inline-flex shrink-0 items-center justify-center rounded-sm font-display font-semibold uppercase " +
        `leading-display tracking-wide ${FILL[position]} ${SIZE[size]} ${className}`
      }
    >
      {isOrdinal(rank) ? `${position}${rank}` : position}
    </span>
  );
}
