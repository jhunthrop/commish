"use client";

import { useMemo, useState } from "react";
import type { Player } from "@/domain/player";
import type { DraftStateView } from "@/draft-engine";
import type { BoardReason } from "@/projections/preseason/board";
import { PositionBadge } from "@/components/ui";
import type { DraftRoom as DraftRoomState } from "../../hooks/use-draft-room";
import type { CheatSheet } from "../state/sheet";
import type { Lens } from "../state/lens";
import type { PendingPick } from "../state/pending-pick";
import { peekFactsFor } from "../lib/peek-facts";
import { teamCode } from "../lib/team-code";
import { shortName } from "./quilt-cell";
import { QuiltBoard } from "./quilt-board";
import { DrawerPoolTab } from "./drawer-pool-tab";
import { DrawerSheetTab } from "./drawer-sheet-tab";
import { DrawerPicksTab } from "./drawer-picks-tab";
import { MobileConfirmSheet } from "./mobile-confirm-sheet";
import { PeekSheet } from "./peek-sheet";
import { UndoPill } from "./undo-pill";
import { LensChips } from "./lens-chips";
import type { RoomActs } from "./room-acts";

const MOBILE_TABS = ["pool", "sheet", "board", "picks"] as const;
type MobileTab = (typeof MOBILE_TABS)[number];

const TAB_LABEL: Readonly<Record<MobileTab, string>> = { pool: "POOL", sheet: "SHEET", board: "BOARD", picks: "PICKS" };

export interface MobileRoomProps {
  readonly room: DraftRoomState;
  readonly view: DraftStateView;
  readonly playersById: ReadonlyMap<string, Player>;
  readonly myTurn: boolean;
  /** The desktop act bundle — `onDraft` here already runs the undo window. Mobile inserts the
   *  confirm sheet in front of it, so a phone pick is guarded twice. */
  readonly acts: RoomActs;
  readonly pending: PendingPick | null;
  readonly onUndo: () => void;
  readonly clockLabel: string | null;
  readonly lens: Lens;
  readonly onLens: (lens: Lens) => void;
  readonly byeWeeks: ReadonlyMap<string, number>;
  readonly reasons: ReadonlyMap<string, readonly BoardReason[]>;
  readonly boardRanks: ReadonlyMap<string, number>;
  readonly sheetRanks: ReadonlyMap<string, number>;
  readonly sheet: CheatSheet;
  readonly onSheetMove: (playerId: string, delta: number) => void;
  readonly onNote: (playerId: string, note: string) => void;
  readonly onSheetReset: () => void;
  readonly onSeedQueue: (playerIds: readonly string[]) => void;
  readonly available: ReadonlySet<string>;
}

/**
 * THE PHONE ROOM INVERTS (`MobilePool` / `MobileYourTurn` / `MobileQuilt` mocks): pool-first
 * list with big draft verbs, bottom tabs POOL / SHEET / BOARD / PICKS, the quilt demoted to the
 * BOARD tab as micro tiles with tap-to-inspect. Picking is two-step — the confirm sheet — and
 * then the same undo window desktop gets.
 */
export function MobileRoom(props: MobileRoomProps) {
  const { room, view, playersById, myTurn, acts, pending, onUndo, clockLabel } = props;
  const [tab, setTab] = useState<MobileTab>("pool");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [peekId, setPeekId] = useState<string | null>(null);

  // Two-step picking: every DRAFT on this tree opens the confirm sheet; only its CONFIRM hands
  // the pick to the undo window (`acts.onDraft`).
  const mobileActs: RoomActs = useMemo(
    () => ({ ...acts, onDraft: (playerId: string) => setConfirmId(playerId), onPeek: (playerId: string) => setPeekId(playerId) }),
    [acts],
  );

  const onClockTeam = room.teams.find((team) => team.id === view.onClockTeamId) ?? null;
  const confirmPlayer = confirmId === null ? null : (playersById.get(confirmId) ?? null);
  const peekFacts =
    peekId === null
      ? null
      : peekFactsFor(peekId, {
          playersById,
          boardRanks: props.boardRanks,
          sheetRanks: props.sheetRanks,
          sheet: props.sheet,
          byeWeeks: props.byeWeeks,
          reasons: props.reasons,
          available: props.available,
          queuedPlayerIds: acts.queuedPlayerIds,
        });

  const queueTop = room.queue.filter((playerId) => props.available.has(playerId)).slice(0, 2);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Header: amber takeover on your turn, slim red ribbon otherwise. */}
      {myTurn ? (
        <div data-testid="mobile-your-turn" className="flex flex-col gap-2 border-b-2 border-accent bg-accent-glow px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="font-display text-3xl font-bold text-accent tabular-nums">{clockLabel ?? "…"}</span>
            <span className="font-display text-md font-bold text-accent">YOUR PICK</span>
          </div>
          {queueTop.length === 0 ? null : (
            <div className="flex gap-2">
              {queueTop.map((playerId, index) => {
                const player = playersById.get(playerId);
                if (player === undefined) return null;
                return (
                  <button
                    key={playerId}
                    type="button"
                    onClick={() => setConfirmId(playerId)}
                    className={`flex min-w-0 flex-1 items-center gap-2 rounded-sm bg-surface-raised px-2.5 py-1.5 focus-visible:outline-2 focus-visible:outline-accent ${index === 0 ? "border border-accent" : ""}`}
                  >
                    <PositionBadge position={player.position} size="sm" />
                    <span className="min-w-0 truncate font-display text-sm font-semibold text-text-primary">{shortName(player.name)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3 border-b border-line bg-surface-elevated px-4 py-2">
          {view.phase === "in_progress" && onClockTeam !== null ? (
            <span className="flex items-center gap-2 rounded-sm bg-live px-2.5 py-1">
              <span className="font-display text-md font-bold text-live-text tabular-nums">{clockLabel ?? "…"}</span>
              <span className="font-display text-xs font-bold text-live-text">{teamCode(onClockTeam.name)}</span>
            </span>
          ) : (
            <span className="font-display text-sm font-semibold text-text-muted">
              {view.phase === "complete" ? "Draft complete" : "Waiting for kickoff"}
            </span>
          )}
          {tab === "board" ? <span className="ml-auto"><LensChips lens={props.lens} onChange={props.onLens} hasByes={props.byeWeeks.size > 0} /></span> : null}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-2">
        {tab === "pool" ? (
          <DrawerPoolTab
            players={room.players}
            available={props.available}
            byeWeeks={props.byeWeeks}
            reasons={props.reasons}
            focusSearch={false}
            {...mobileActs}
          />
        ) : tab === "sheet" ? (
          <DrawerSheetTab
            sheet={props.sheet}
            playersById={playersById}
            boardRanks={props.boardRanks}
            available={props.available}
            onMove={props.onSheetMove}
            onSeedQueue={props.onSeedQueue}
            onReset={props.onSheetReset}
            canDraft={acts.canDraft}
            submitting={acts.submitting}
            onDraft={mobileActs.onDraft}
            onPeek={mobileActs.onPeek}
          />
        ) : tab === "board" ? (
          <div className="flex flex-col gap-2">
            <QuiltBoard
              view={view}
              teams={room.teams}
              playersById={playersById}
              myTeamId={room.myTeamId}
              lens={props.lens}
              byeWeeks={props.byeWeeks}
              boardRanks={props.boardRanks}
              clockLabel={clockLabel}
              onPeek={mobileActs.onPeek}
              peekedPlayerId={peekId}
              microOnly
            />
            <p className="text-center text-xs text-text-faint">Tap a tile to inspect.</p>
          </div>
        ) : (
          <DrawerPicksTab view={view} teams={room.teams} playersById={playersById} myTeamId={room.myTeamId} onPeek={mobileActs.onPeek} />
        )}
      </div>

      {pending === null ? null : (
        <div className="pointer-events-none absolute bottom-16 left-1/2 z-40 -translate-x-1/2">
          <UndoPill pending={pending} player={playersById.get(pending.playerId) ?? null} onUndo={onUndo} />
        </div>
      )}

      {/* Bottom tab bar — the inversion's spine. */}
      <nav aria-label="Draft room tabs" className="flex border-t border-line bg-surface-elevated">
        {MOBILE_TABS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-pressed={tab === candidate}
            onClick={() => setTab(candidate)}
            className={`flex-1 py-3 text-center font-display text-sm font-bold tracking-wide focus-visible:outline-2 focus-visible:outline-accent ${
              tab === candidate ? "border-t-2 border-accent text-accent" : "text-text-muted"
            }`}
          >
            {TAB_LABEL[candidate]}
          </button>
        ))}
      </nav>

      {confirmPlayer === null ? null : (
        <MobileConfirmSheet
          player={confirmPlayer}
          byeWeek={props.byeWeeks.get(confirmPlayer.nflTeam) ?? null}
          sheetRank={props.sheetRanks.get(confirmPlayer.id) ?? null}
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
          view={view}
          myTeamId={room.myTeamId}
          canDraft={acts.canDraft}
          submitting={acts.submitting}
          onDraft={(playerId) => {
            setPeekId(null);
            setConfirmId(playerId);
          }}
          onQueueToggle={acts.onQueueToggle}
          onNote={props.onNote}
          onClose={() => setPeekId(null)}
        />
      )}
    </div>
  );
}
