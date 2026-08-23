"use client";

import type { ReactNode } from "react";
import type { Player } from "@/domain/player";
import type { DraftStateView } from "@/draft-engine";
import type { HelpLevel } from "@/identity/preferences";
import type { QueueHandlers } from "../hooks/use-queue-handlers";
import type { DraftRoom as DraftRoomState } from "../hooks/use-draft-room";
import { DraftBoard } from "./draft-board";
import { NudgeBanner } from "./nudge-banner";
import { PickCelebration } from "./pick-celebration";
import { PlayerPool } from "./player-pool";
import { RoomDock } from "./room-dock";
import { RoomLayout } from "./room-layout";
import { RoomRail } from "./room-rail";

export interface RoomShellProps extends QueueHandlers {
  readonly room: DraftRoomState;
  readonly view: DraftStateView;
  readonly playersById: ReadonlyMap<string, Player>;
  /** True only when the server says it is this user's turn to act. */
  readonly canAct: boolean;
  /** "Draft" for snake, "Nominate" for auction. */
  readonly actionLabel: string;
  readonly onAct: (playerId: string) => void;
  /**
   * The auction's per-team budget meter, rendered under the pool. Passing it in rather than
   * branching here is what keeps this shell format-agnostic — snake has none.
   */
  readonly poolFooter?: ReactNode;
  /** The auction's live-lot console (`BidControls`), or null. Snake never has one. */
  readonly bidConsole?: ReactNode;
  /** The social band down the right edge (league chat), or nothing. Built by `DraftRoom`. */
  readonly aside?: ReactNode;
  /** Forwarded to `RoomRail`'s `InfoTip`s. See `RoomRailProps.helpLevel`. */
  readonly helpLevel?: HelpLevel;
}

/**
 * The one draft-room frame — rail, pool, board, dock — shared by `SnakeRoom` and
 * `AuctionRoom`. Everything that differs between the two formats (the action label, whether a
 * pool footer or a bid console exists) is a prop, not a branch in here.
 */
export function RoomShell({
  room,
  view,
  playersById,
  canAct,
  actionLabel,
  onAct,
  queuedPlayerIds,
  onQueueToggle,
  onQueueChange,
  poolFooter,
  bidConsole,
  aside,
  helpLevel,
}: RoomShellProps) {
  const pool = (
    <PlayerPool
      players={room.players}
      view={view}
      pendingPlayerId={room.pendingPlayerId}
      canAct={canAct}
      myTeamId={room.myTeamId}
      actionLabel={actionLabel}
      submitting={room.submitting}
      onAct={onAct}
      queuedPlayerIds={queuedPlayerIds}
      onQueue={onQueueToggle}
    />
  );

  return (
    <RoomLayout
      aside={aside}
      rail={
        <RoomRail
          leagueName={room.leagueName}
          view={view}
          teams={room.teams}
          myTeamId={room.myTeamId}
          playersById={playersById}
          connection={room.connection}
          helpLevel={helpLevel}
        />
      }
      pool={
        poolFooter === undefined ? (
          pool
        ) : (
          // Money sits under the players you would spend it on. It is the one auction fact the
          // board and the rail cannot carry — a sticker shows what a pick COST, never what
          // anybody has left — so it gets the foot of this column and nowhere else.
          <div className="flex h-full min-h-0 flex-col">
            <div className="min-h-0 flex-1">{pool}</div>
            <div className="max-h-48 shrink-0 overflow-auto border-t border-border p-3">{poolFooter}</div>
          </div>
        )
      }
      stage={
        <div className="flex h-full min-h-0 flex-col gap-3 p-4">
          <NudgeBanner nudge={room.nudge} sequence={view.sequence} />
          <PickCelebration lastPick={room.lastPick} playersById={playersById} teams={room.teams} />
          <DraftBoard
            view={view}
            teams={room.teams}
            playersById={playersById}
            myTeamId={room.myTeamId}
            landedPickNumber={room.lastPick?.pick.pickNumber ?? null}
          />
        </div>
      }
      dock={
        <RoomDock
          view={view}
          queue={room.queue}
          playersById={playersById}
          myTeamId={room.myTeamId}
          submitting={room.submitting}
          canAct={canAct}
          actionLabel={actionLabel}
          onAct={onAct}
          onQueueChange={onQueueChange}
          bidConsole={bidConsole}
        />
      }
    />
  );
}
