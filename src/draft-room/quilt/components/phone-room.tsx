"use client";

import { useCallback, useMemo, type ReactNode } from "react";
import type { Player } from "@/domain/player";
import type { DraftStateView } from "@/draft-engine";
import type { UseAdvisorResult } from "../../advisor/use-advisor";
import type { DraftRoom as DraftRoomState } from "../../hooks/use-draft-room";
import type { PlayerHistoryState } from "../hooks/use-player-history";
import type { PeekFacts } from "./peek-sheet";
import type { PendingPick } from "../state/pending-pick";
import type { BoardView } from "./board-region";
import { Dock } from "./dock";
import { DockCall } from "./dock-call";
import { MobileConfirmSheet } from "./mobile-confirm-sheet";
import { PeekSheet } from "./peek-sheet";
import type { RoomActs } from "./room-acts";
import { StreamPanel } from "./stream-panel";
import type { RailCall } from "./stream-rail";
import { TopStrip } from "./top-strip";
import { UndoPill } from "./undo-pill";

/**
 * THE PHONE'S OWN SURFACE STATE, held by the room and not by this tree: only the composition for
 * the current width mounts, so a window crossing the breakpoint unmounts this tree, and a
 * pending confirmation or the open peek must survive that.
 */
export interface PhoneSurface {
  /** The player whose confirm sheet is open, or null. */
  readonly confirmId: string | null;
  /** The player whose draft-context peek is open on the phone, or null. */
  readonly peekId: string | null;
}

export const RESTING_PHONE: PhoneSurface = { confirmId: null, peekId: null };

export interface PhoneRoomProps {
  readonly room: DraftRoomState;
  readonly view: DraftStateView;
  readonly playersById: ReadonlyMap<string, Player>;
  readonly myTurn: boolean;
  /** The desktop act bundle; `onDraft` here already runs the undo window. The phone inserts the
   *  confirm sheet in front of it, so a phone pick is guarded twice. */
  readonly acts: RoomActs;
  readonly pending: PendingPick | null;
  readonly onUndo: () => void;
  readonly phone: PhoneSurface;
  readonly onPhone: (patch: Partial<PhoneSurface>) => void;
  readonly boardView: BoardView;
  /** The board region, composed by the room so both widths share one instance of its state. */
  readonly board: ReactNode;
  readonly peekFacts: PeekFacts | null;
  readonly peekHistory: PlayerHistoryState;
  readonly onNote: (playerId: string, note: string) => void;
  readonly byeWeeks: ReadonlyMap<string, number>;
  readonly sheetRanks: ReadonlyMap<string, number>;
  readonly advisor: UseAdvisorResult;
  readonly nextPickLabel: string | null;
  readonly railCall: RailCall | null;
  readonly rosterSheet: ReactNode;
}

/** How tall the board region stands on a phone: the wall's tiles, or a sheet column with its
 *  strip and a handful of rows, both clear of the call block pinned at the foot. */
const BOARD_HEIGHT: Readonly<Record<BoardView, string>> = { wall: "h-[24rem]", sheet: "h-[27rem]" };

/**
 * THE PHONE ROOM (ruling 2: "the phone keeps the stream as the screen"): one column. The top
 * strip, the board region at a fixed height (the wall as micro tiles, or a sheet column at
 * full width), then the stream in the page's flow, then the queue and the pool. Our call and
 * the one Draft verb ride a block fixed at the foot, always in reach. Picking is two-step by
 * law (the confirm sheet), then the same undo window the desktop gets.
 */
export function PhoneRoom({ room, view, playersById, myTurn, acts, pending, onUndo, phone, onPhone, boardView, board, peekFacts, peekHistory, onNote, byeWeeks, sheetRanks, advisor, nextPickLabel, railCall, rosterSheet }: PhoneRoomProps) {
  const setConfirmId = useCallback((next: string | null) => onPhone({ confirmId: next }), [onPhone]);
  const setPeekId = useCallback((next: string | null) => onPhone({ peekId: next }), [onPhone]);
  // Two-step picking: every Draft on this tree opens the confirm sheet; only its Confirm hands the
  // pick to the undo window (`acts.onDraft`).
  const phoneActs: RoomActs = useMemo(() => ({ ...acts, onDraft: setConfirmId, onPeek: setPeekId }), [acts, setConfirmId, setPeekId]);
  const confirmPlayer = phone.confirmId === null ? null : (playersById.get(phone.confirmId) ?? null);
  const noop = useCallback(() => {}, []);

  return (
    <div data-testid="phone-room" className="relative flex min-h-0 flex-1 flex-col gap-3 pb-44">
      <TopStrip leagueName={room.leagueName} view={view} teams={room.teams} myTeamId={room.myTeamId} myTurn={myTurn} hiddenNew={0} onOpenStream={null} />
      <div className={`flex ${BOARD_HEIGHT[boardView]} shrink-0 flex-col px-3`}>{board}</div>
      <div className="px-3">
        <StreamPanel view={view} leagueName={room.leagueName} teams={room.teams} playersById={playersById} myTeamId={room.myTeamId} width="open" onWidth={noop} asPage call={railCall} onUnread={noop} />
      </div>
      <div className="flex h-[26rem] shrink-0 flex-col px-3">
        <Dock view={view} players={room.players} playersById={playersById} myTeamId={room.myTeamId} byeWeeks={byeWeeks} queue={room.queue} advisor={advisor} nextPickLabel={nextPickLabel} withCall={false} {...phoneActs} />
      </div>

      {room.myTeamId === null ? null : (
        <div data-testid="phone-call" className="fixed inset-x-3 bottom-3 z-30 rounded-xl bg-surface-elevated shadow-overlay">
          <DockCall
            view={view}
            myTeamId={room.myTeamId}
            playersById={playersById}
            advisor={advisor.view}
            recomputing={advisor.recomputing}
            queue={room.queue}
            byeWeeks={byeWeeks}
            nextPickLabel={nextPickLabel}
            compact
            canDraft={phoneActs.canDraft}
            submitting={phoneActs.submitting}
            queuedPlayerIds={phoneActs.queuedPlayerIds}
            onDraft={phoneActs.onDraft}
            onQueueToggle={phoneActs.onQueueToggle}
          />
        </div>
      )}

      {pending === null ? null : (
        <div className="pointer-events-none fixed bottom-48 left-1/2 z-40 -translate-x-1/2">
          <UndoPill pending={pending} player={playersById.get(pending.playerId) ?? null} swappedFrom={pending.swappedFromPlayerId === null ? null : (playersById.get(pending.swappedFromPlayerId) ?? null)} onUndo={onUndo} />
        </div>
      )}

      {confirmPlayer === null ? null : (
        <MobileConfirmSheet
          player={confirmPlayer}
          byeWeek={byeWeeks.get(confirmPlayer.nflTeam) ?? null}
          sheetRank={sheetRanks.get(confirmPlayer.id) ?? null}
          submitting={acts.submitting}
          onConfirm={(playerId) => {
            setConfirmId(null);
            acts.onDraft(playerId);
          }}
          onClose={() => setConfirmId(null)}
        />
      )}

      {peekFacts === null ? null : (
        <PeekSheet
          facts={peekFacts}
          history={peekHistory}
          view={view}
          myTeamId={room.myTeamId}
          canDraft={acts.canDraft}
          submitting={acts.submitting}
          onDraft={(playerId) => {
            setPeekId(null);
            setConfirmId(playerId);
          }}
          onQueueToggle={acts.onQueueToggle}
          onNote={onNote}
          onClose={() => setPeekId(null)}
        />
      )}
      {rosterSheet}
    </div>
  );
}
