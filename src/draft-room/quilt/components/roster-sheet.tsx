"use client";

import { useMemo } from "react";
import type { Player } from "@research/domain/player";
import type { TeamCard } from "@/domain/league";
import type { DraftStateView } from "@/draft-engine";
import { BottomSheet, Button, Manager, PlayerFace, PositionBadge, SlotChip } from "@/components/ui";
import { PlayerName } from "@/league-room/components/player-peek";
import { rosterFillRows } from "../../state/roster-fill";
import { pickPlace } from "../state/board";
import type { RoomActs } from "./room-acts";

export interface RosterSheetProps extends Pick<RoomActs, "onPeek"> {
  readonly view: DraftStateView;
  readonly team: TeamCard;
  readonly mine: boolean;
  readonly playersById: ReadonlyMap<string, Player>;
  readonly onClose: () => void;
}

/**
 * A ROSTER AS A SHEET (rulings 2026-09-10: "rosters are sheets from the wall header"). Press a
 * manager's face on the wall and their team slides up: the manager first (P1), then one row
 * per configured spot in the league's own slot order through the shared derivation the debrief
 * uses (`rosterFillRows`, no second slot-assignment opinion). A filled spot states the slot
 * chip, the face, the name (the product's pressable name), the player's own position and the
 * pick's place in the sport's grammar; an open spot is a dashed row with its chip alone.
 */
export function RosterSheet({ view, team, mine, playersById, onPeek, onClose }: RosterSheetProps) {
  const rows = useMemo(() => rosterFillRows(view.slotConfig, view.rosters[team.id] ?? []), [view.slotConfig, view.rosters, team.id]);
  const pickByPlayer = useMemo(() => new Map(view.picks.map((pick) => [pick.playerId, pick])), [view.picks]);
  const teamCount = view.draftOrder.length;
  const filled = rows.filter((row) => row.playerId !== null).length;

  return (
    <BottomSheet label={`${team.name}, the roster`} onClose={onClose}>
      <div data-testid="roster-sheet" className="flex flex-col gap-3">
        <Manager name={team.ownerDisplayName} avatar={team.ownerAvatarUrl} size="lg" ring={mine ? "self" : undefined} meta={team.name} trailing={<span className="text-sm text-text-muted tabular-nums">{filled} of {rows.length} spots</span>} />
        <ul aria-label={`${team.name}'s roster, by slot`} className="flex flex-col gap-1">
          {rows.map((row) => {
            const player = row.playerId === null ? null : (playersById.get(row.playerId) ?? null);
            const pick = row.playerId === null ? null : (pickByPlayer.get(row.playerId) ?? null);
            if (player === null) {
              return (
                <li key={`${row.slot}:${row.slotIndex}`} data-testid="roster-sheet-row" className="flex min-h-11 items-center gap-2 rounded-md border border-dashed border-line px-2.5 py-1">
                  <span className="w-14 shrink-0">
                    <SlotChip slot={row.slot} />
                  </span>
                </li>
              );
            }
            return (
              <li key={`${row.slot}:${row.slotIndex}`} data-testid="roster-sheet-row" className="flex min-h-11 items-center gap-2 rounded-md bg-surface px-2.5 py-1">
                <span className="w-14 shrink-0">
                  <SlotChip slot={row.slot} />
                </span>
                <PlayerFace player={player} size="sm" />
                <PlayerName leagueId={view.leagueId} playerId={player.id} name={player.name} className="min-w-0 truncate font-display text-md font-bold text-text-primary" />
                <Button size="sm" variant="ghost" aria-label={`${player.name}'s draft card`} onClick={() => onPeek(player.id)}>
                  <span aria-hidden="true" className="text-text-muted">
                    ›
                  </span>
                </Button>
                <PositionBadge position={player.position} size="sm" />
                {pick === null ? null : <span className="ml-auto shrink-0 font-display text-sm font-bold text-text-muted tabular-nums">{pickPlace(pick, teamCount)}</span>}
              </li>
            );
          })}
        </ul>
      </div>
    </BottomSheet>
  );
}
