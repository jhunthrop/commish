"use client";

import { memo, useMemo } from "react";
import type { Player } from "@/domain/player";
import type { TeamCard } from "@/domain/league";
import type { CompletedPick, DraftStateView } from "@/draft-engine";
import { Button, MotionList, PositionBadge, type MotionRowProps } from "@/components/ui";
import { PlayerName } from "@/league-room/components/player-peek";
import { pickPlace } from "../state/board";
import { teamCodesById } from "../lib/team-code";
import type { RoomActs } from "./room-acts";

export interface DrawerPicksTabProps extends Pick<RoomActs, "onPeek"> {
  readonly view: DraftStateView;
  readonly teams: readonly TeamCard[];
  readonly playersById: ReadonlyMap<string, Player>;
  readonly myTeamId: string | null;
}

const keyOf = (pick: CompletedPick): string => String(pick.pickNumber);

interface PickRowProps extends Pick<RoomActs, "onPeek"> {
  readonly pick: CompletedPick;
  readonly player: Player | undefined;
  readonly place: string;
  readonly code: string;
  readonly mine: boolean;
  readonly leagueId: string;
  readonly row: MotionRowProps;
}

const PickRow = memo(function PickRow({ pick, player, place, code, mine, leagueId, onPeek, row }: PickRowProps) {
  return (
    <li {...row} className={`flex items-center gap-2 rounded-sm px-2.5 py-1.5 ${mine ? "border border-accent bg-surface-raised" : "bg-surface-raised"} ${row.className}`}>
      <span className="w-10 shrink-0 font-display text-sm font-bold text-text-muted tabular-nums">{place}</span>
      <span className={`w-10 shrink-0 font-display text-xs font-bold ${mine ? "text-accent" : "text-text-faint"}`}>{mine ? "YOU" : code}</span>
      {player === undefined ? (
        <span className="text-sm text-text-faint">Unknown player</span>
      ) : (
        <>
          <PositionBadge position={player.position} size="sm" />
          <PlayerName leagueId={leagueId} playerId={player.id} name={player.name} className="min-w-0 truncate font-display text-md font-semibold text-text-primary" />
          {/* Task 3: the name now opens the season peek; the room's own draft-context card
              (board rank, sheet rank, notes) is a sibling "Card" button, matching
              `DrawerRow`'s own restructuring. */}
          <Button size="sm" variant="ghost" aria-label={`${player.name}'s draft card`} onClick={() => onPeek(player.id)}>
            <span aria-hidden="true" className="text-text-muted">
              ›
            </span>
          </Button>
        </>
      )}
      {pick.auto ? <span className="ml-auto shrink-0 text-xs text-text-faint">auto</span> : null}
    </li>
  );
});

/**
 * THE PICKS TAB — every pick, latest first. A new pick fades in at the top and the log slides
 * down beneath it (`MotionList`); every older row is memoized and untouched.
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
      <MotionList items={picks} keyOf={keyOf}>
        {(pick, row) => (
          <PickRow
            pick={pick}
            player={playersById.get(pick.playerId)}
            place={pickPlace(pick, teamCount)}
            code={codes.get(pick.teamId) ?? ""}
            mine={pick.teamId === myTeamId}
            leagueId={view.leagueId}
            onPeek={onPeek}
            row={row}
          />
        )}
      </MotionList>
    </ol>
  );
}
