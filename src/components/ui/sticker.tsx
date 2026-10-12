import type { ReactNode } from "react";
import type { Position } from "@research/domain/player";
import { positionStickerClass } from "./position-badge";

export interface StickerProps {
  readonly position: Position;
  /** Layout classes for the call site (padding, flex, sizing). Pigment/shape/shadow are NOT overridable. */
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * A position-pigmented sticker tile — the Poster Board's signature shape. The ONE component
 * that owns the sticker look (rounded corner, `shadow-sticker`, position fill via
 * `positionStickerClass`); the draft board's pick cells and the landing page's showcase board
 * are the same sticker at different sizes, never two hand-rolled copies. Call sites own only
 * layout (padding, flex, min-widths) through `className`.
 */
export function Sticker({ position, className = "", children }: StickerProps) {
  return <div className={`rounded-sm shadow-sticker ${positionStickerClass(position)} ${className}`}>{children}</div>;
}
