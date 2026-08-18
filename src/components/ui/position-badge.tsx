import type { Position } from "@/domain/player";

export type PositionBadgeSize = "sm" | "md" | "lg";

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

const SIZE: Readonly<Record<PositionBadgeSize, string>> = {
  sm: "h-5 px-2 text-xs",
  md: "h-6 px-2 text-sm",
  lg: "h-8 px-3 text-display-sm",
};

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
