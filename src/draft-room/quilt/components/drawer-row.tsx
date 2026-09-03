"use client";

import type { ReactNode } from "react";
import type { Player } from "@/domain/player";
import { PositionBadge } from "@/components/ui";

export interface DrawerRowProps {
  readonly player: Player;
  readonly positionRank?: number;
  /** The ordinal printed in the row's first column — board rank in the pool, sheet rank on the
   *  sheet. Omitted where an ordinal would be noise (the byes tab). */
  readonly rank?: number;
  /** True on the manager's own sheet ordinal, which wears amber. */
  readonly rankAccent?: boolean;
  /** The facts after the name: "DET · Bye 8 · ADP 1.5". */
  readonly meta?: ReactNode;
  /** The judgement column (a `Movement`, a steal chip) — omitted renders nothing. */
  readonly verdict?: ReactNode;
  /** Trailing verbs: star, DRAFT, reorder arrows. */
  readonly actions?: ReactNode;
  /** Struck through and dimmed — a sheet row whose player is already gone. */
  readonly drafted?: boolean;
  readonly highlight?: boolean;
  /** Opens the peek sheet on this player — the name itself is the button. */
  readonly onPeek: (playerId: string) => void;
}

/**
 * One drawer row — the quilt's denser sibling of `PlayerRow`, shared by the POOL, MY SHEET and
 * BYES tabs so the three lists read as one surface. The NAME is the peek button (law 3: click
 * any row for the card), which keeps the row's other verbs — star, DRAFT, reorder — as plain
 * siblings with no click-through gymnastics.
 */
export function DrawerRow({ player, positionRank, rank, rankAccent = false, meta, verdict, actions, drafted = false, highlight = false, onPeek }: DrawerRowProps) {
  return (
    <li
      data-testid="drawer-row"
      className={`flex items-center gap-2 rounded-sm px-2.5 py-1.5 ${highlight ? "border border-accent bg-surface-raised" : "bg-surface-raised"} ${drafted ? "opacity-45" : ""}`}
    >
      {rank === undefined ? null : (
        <span className={`w-6 shrink-0 text-right font-display text-sm font-bold tabular-nums ${rankAccent ? "text-accent" : "text-text-faint"}`}>{rank}</span>
      )}
      <PositionBadge position={player.position} rank={positionRank} size="sm" />
      <span className="flex min-w-0 flex-1 flex-col">
        <button
          type="button"
          onClick={() => onPeek(player.id)}
          className={`w-full truncate text-left font-display text-md font-semibold focus-visible:outline-2 focus-visible:outline-accent ${drafted ? "text-text-faint line-through" : "text-text-primary"}`}
        >
          {player.name}
        </button>
        {meta === undefined ? null : <span className="min-w-0 truncate text-xs text-text-faint">{meta}</span>}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {verdict}
        {actions}
      </span>
    </li>
  );
}
