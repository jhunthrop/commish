"use client";

import type { ReactNode } from "react";
import type { Player } from "@/domain/player";
import type { DraftStateView } from "@/draft-engine";
import type { QueueHandlers } from "../hooks/use-queue-handlers";
import type { DraftRoom as DraftRoomState } from "../hooks/use-draft-room";
import { DraftBoard } from "./draft-board";
import { NudgeBanner } from "./nudge-banner";
import { PickCelebration } from "./pick-celebration";
import { PickLog } from "./pick-log";
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
      teamCount={room.teams.length}
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

          waiting={room.waiting}
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
            <div className="max-h-48 shrink-0 overflow-auto border-t border-line p-3">{poolFooter}</div>
          </div>
        )
      }
      stage={
        <div className="flex h-full min-h-0 flex-col gap-3 p-4">
          {/* D2 (2026-08-26 design review): the celebration and the nudge used to render
              in-flow above the board, so every landing pick shoved the board ~64px down and
              snapped it back 2.4s later — the exact reflow the room's own "nothing reflows
              when state changes" law forbids. This slot is the fix's whole mechanism: a
              reserved band (`h-16` fits the celebration's own single-line height) that exists
              whether or not anything is speaking, holding an absolutely positioned layer the
              notices render into. The board below never learns a notice appeared; the rare
              taller notice (nudge + celebration at once, or a two-line auction detail) floats
              over the board's top edge instead of displacing it — the review's own sanctioned
              alternative. */}
          <div data-testid="stage-notices" className="relative h-16 shrink-0">
            <div className="absolute inset-x-0 top-0 z-10 flex flex-col gap-2">
              <NudgeBanner nudge={room.nudge} sequence={view.sequence} />
              <PickCelebration lastPick={room.lastPick} playersById={playersById} teams={room.teams} />
            </div>
          </div>
          <DraftBoard
            view={view}
            teams={room.teams}
            playersById={playersById}
            myTeamId={room.myTeamId}
            landedPickNumber={room.lastPick?.pick.pickNumber ?? null}
            mock={room.mock ? { botMarkerLabel: room.mock.botMarkerLabel, botBadge: room.mock.botBadge } : null}
            reasons={room.reasons}
            laws={room.laws}
          />
          {/* GAMEDAY, LAW 4: the room's history, at density. This band replaced `PickWire` here
              — R1's one truncated mono line, which showed six picks and hid every one before
              them. Collapsing the board's unreached rounds handed the stage back several hundred
              pixels and the honest thing to spend them on is more true facts, not a taller grid
              of dashes. `PickWire` itself is untouched and still serves the TV, where a party
              across a room wants a glanceable ticker rather than a scrolling table.

              A FIXED BAND, like every other band in this frame: `lg:h-56` and it scrolls inside
              itself, so a landing pick never moves the board above it — the room's own
              nothing-reflows law (D2), applied to the region that gains a row most often. */}
          <div className="shrink-0 border-t border-line pt-2 lg:h-56 lg:min-h-0 lg:overflow-hidden">
            <PickLog view={view} teams={room.teams} playersById={playersById} players={room.players} myTeamId={room.myTeamId} />
          </div>
        </div>
      }
      dock={
        <RoomDock
          view={view}
          queue={room.queue}
          playersById={playersById}
          teams={room.teams}
          myTeamId={room.myTeamId}
          submitting={room.submitting}
          canAct={canAct}
          actionLabel={actionLabel}
          onAct={onAct}
          onQueueChange={onQueueChange}
          expectedBotPickSeconds={room.mock?.expectedBotPickSeconds ?? null}
          bidConsole={bidConsole}
        />
      }
    />
  );
}
