"use client";

import { useMemo } from "react";
import type { Player } from "@/domain/player";
import type { TeamCard } from "@/domain/league";
import type { DraftStateView } from "@/draft-engine";
import { PositionBadge } from "@/components/ui";
import { pickPlace } from "../state/board";
import { teamCodesById } from "../lib/team-code";
import type { RoomActs } from "./room-acts";

export interface DrawerPicksTabProps extends Pick<RoomActs, "onPeek"> {
  readonly view: DraftStateView;
  readonly teams: readonly TeamCard[];
  readonly playersById: ReadonlyMap<string, Player>;
  readonly myTeamId: string | null;
}

/**
 * THE PICKS TAB — the room's history, latest first, every row a fact: place, team, player. The
 * caller's own picks wear the amber edge; an auto-pick says so in words, because a clock-made
 * pick is a different fact from a chosen one.
 */
export function DrawerPicksTab({ view, teams, playersById, myTeamId, onPeek }: DrawerPicksTabProps) {
  const codes = useMemo(() => teamCodesById(teams), [teams]);
  const picks = useMemo(() => [...view.picks].reverse(), [view.picks]);
  const teamCount = view.draftOrder.length;

  if (picks.length === 0) {
    return <p className="text-sm text-text-faint">No picks yet. The story starts at 1.01.</p>;
  }

  return (
    <ol aria-label="Every pick, latest first" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
      {picks.map((pick) => {
        const player = playersById.get(pick.playerId);
        const mine = pick.teamId === myTeamId;
        return (
          <li
            key={pick.pickNumber}
            className={`flex items-center gap-2 rounded-sm px-2.5 py-1.5 ${mine ? "border border-accent bg-surface-raised" : "bg-surface-raised"}`}
          >
            <span className="w-10 shrink-0 font-display text-sm font-bold text-text-muted tabular-nums">{pickPlace(pick, teamCount)}</span>
            <span className={`w-10 shrink-0 font-display text-xs font-bold ${mine ? "text-accent" : "text-text-faint"}`}>
              {mine ? "YOU" : (codes.get(pick.teamId) ?? "")}
            </span>
            {player === undefined ? (
              <span className="text-sm text-text-faint">Unknown player</span>
            ) : (
              <>
                <PositionBadge position={player.position} size="sm" />
                <button
                  type="button"
                  onClick={() => onPeek(player.id)}
                  className="min-w-0 truncate text-left font-display text-md font-semibold text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {player.name}
                </button>
              </>
            )}
            {pick.auto ? <span className="ml-auto shrink-0 text-xs text-text-faint">auto</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
