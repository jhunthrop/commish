"use client";

import { useCallback, useMemo, useReducer, useRef, useState } from "react";
import type { Player } from "@/domain/player";
import type { Law } from "@/projections/laws/types";
import type { BoardReason } from "@/projections/preseason/board";
import { useToast } from "@/components/ui";
import { useMediaQuery } from "@/design/use-media-query";
import { useAdvisor } from "../advisor/use-advisor";
import type { DraftRoom as DraftRoomState } from "../hooks/use-draft-room";
import { useQueueHandlers } from "../hooks/use-queue-handlers";
import { boardRanks } from "../state/pick-review";
import { RESTING, reduceCollapse } from "./state/collapse";
import { QUILT_CONFIG } from "./state/config";
import type { Lens } from "./state/lens";
import { sheetRanks as sheetRanksOf } from "./state/sheet";
import { usePendingPick } from "./hooks/use-pending-pick";
import { usePlayerHistory, type PlayerHistoryCache } from "./hooks/use-player-history";
import { useRoomKeys } from "./hooks/use-room-keys";
import { useSheet } from "./hooks/use-sheet";
import { peekFactsFor } from "./lib/peek-facts";
import { ConnectionBanner } from "../components/connection-banner";
import { ClockStrip } from "./components/clock-strip";
import { QuiltBoard } from "./components/quilt-board";
import { PoolDrawer } from "./components/pool-drawer";
import { PeekSheet } from "./components/peek-sheet";
import { UndoPill } from "./components/undo-pill";
import { MobileRoom, RESTING_PHONE, type PhoneSurface } from "./components/mobile-room";
import type { RoomActs } from "./components/room-acts";

export interface QuiltRoomProps {
  readonly room: DraftRoomState;
  readonly playersById: ReadonlyMap<string, Player>;
}

// One instance each, never a fresh `new Map()` per render: these reach every memoized row and
// cell as props, and a new empty map per render is a prop change to all of them.
const NO_BYE_WEEKS: ReadonlyMap<string, number> = new Map();
const NO_REASONS: ReadonlyMap<string, readonly BoardReason[]> = new Map();
const NO_LAWS: readonly Law[] = [];

/**
 * THE QUILT ROOM — the snake draft room, rebuilt to the blueprint mocks. The quilt owns the
 * stage; the clock strip, the drawer and the peek borrow space and give it back, one at a time
 * (`reduceCollapse` is that law as a data structure). The caller's roster lives in the drawer's
 * own ROSTER tab (founder ruling 2026-09-03 — the left-edge spine is retired, the board takes
 * the width). Desktop and phone are two compositions over the same state: at phone widths the
 * room INVERTS — pool first, the quilt demoted to the BOARD tab — because a 390pt screen drafts
 * from a list, not a grid.
 *
 * FLUIDITY ROUND (founder report 2026-09-10): this root no longer ticks. The running clock is a
 * leaf (`CountdownLabel`) wherever digits show, so a second passing re-renders digits and
 * nothing else; every object handed down (`acts`, `lensChips`, the empty fallbacks) keeps its
 * identity between renders so the memoized strip, board and drawer skip work they have no part
 * in; and only the composition for the current width is mounted — the phone tree used to render
 * hidden beneath the desktop one, doubling every drawer row on every commit.
 */
export function QuiltRoom({ room, playersById }: QuiltRoomProps) {
  const view = room.view!;
  const [surface, dispatch] = useReducer(reduceCollapse, RESTING);
  const [lens, setLens] = useState<Lens>("picks");
  useRoomKeys(dispatch);
  const desktop = useMediaQuery(QUILT_CONFIG.desktopStageQuery);
  // The phone composition's tab, confirm sheet and peek live HERE, so a window crossing the
  // breakpoint (which swaps the mounted composition) never drops a confirmation mid-resize.
  const [phone, setPhone] = useState<PhoneSurface>(RESTING_PHONE);
  const onPhone = useCallback((patch: Partial<PhoneSurface>) => setPhone((held) => ({ ...held, ...patch })), []);

  // Affordance only — the server decides. Task 5's owed-pick allowance matches the old pool's.
  const myTurn = view.phase === "in_progress" && room.myTeamId !== null && view.onClockTeamId === room.myTeamId;
  const owesPick = room.myTeamId !== null && (view.owedPicks?.[room.myTeamId]?.length ?? 0) > 0;
  const canDraft = myTurn || owesPick;

  /**
   * The window's own submit, with the window's own rejection words (whole-branch review,
   * MEDIUM 3): a pick that fails AFTER its undo window closed rejects out of nowhere — seconds
   * after the tap, from a surface that may already be gone — so the generic act toast ("It's
   * not your turn") is not enough story. This names the player, quotes the reducer's reason,
   * and says the turn is still live. Wired HERE, at the submit the flush/expiry path fires,
   * never in the generic act wrapper.
   */
  const { show } = useToast();
  const { submit } = room;
  const submitPick = useCallback(
    (playerId: string): void => {
      void submit({ type: "MAKE_PICK", playerId }).then((outcome) => {
        if (outcome.ok) return;
        const name = playersById.get(playerId)?.name ?? "Your pick";
        show({ message: `${name} did not land. ${outcome.reason} You are still on the clock.`, tone: "error" });
      });
    },
    [submit, playersById, show],
  );
  const { pending, begin, undo } = usePendingPick(submitPick, view.deadlineAt);
  const queueHandlers = useQueueHandlers(room);
  const available = useMemo(() => new Set(view.availablePlayerIds), [view.availablePlayerIds]);
  // ONE advisor fetch per room (simplification round): the Assistant tab's card and the odds
  // column on every list read the same view, recomputed on every applied action, and shown only
  // for players still on this board (`presentView`, the wrong-people guard).
  const advisorRoom = useMemo(() => ({ draftId: view.draftId, sequence: view.sequence, availablePlayerIds: available }), [view.draftId, view.sequence, available]);
  const advisor = useAdvisor(advisorRoom, room.myTeamId);

  const boardIds = useMemo(() => room.players.map((player) => player.id), [room.players]);
  const { sheet, move, note, reset, hasServerSheet, startServerSheet } = useSheet(view.draftId, boardIds, view.leagueId);
  const ranks = useMemo(() => boardRanks(room.players), [room.players]);
  const mySheetRanks = useMemo(() => sheetRanksOf(sheet), [sheet]);
  const byeWeeks = room.byeWeeks ?? NO_BYE_WEEKS;
  const reasons = room.reasons ?? NO_REASONS;
  const laws = room.laws ?? NO_LAWS;

  // The season-history cache lives for the room, shared by both trees — a player peeked on the
  // phone is already warm on the desktop and vice versa.
  const historyCacheRef = useRef<PlayerHistoryCache>(new Map());
  const peekHistory = usePlayerHistory(view.draftId, surface.kind === "peek" ? surface.playerId : null, historyCacheRef.current);

  const onDraft = useCallback(
    (playerId: string): void => {
      begin(playerId);
      dispatch({ type: "CLOSE_PEEK" });
    },
    [begin],
  );
  const onPeek = useCallback((playerId: string) => dispatch({ type: "OPEN_PEEK", playerId }), []);
  const onClosePeek = useCallback(() => dispatch({ type: "CLOSE_PEEK" }), []);

  const acts: RoomActs = useMemo(
    () => ({
      canDraft,
      submitting: room.submitting,
      queuedPlayerIds: queueHandlers.queuedPlayerIds,
      onDraft,
      onQueueToggle: queueHandlers.onQueueToggle,
      onPeek,
    }),
    [canDraft, room.submitting, queueHandlers.queuedPlayerIds, queueHandlers.onQueueToggle, onDraft, onPeek],
  );

  const peekFacts =
    surface.kind === "peek"
      ? peekFactsFor(surface.playerId, {
          playersById,
          boardRanks: ranks,
          sheetRanks: mySheetRanks,
          sheet,
          byeWeeks,
          reasons,
          available,
          queuedPlayerIds: queueHandlers.queuedPlayerIds,
        })
      : null;

  const { onQueueChange } = queueHandlers;
  const seedQueue = useCallback((playerIds: readonly string[]) => onQueueChange(playerIds), [onQueueChange]);

  const hasByes = byeWeeks.size > 0;
  const lensChips = useMemo(() => ({ lens, onChange: setLens, hasByes }), [lens, hasByes]);

  if (!desktop) {
    return (
      <>
        <div className="px-4">
          <ConnectionBanner connection={room.connection} />
        </div>
        {/* PHONE: the inversion — pool-first, the quilt as the BOARD tab. */}
        <div className="flex min-h-0 flex-1 flex-col">
          <MobileRoom
            room={room}
            view={view}
            historyCache={historyCacheRef.current}
            playersById={playersById}
            myTurn={myTurn}
            acts={acts}
            pending={pending}
            onUndo={undo}
            phone={phone}
            onPhone={onPhone}
            lens={lens}
            onLens={setLens}
            byeWeeks={byeWeeks}
            reasons={reasons}
            laws={laws}
            boardRanks={ranks}
            sheetRanks={mySheetRanks}
            sheet={sheet}
            onSheetMove={move}
            onNote={note}
            onSheetReset={reset}
            onSeedQueue={seedQueue}
            available={available}
            hasServerSheet={hasServerSheet}
            onStartServerSheet={startServerSheet}
            advisor={advisor}
          />
        </div>
      </>
    );
  }

  return (
    <>
      {/* One aria-live connection region — quiet while live, loud when not. */}
      <div className="px-4">
        <ConnectionBanner connection={room.connection} />
      </div>
      {/* DESKTOP: the quilt owns the stage. */}
      <div data-testid="quilt-room" className="flex min-h-0 flex-1 flex-col">
        <ClockStrip
          view={view}
          teams={room.teams}
          playersById={playersById}
          myTeamId={room.myTeamId}
          queue={room.queue}
          myTurn={myTurn}
          submitting={room.submitting}
          onDraft={onDraft}
          lensChips={lensChips}
        />
        <div className="relative flex min-h-0 flex-1">
          <div className={`min-h-0 flex-1 flex-col p-3 ${surface.kind === "drawer" && surface.height === "full" ? "hidden" : "flex"}`}>
            <QuiltBoard
              view={view}
              teams={room.teams}
              playersById={playersById}
              myTeamId={room.myTeamId}
              lens={lens}
              byeWeeks={byeWeeks}
              boardRanks={ranks}
              onPeek={onPeek}
              peekedPlayerId={surface.kind === "peek" ? surface.playerId : null}
            />
          </div>
          {peekFacts === null ? null : (
            <PeekSheet
              facts={peekFacts}
              history={peekHistory}
              view={view}
              myTeamId={room.myTeamId}
              canDraft={canDraft}
              submitting={room.submitting}
              onDraft={onDraft}
              onQueueToggle={queueHandlers.onQueueToggle}
              onNote={note}
              onClose={onClosePeek}
            />
          )}
          {pending === null ? null : (
            <div className="pointer-events-none absolute bottom-4 left-1/2 z-40 -translate-x-1/2">
              <UndoPill
                pending={pending}
                player={playersById.get(pending.playerId) ?? null}
                swappedFrom={pending.swappedFromPlayerId === null ? null : (playersById.get(pending.swappedFromPlayerId) ?? null)}
                onUndo={undo}
              />
            </div>
          )}
        </div>
        <PoolDrawer
          surface={surface}
          dispatch={dispatch}
          view={view}
          teams={room.teams}
          players={room.players}
          playersById={playersById}
          myTeamId={room.myTeamId}
          byeWeeks={byeWeeks}
          reasons={reasons}
          laws={laws}
          boardRanks={ranks}
          sheet={sheet}
          onSheetMove={move}
          onSheetReset={reset}
          onSeedQueue={seedQueue}
          hasServerSheet={hasServerSheet}
          onStartServerSheet={startServerSheet}
          queue={room.queue}
          advisor={advisor}
          {...acts}
        />
      </div>
    </>
  );
}
