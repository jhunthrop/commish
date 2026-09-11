"use client";

import { memo } from "react";
import type { Player } from "@/domain/player";
import { CountdownLabel } from "@/components/ui";
import { PlayerFace } from "@/components/ui/player-face";
import { positionOnFillTextClass, positionStickerClass } from "@/components/ui/position-badge";
import { MOTION } from "@/design/motion";
import { pickPlace, type QuiltCell as QuiltCellModel } from "../state/board";
import { BOARD_HEIGHTS } from "../state/heights";
import type { Lens, ValueVerdict } from "../state/lens";

export interface QuiltCellProps {
  readonly cell: QuiltCellModel;
  readonly player: Player | null;
  /** The room's seat count, for a landed pick's "2.05" place in its accessible name. */
  readonly teamCount: number;
  readonly lens: Lens;
  /** VALUE lens: the landed pick's verdict, or null (no board rank, or another lens). */
  readonly verdict: ValueVerdict | null;
  /** BYES lens: the player's bye week, or null when the schedule has nothing to claim. */
  readonly byeWeek: number | null;
  /** The running turn's deadline, handed ONLY to the on-clock cell (null everywhere else, so a
   *  new turn re-renders one cell); the cell's own `CountdownLabel` ticks alone inside it. */
  readonly deadlineAt: string | null;
  readonly onPeek: (playerId: string) => void;
  /** True while the peek sheet is open on this cell's player. */
  readonly peeked: boolean;
  /** True for the full WINDOW's cells (founder addition 4, widened by the 2026-09-03
   *  four-round ruling): a landed pick renders the player's face beside the condensed name.
   *  Track and micro geometry never carries one. */
  readonly withFace: boolean;
  /** The row's ONE height from the board's height model. Every cell fills it exactly — the
   *  law behind the 2026-09-03 fix — and sheds its lines as it shrinks: the caption under
   *  `cellCaptionMinPx`, the primary line under `cellTextMinPx` (a dashed YOURS cell keeps
   *  its amber dashed border as its whole identity), the face under `cellFaceMinPx`. */
  readonly rowHeight: number;
  /** The settle class for a pick that landed while this board was on screen (`MOTION.settle`,
   *  or `settleStill` for a reader who asked for less motion); the empty string for a pick that
   *  was already there when the board mounted — nothing animates on mount (law 6). */
  readonly settleClass: string;
}

/** The VALUE lens's tint per verdict — the verdict pair plus quiet for even (law 4 channel two). */
const VERDICT_CELL: Readonly<Record<ValueVerdict, { readonly box: string; readonly text: string }>> = {
  steal: { box: "bg-surface-raised outline outline-1 outline-positive", text: "text-positive" },
  reach: { box: "bg-surface-raised outline outline-1 outline-negative", text: "text-negative" },
  even: { box: "bg-surface-raised", text: "text-text-muted" },
};

/** The settle class a cell should wear, by whether it landed after the board mounted and
 *  whether the reader asked for less motion. One place for the choice; every row shares it. */
export function settleClassFor(landedAfterMount: boolean, reducedMotion: boolean): string {
  if (!landedAfterMount) return "";
  return reducedMotion ? MOTION.settleStill.className : MOTION.settle.className;
}

function cellFact(lens: Lens, player: Player, verdict: ValueVerdict | null, byeWeek: number | null): string {
  if (lens === "byes") return byeWeek === null ? player.nflTeam : `Bye ${byeWeek}`;
  if (lens === "value" && verdict !== null) return verdict;
  return `${player.position} · ${player.nflTeam}`;
}

/**
 * One full-size cell of the quilt. A landed pick is a button (it opens the peek); the on-clock
 * cell carries the room's own red and the running clock; the caller's own upcoming cell is a
 * dashed amber promise; an empty cell is an inset track. Lenses only change pigment and the
 * micro-line's fact — geometry is shared, so switching lenses moves nothing.
 *
 * MEMOIZED (fluidity round, 2026-09-10): a pick landing is one cell settling, not a board
 * repaint. Every prop is a primitive, a stable callback or a row object the board reuses when
 * nothing in it changed (`reuseQuiltRows`), so the 180 cells of a 12-team board re-render only
 * where the board actually changed — the landed cell and the cell whose clock just started.
 */
export const QuiltCellView = memo(function QuiltCellView({ cell, player, teamCount, lens, verdict, byeWeek, deadlineAt, onPeek, peeked, withFace, rowHeight, settleClass }: QuiltCellProps) {
  const showText = rowHeight >= BOARD_HEIGHTS.cellTextMinPx;
  const showCaption = rowHeight >= BOARD_HEIGHTS.cellCaptionMinPx;
  if (cell.onClock) {
    return (
      <div data-testid="quilt-onclock" className="flex h-full min-h-0 flex-col items-center justify-center overflow-hidden rounded-sm bg-surface-inset outline-2 outline-live">
        {showText ? <CountdownLabel deadlineAt={deadlineAt} className="font-display text-sm font-bold text-live tabular-nums" /> : null}
        {showCaption ? <span className="text-[10px] leading-tight text-live">ON CLOCK</span> : null}
      </div>
    );
  }
  if (cell.pick !== null && player !== null) {
    const value = lens === "value" && verdict !== null ? VERDICT_CELL[verdict] : null;
    const box = value !== null ? value.box : positionStickerClass(player.position);
    const text = value !== null ? value.text : positionOnFillTextClass(player.position);
    return (
      <button
        type="button"
        data-testid="quilt-pick-cell"
        data-settle={settleClass === "" ? undefined : "landing"}
        aria-pressed={peeked}
        aria-label={`${player.name}, pick ${pickPlace(cell.pick, teamCount)}`}
        onClick={() => onPeek(player.id)}
        className={`flex h-full min-h-0 items-center gap-2 overflow-hidden rounded-sm px-2 text-left focus-visible:outline-2 focus-visible:outline-accent ${box} ${peeked ? "ring-2 ring-accent" : ""} ${settleClass}`}
      >
        {withFace && rowHeight >= BOARD_HEIGHTS.cellFaceMinPx ? <PlayerFace player={player} size="sm" /> : null}
        {showText ? (
          <span className="flex min-w-0 flex-col justify-center">
            <span className={`truncate font-display text-sm font-bold leading-tight ${text}`}>{shortName(player.name)}</span>
            {showCaption ? <span className={`truncate text-[10px] leading-tight opacity-85 ${text}`}>{cellFact(lens, player, verdict, byeWeek)}</span> : null}
          </span>
        ) : null}
      </button>
    );
  }
  if (cell.yourPickLabel !== null) {
    return (
      <div data-testid="quilt-your-cell" className="flex h-full min-h-0 flex-col items-center justify-center overflow-hidden rounded-sm border border-dashed border-accent bg-surface-raised">
        {showText ? <span className="font-display text-sm font-bold text-accent tabular-nums">{cell.yourPickLabel}</span> : null}
        {showCaption ? <span className="text-[10px] leading-tight text-accent">YOURS</span> : null}
      </div>
    );
  }
  return <div aria-hidden="true" className="h-full min-h-0 rounded-sm bg-surface-inset" />;
});

/** "Jahmyr Gibbs" → "J. Gibbs" — the mock's cell grammar; a one-word name stays itself. */
export function shortName(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length < 2) return name;
  return `${words[0]!.charAt(0)}. ${words.slice(1).join(" ")}`;
}
