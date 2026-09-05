"use client";

import type { ReactNode } from "react";
import type { Player } from "@/domain/player";
import { Button, PositionBadge } from "@/components/ui";
import { PlayerName } from "@/league-room/components/player-peek";

export interface DrawerRowProps {
  readonly leagueId: string;
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
  /** Opens the quilt's own draft-context card (board rank, sheet rank, notes, Draft/Queue) — a
   *  SIBLING control to the name now (player-name adoption sweep, task 3): the name itself went
   *  through `PlayerName` to reach the product's one season-stats peek, so this row's own richer
   *  in-draft card needed its own trigger rather than double-booking the name button (the "one
   *  primitive per feature" rule — see `player-peek.tsx`'s docblock — reads as "the name is
   *  ONE thing", not "a name click can only ever mean one product surface"). */
  readonly onPeek: (playerId: string) => void;
}

/**
 * One drawer row — the quilt's denser sibling of `PlayerRow`, shared by the POOL, MY SHEET and
 * BYES tabs so the three lists read as one surface. The name opens the season peek (`PlayerName`,
 * the product's one pressable-name primitive); the small "Card" button beside it is what law 3
 * used to hang off the name itself — this room's own richer draft-context card (board rank,
 * sheet rank, notes, Draft/Queue) — now a plain sibling, never nested inside another control.
 */
export function DrawerRow({
  leagueId,
  player,
  positionRank,
  rank,
  rankAccent = false,
  meta,
  verdict,
  actions,
  drafted = false,
  highlight = false,
  onPeek,
}: DrawerRowProps) {
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
        <PlayerName
          leagueId={leagueId}
          playerId={player.id}
          name={player.name}
          className={`w-full truncate font-display text-md font-semibold ${drafted ? "text-text-faint line-through" : "text-text-primary"}`}
        />
        {meta === undefined ? null : <span className="min-w-0 truncate text-xs text-text-faint">{meta}</span>}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        <Button size="sm" variant="ghost" aria-label={`${player.name}'s draft card`} onClick={() => onPeek(player.id)}>
          <span aria-hidden="true" className="text-text-muted">
            ›
          </span>
        </Button>
        {verdict}
        {actions}
      </span>
    </li>
  );
}
