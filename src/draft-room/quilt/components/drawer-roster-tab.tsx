"use client";

import { useMemo } from "react";
import type { Player } from "@/domain/player";
import type { DraftStateView } from "@/draft-engine";
import { Button, PlayerFace, PositionBadge, SlotChip } from "@/components/ui";
import { PlayerName } from "@/league-room/components/player-peek";
import { rosterFillRows } from "../../state/roster-fill";
import { pickPlace } from "../state/board";
import type { RoomActs } from "./room-acts";

export interface DrawerRosterTabProps extends Pick<RoomActs, "onPeek"> {
  readonly view: DraftStateView;
  readonly myTeamId: string | null;
  readonly playersById: ReadonlyMap<string, Player>;
}

/**
 * THE ROSTER TAB (founder ruling 2026-09-03 — the spine's replacement): the caller's roster as
 * drawer rows, one per configured spot in the league's own slot order, through the SAME shared
 * derivation the rail and the debrief use (`rosterFillRows` — no second slot-assignment
 * opinion). A filled spot states its facts: the slot chip, the face, the name (`PlayerName`, the
 * product's one pressable-name primitive — opens the season peek), a sibling "Card" button for
 * this room's own draft-context card (board rank, sheet rank, notes — what the name used to
 * open before the player-name adoption sweep gave the name itself to the season sheet), the
 * player's OWN position badge (a WR filling FLEX shows WR), and the pick's place in the sport's
 * grammar — the fact the retired spine never stated. An open spot is a dashed row carrying just
 * its slot chip: the quilt's own dashed-promise vocabulary, saying a row will land here.
 *
 * The handles hide this tab for a caller with no team (the "nothing to say" law, the Byes
 * gating pattern); the sentence below is the total-function fallback, never the expected path.
 */
export function DrawerRosterTab({ view, myTeamId, playersById, onPeek }: DrawerRosterTabProps) {
  const rows = useMemo(() => rosterFillRows(view.slotConfig, myTeamId === null ? [] : (view.rosters[myTeamId] ?? [])), [view.slotConfig, view.rosters, myTeamId]);
  const pickByPlayer = useMemo(() => new Map(view.picks.map((pick) => [pick.playerId, pick])), [view.picks]);
  const teamCount = view.draftOrder.length;

  if (myTeamId === null) {
    return <p className="text-sm text-text-faint">You have no team in this room.</p>;
  }

  return (
    <ul aria-label="Your roster, by slot" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
      {rows.map((row) => {
        const player = row.playerId === null ? null : (playersById.get(row.playerId) ?? null);
        const pick = row.playerId === null ? null : (pickByPlayer.get(row.playerId) ?? null);
        if (player === null) {
          return (
            <li
              key={`${row.slot}:${row.slotIndex}`}
              data-testid="roster-tab-row"
              className="flex items-center gap-2 rounded-sm border border-dashed border-line px-2.5 py-1.5"
            >
              <span className="w-14 shrink-0">
                <SlotChip slot={row.slot} />
              </span>
            </li>
          );
        }
        return (
          <li
            key={`${row.slot}:${row.slotIndex}`}
            data-testid="roster-tab-row"
            className="flex items-center gap-2 rounded-sm bg-surface-raised px-2.5 py-1.5"
          >
            <span className="w-14 shrink-0">
              <SlotChip slot={row.slot} />
            </span>
            <PlayerFace player={player} size="sm" />
            <PlayerName
              leagueId={view.leagueId}
              playerId={player.id}
              name={player.name}
              className="min-w-0 truncate font-display text-md font-semibold text-text-primary"
            />
            {/* Task 3: the name opens the season peek; the room's own draft-context card (board
                rank, sheet rank, notes) is a sibling "Card" button, matching `DrawerRow`'s own
                restructuring. */}
            <Button size="sm" variant="ghost" aria-label={`${player.name}'s draft card`} onClick={() => onPeek(player.id)}>
              <span aria-hidden="true" className="text-text-muted">
                ›
              </span>
            </Button>
            <PositionBadge position={player.position} size="sm" />
            {pick === null ? null : (
              <span className="ml-auto shrink-0 font-display text-sm font-bold text-text-muted tabular-nums">{pickPlace(pick, teamCount)}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
