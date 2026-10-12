"use client";

import { memo } from "react";
import type { Player } from "@research/domain/player";
import type { Position } from "@research/domain/player";
import { CountdownLabel } from "@/components/ui";
import { PlayerFace } from "@/components/ui/player-face";
import { MOTION } from "@/design/motion";
import { entranceClass } from "@/design/use-motion";
import { pickPlace, type QuiltCell as QuiltCellModel } from "../state/board";
import { BOARD_HEIGHTS } from "../state/heights";

export interface QuiltCellProps {
  readonly cell: QuiltCellModel;
  readonly player: Player | null;
  /** The room's seat count, for a landed pick's "2.05" place in its accessible name. */
  readonly teamCount: number;
  /** The running turn's deadline, handed ONLY to the on-clock cell (null everywhere else, so a
   *  new turn re-renders one cell); the cell's own `CountdownLabel` ticks alone inside it. */
  readonly deadlineAt: string | null;
  readonly onPeek: (playerId: string) => void;
  /** True while the peek sheet is open on this cell's player. */
  readonly peeked: boolean;
  /** True for the full WINDOW's cells: a landed pick renders the player's face beside the
   *  condensed name. Track and micro geometry never carries one. */
  readonly withFace: boolean;
  /** The row's ONE height from the board's height model. Every cell fills it exactly and sheds
   *  its lines as it shrinks: the caption under `cellCaptionMinPx`, the primary line under
   *  `cellTextMinPx`, the face under `cellFaceMinPx`. */
  readonly rowHeight: number;
  /** True when this pick is the caller's own: the amber wash, and the slap-in when it lands. */
  readonly mine: boolean;
  /** The entrance class for a pick that landed while this board was on screen (`landingClassFor`);
   *  the empty string for a pick already there when the board mounted (nothing animates on mount). */
  readonly landingClass: string;
}

/** The 3px position colour on a tile's leading edge: the wall's only chroma per pick. Position
 *  colours are `PositionBadge`'s and the board's own (design-system rule); spelled whole so
 *  Tailwind emits each class. */
const POSITION_EDGE: Readonly<Record<Position, string>> = {
  QB: "border-l-pos-qb",
  RB: "border-l-pos-rb",
  WR: "border-l-pos-wr",
  TE: "border-l-pos-te",
  K: "border-l-pos-k",
  DEF: "border-l-pos-def",
};

/**
 * The entrance a landed cell wears (founder deliverable: the self pick slaps in at celebration
 * scale, a peer's pick springs). A pick already on the board at mount wears nothing. A reader
 * who asked for less motion gets the opacity-only settle, never a shorter slap.
 */
export function landingClassFor(landedAfterMount: boolean, mine: boolean, reducedMotion: boolean): string {
  if (!landedAfterMount) return "";
  if (reducedMotion) return MOTION.settleStill.className;
  return entranceClass(mine ? "celebrate" : "in", false);
}

/**
 * One cell of the wall. A landed pick is a paper tile (the face on his club's ring, the name,
 * "WR · CIN · 1.01") with the position on its leading edge; your own picks sit on the amber
 * wash; the on-clock cell is the dashed Court blue promise; your upcoming cell is a dashed
 * amber one; an empty cell is a dashed hairline. A landed tile is a button: it opens the peek.
 *
 * MEMOIZED (fluidity round): a pick landing is one cell settling, not a board repaint. Every
 * prop is a primitive, a stable callback or a row object the board reuses when nothing in it
 * changed, so a 12-team board re-renders only the landed cell and the cell whose clock started.
 */
export const QuiltCellView = memo(function QuiltCellView({ cell, player, teamCount, deadlineAt, onPeek, peeked, withFace, rowHeight, mine, landingClass }: QuiltCellProps) {
  const showText = rowHeight >= BOARD_HEIGHTS.cellTextMinPx;
  const showCaption = rowHeight >= BOARD_HEIGHTS.cellCaptionMinPx;
  if (cell.onClock) {
    return (
      <div data-testid="quilt-onclock" className="flex h-full min-h-0 flex-col items-center justify-center overflow-hidden rounded-sm border-2 border-dashed border-accent bg-surface-elevated">
        {showText ? <CountdownLabel deadlineAt={deadlineAt} className="font-display text-sm font-bold text-accent tabular-nums" /> : null}
        {showCaption ? <span className="text-[10px] leading-tight text-accent">on the clock</span> : null}
      </div>
    );
  }
  if (cell.pick !== null && player !== null) {
    return (
      <button
        type="button"
        data-testid="quilt-pick-cell"
        data-landing={landingClass === "" ? undefined : mine ? "self" : "peer"}
        data-mine={mine ? "true" : undefined}
        aria-pressed={peeked}
        aria-label={`${player.name}, pick ${pickPlace(cell.pick, teamCount)}`}
        onClick={() => onPeek(player.id)}
        className={`flex h-full min-h-0 items-center gap-1.5 overflow-hidden rounded-sm border-l-[3px] px-1.5 text-left shadow-card focus-visible:outline-2 focus-visible:outline-accent ${POSITION_EDGE[player.position]} ${
          mine ? "self-wash" : "bg-surface-elevated"
        } ${peeked ? "ring-2 ring-accent" : ""} ${landingClass}`}
      >
        {withFace && rowHeight >= BOARD_HEIGHTS.cellFaceMinPx ? <PlayerFace player={player} size="sm" /> : null}
        {showText ? (
          <span className="flex min-w-0 flex-col justify-center">
            <span className="truncate font-display text-sm font-bold leading-tight text-text-primary">{shortName(player.name)}</span>
            {showCaption ? (
              <span className="truncate text-[10px] leading-tight text-text-muted">
                {player.position} · {player.nflTeam} · {pickPlace(cell.pick, teamCount)}
              </span>
            ) : null}
          </span>
        ) : null}
      </button>
    );
  }
  if (cell.yourPickLabel !== null) {
    return (
      <div data-testid="quilt-your-cell" className="flex h-full min-h-0 flex-col items-center justify-center overflow-hidden rounded-sm border border-dashed border-self bg-surface-elevated">
        {showText ? <span className="font-display text-sm font-bold text-self-ink tabular-nums">{cell.yourPickLabel}</span> : null}
        {showCaption ? <span className="text-[10px] leading-tight text-self-ink">yours</span> : null}
      </div>
    );
  }
  return <div aria-hidden="true" className="h-full min-h-0 rounded-sm border border-dashed border-line" />;
});

/** "Jahmyr Gibbs" → "J. Gibbs" — the cell grammar; a one-word name stays itself. */
export function shortName(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length < 2) return name;
  return `${words[0]!.charAt(0)}. ${words.slice(1).join(" ")}`;
}
