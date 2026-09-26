"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Player } from "@/domain/player";
import type { BoardReason } from "@/projections/preseason/board";
import { useToast } from "@/components/ui";
import { useMediaQuery } from "@/design/use-media-query";
import { sharePercent } from "../advisor/format";
import { useAdvisor } from "../advisor/use-advisor";
import type { DraftRoom as DraftRoomState } from "../hooks/use-draft-room";
import { useQueueHandlers } from "../hooks/use-queue-handlers";
import { boardRanks } from "../state/pick-review";
import { RESTING, reduceCollapse } from "./state/collapse";
import { QUILT_CONFIG } from "./state/config";
import { pickLabel as pickLabelOf } from "@/domain/pick-label";
import { pickLabel } from "./state/board";
import { sheetRanks as sheetRanksOf } from "./state/sheet";
import { DEFAULT_STREAM_WIDTH, readStreamWidth, writeStreamWidth, type StreamWidth } from "./state/stream-width";
import { usePendingPick } from "./hooks/use-pending-pick";
import { usePlayerHistory, type PlayerHistoryCache } from "./hooks/use-player-history";
import { useRoomKeys } from "./hooks/use-room-keys";
import { useSheet } from "./hooks/use-sheet";
import { peekFactsFor } from "./lib/peek-facts";
import { ConnectionBanner } from "../components/connection-banner";
import { BoardRegion, type BoardView } from "./components/board-region";
import { Dock } from "./components/dock";
import { PeekSheet } from "./components/peek-sheet";
import { PhoneRoom, RESTING_PHONE, type PhoneSurface } from "./components/phone-room";
import { QuiltBoard } from "./components/quilt-board";
import type { RoomActs } from "./components/room-acts";
import { RosterSheet } from "./components/roster-sheet";
import { StreamPanel } from "./components/stream-panel";
import type { RailCall } from "./components/stream-rail";
import { TopStrip } from "./components/top-strip";
import { UndoPill } from "./components/undo-pill";
import { YourSheet } from "./components/your-sheet";

export interface QuiltRoomProps {
  readonly room: DraftRoomState;
  readonly playersById: ReadonlyMap<string, Player>;
}

// One instance each, never a fresh `new Map()` per render: these reach every memoized row and
// cell as props, and a new empty map per render is a prop change to all of them.
const NO_BYE_WEEKS: ReadonlyMap<string, number> = new Map();
const NO_REASONS: ReadonlyMap<string, readonly BoardReason[]> = new Map();
const NO_IDS: ReadonlySet<string> = new Set();

/** Where the caller picks next AFTER the current pick: the odds' basis ("still there at 3.07"). */
function nextPickLabelFor(view: DraftRoomState["view"], myTeamId: string | null, myTurn: boolean): string | null {
  if (view === null || myTeamId === null) return null;
  const teamCount = view.draftOrder.length;
  if (teamCount === 0) return null;
  const upcoming = myTurn ? view.upcoming.slice(1) : view.upcoming;
  const away = upcoming.indexOf(myTeamId);
  if (away === -1) return null;
  const pickNumber = view.pickNumber + (myTurn ? 1 : 0) + away;
  const round = Math.ceil(pickNumber / teamCount);
  return pickLabel(round, pickNumber - (round - 1) * teamCount);
}

/**
 * THE SIDELINE DRAFT ROOM (founder rulings 2026-09-10, first principles §7). One state, two
 * compositions: at desktop width the top strip, the board region (Wall or Your sheet) beside the
 * stream (open, rail or hidden, remembered per browser), and the dock with our call beside the
 * one Draft verb; on the phone the same regions in a column with the stream as the screen and
 * the call block fixed at the foot. The old six-tab drawer is gone: the pool is the dock, the
 * picks are the stream, byes are words on rows, rosters are sheets from the wall's heads.
 *
 * FLUIDITY: this root never ticks (the clock is a leaf), every object handed down keeps its
 * identity between renders, and only the composition for the current width is mounted.
 */
export function QuiltRoom({ room, playersById }: QuiltRoomProps) {
  const view = room.view!;
  const [surface, dispatch] = useReducer(reduceCollapse, RESTING);
  const [boardView, setBoardView] = useState<BoardView>("wall");
  useRoomKeys(dispatch);
  const desktop = useMediaQuery(QUILT_CONFIG.desktopStageQuery);
  // A finger has no hover: on a coarse pointer the rows' Draft shows at rest (the roots carry
  // `data-pointer`, and the reveal wrappers read it through `group-data`).
  const coarsePointer = useMediaQuery(QUILT_CONFIG.coarsePointerQuery);
  const [phone, setPhone] = useState<PhoneSurface>(RESTING_PHONE);
  const onPhone = useCallback((patch: Partial<PhoneSurface>) => setPhone((held) => ({ ...held, ...patch })), []);

  // The stream's width starts at the default on every render pass (server and first client paint
  // agree), reads the browser's memory once after mount, and writes through on every change.
  const [streamWidth, setStreamWidth] = useState<StreamWidth>(DEFAULT_STREAM_WIDTH);
  useEffect(() => {
    setStreamWidth(readStreamWidth());
  }, []);
  const onStreamWidth = useCallback((width: StreamWidth) => {
    setStreamWidth(width);
    writeStreamWidth(width);
  }, []);
  const [hiddenNew, setHiddenNew] = useState(0);

  // Affordance only: the server decides. The owed-pick allowance matches the old pool's.
  const myTurn = view.phase === "in_progress" && room.myTeamId !== null && view.onClockTeamId === room.myTeamId;
  const owesPick = room.myTeamId !== null && (view.owedPicks?.[room.myTeamId]?.length ?? 0) > 0;
  const canDraft = myTurn || owesPick;

  const { show } = useToast();
  const { submit } = room;
  const submitPick = useCallback(
    (playerId: string): void => {
      void submit({ type: "MAKE_PICK", playerId }).then((outcome) => {
        if (outcome.ok) {
          // The league speaking (review finding 3): the pick stands, the room is catching up.
          if (outcome.notice !== null) show({ message: outcome.notice, tone: "info" });
          return;
        }
        const name = playersById.get(playerId)?.name ?? "Your pick";
        show({ message: `${name} did not land. ${outcome.reason} You are still on the clock.`, tone: "error" });
      });
    },
    [submit, playersById, show],
  );
  const { pending, begin, undo } = usePendingPick(submitPick, view.deadlineAt);
  const queueHandlers = useQueueHandlers(room);
  const available = useMemo(() => new Set(view.availablePlayerIds), [view.availablePlayerIds]);
  // The advisor keys on the COMMITTED sequence (what the server computes against) and shows its
  // answer once the room has revealed that far (`useAdvisor`); the board it filters by is the
  // revealed one, so no name still hidden in a batch ever reads as drafted.
  const committedSequence = room.committed?.sequence ?? view.sequence;
  const advisorRoom = useMemo(
    () => ({ draftId: view.draftId, sequence: committedSequence, revealedSequence: view.sequence, nextRevealAtMs: room.nextRevealAtMs, availablePlayerIds: available }),
    [view.draftId, committedSequence, view.sequence, room.nextRevealAtMs, available],
  );
  const advisor = useAdvisor(advisorRoom, room.myTeamId);

  const boardIds = useMemo(() => room.players.map((player) => player.id), [room.players]);
  const { sheet, move, place, note, reset, hasServerSheet, startServerSheet } = useSheet(view.draftId, boardIds, view.leagueId);
  const ranks = useMemo(() => boardRanks(room.players), [room.players]);
  const mySheetRanks = useMemo(() => sheetRanksOf(sheet), [sheet]);
  const byeWeeks = room.byeWeeks ?? NO_BYE_WEEKS;
  const reasons = room.reasons ?? NO_REASONS;
  const myPlayerIds = useMemo(
    () => (room.myTeamId === null ? NO_IDS : new Set((view.rosters[room.myTeamId] ?? []).flatMap((slot) => (slot.playerId === null ? [] : [slot.playerId])))),
    [room.myTeamId, view.rosters],
  );
  // The odds' basis: the pick the advisor measured them at when it has one (the wire's own
  // truth), else the next upcoming turn that is yours.
  const measuredAt = advisor.view?.odds?.pickNumber ?? null;
  const nextPickLabel = useMemo(
    () => (measuredAt !== null && view.draftOrder.length > 0 ? pickLabelOf(measuredAt, view.draftOrder.length) : nextPickLabelFor(view, room.myTeamId, myTurn)),
    [measuredAt, view, room.myTeamId, myTurn],
  );

  const historyCacheRef = useRef<PlayerHistoryCache>(new Map());
  const peekedId = surface.kind === "peek" ? surface.playerId : phone.peekId;
  const peekHistory = usePlayerHistory(view.draftId, desktop ? (surface.kind === "peek" ? surface.playerId : null) : phone.peekId, historyCacheRef.current);

  const onDraft = useCallback(
    (playerId: string): void => {
      begin(playerId);
      dispatch({ type: "CLOSE_PEEK" });
    },
    [begin],
  );
  const onPeek = useCallback((playerId: string) => dispatch({ type: "OPEN_PEEK", playerId }), []);
  const onClosePeek = useCallback(() => dispatch({ type: "CLOSE_PEEK" }), []);
  const onOpenRoster = useCallback((teamId: string) => dispatch({ type: "OPEN_ROSTER", teamId }), []);
  const onCloseRoster = useCallback(() => dispatch({ type: "COLLAPSE_ALL" }), []);

  const acts: RoomActs = useMemo(
    () => ({ canDraft, submitting: room.submitting, queuedPlayerIds: queueHandlers.queuedPlayerIds, onDraft, onQueueToggle: queueHandlers.onQueueToggle, onPeek }),
    [canDraft, room.submitting, queueHandlers.queuedPlayerIds, queueHandlers.onQueueToggle, onDraft, onPeek],
  );

  const peekFacts =
    peekedId === null
      ? null
      : peekFactsFor(peekedId, { playersById, boardRanks: ranks, sheetRanks: mySheetRanks, sheet, byeWeeks, reasons, available, queuedPlayerIds: queueHandlers.queuedPlayerIds });

  const rosterTeam = surface.kind === "roster" ? (room.teams.find((team) => team.id === surface.teamId) ?? null) : null;

  // The rail's "our call": the advisor's pick when it stands, with the runs that still have him.
  const railCall: RailCall | null = useMemo(() => {
    const pick = advisor.view?.pick ?? null;
    if (pick === null) return null;
    const player = playersById.get(pick.playerId);
    if (player === undefined) return null;
    return { player, share: pick.makeItBack === null ? null : sharePercent(Math.round(pick.makeItBack.survival * pick.makeItBack.runs), pick.makeItBack.runs) };
  }, [advisor.view, playersById]);

  const tiers = advisor.view?.tiers;
  const odds = advisor.view?.odds ?? null;
  const picksIn = view.picks.length;
  const wallCaption = (
    <p className="text-xs text-text-faint">
      {picksIn === 0 ? "No picks yet" : `${picksIn} ${picksIn === 1 ? "pick" : "picks"} in`}
      {myTurn ? (
        <>
          {" · "}
          <span className="font-semibold text-text-primary">your turn</span>
        </>
      ) : null}
    </p>
  );

  const board =
    boardView === "wall" ? (
      <QuiltBoard view={view} teams={room.teams} playersById={playersById} myTeamId={room.myTeamId} onPeek={onPeek} peekedPlayerId={peekedId} onOpenRoster={onOpenRoster} openRosterTeamId={rosterTeam?.id ?? null} microOnly={!desktop} />
    ) : (
      <YourSheet
        sheet={sheet}
        boardIds={boardIds}
        playersById={playersById}
        available={available}
        myPlayerIds={myPlayerIds}
        tiers={tiers ?? EMPTY_TIERS}
        odds={odds}
        nextPickLabel={nextPickLabel}
        recomputing={advisor.recomputing}
        onMove={move}
        onPlace={place}
        onReset={reset}
        hasServerSheet={hasServerSheet}
        onStartServerSheet={startServerSheet}
        canDraft={acts.canDraft}
        submitting={acts.submitting}
        queuedPlayerIds={acts.queuedPlayerIds}
        onDraft={acts.onDraft}
        onQueueToggle={acts.onQueueToggle}
        onPeek={acts.onPeek}
      />
    );

  const rosterSheet =
    rosterTeam === null ? null : <RosterSheet view={view} team={rosterTeam} mine={rosterTeam.id === room.myTeamId} playersById={playersById} onPeek={onPeek} onClose={onCloseRoster} />;

  if (!desktop) {
    return (
      <>
        <div className="px-4">
          <ConnectionBanner connection={room.connection} />
        </div>
        <PhoneRoom
          room={room}
          view={view}
          playersById={playersById}
          myTurn={myTurn}
          acts={acts}
          pending={pending}
          onUndo={undo}
          phone={phone}
          onPhone={onPhone}
          boardView={boardView}
          board={
            <BoardRegion view={boardView} onView={setBoardView} caption={wallCaption}>
              {board}
            </BoardRegion>
          }
          peekFacts={peekFacts}
          peekHistory={peekHistory}
          onNote={note}
          byeWeeks={byeWeeks}
          sheetRanks={mySheetRanks}
          advisor={advisor}
          nextPickLabel={nextPickLabel}
          available={available}
          coarsePointer={coarsePointer}
          railCall={railCall}
          rosterSheet={rosterSheet}
        />
      </>
    );
  }

  return (
    <>
      <div className="px-4">
        <ConnectionBanner connection={room.connection} />
      </div>
      <div data-testid="quilt-room" data-pointer={coarsePointer ? "coarse" : "fine"} className="group/room flex min-h-0 flex-1 flex-col">
        <TopStrip leagueName={room.leagueName} view={view} teams={room.teams} myTeamId={room.myTeamId} myTurn={myTurn} hiddenNew={hiddenNew} onOpenStream={streamWidth === "hidden" ? () => onStreamWidth("open") : null} />
        <div className="relative flex min-h-0 flex-1 gap-3 px-3 pb-2 pt-3">
          <BoardRegion view={boardView} onView={setBoardView} caption={wallCaption}>
            {board}
          </BoardRegion>
          <StreamPanel view={view} leagueName={room.leagueName} teams={room.teams} playersById={playersById} myTeamId={room.myTeamId} width={streamWidth} onWidth={onStreamWidth} asPage={false} call={railCall} onUnread={setHiddenNew} />
          {peekFacts === null ? null : (
            <PeekSheet facts={peekFacts} history={peekHistory} view={view} myTeamId={room.myTeamId} canDraft={canDraft} submitting={room.submitting} onDraft={onDraft} onQueueToggle={queueHandlers.onQueueToggle} onNote={note} onClose={onClosePeek} />
          )}
          {pending === null ? null : (
            <div className="pointer-events-none absolute bottom-4 left-1/2 z-40 -translate-x-1/2">
              <UndoPill pending={pending} player={playersById.get(pending.playerId) ?? null} swappedFrom={pending.swappedFromPlayerId === null ? null : (playersById.get(pending.swappedFromPlayerId) ?? null)} onUndo={undo} />
            </div>
          )}
        </div>
        <div className="h-[15rem] shrink-0 px-3">
          <Dock view={view} players={room.players} playersById={playersById} myTeamId={room.myTeamId} byeWeeks={byeWeeks} queue={room.queue} advisor={advisor} nextPickLabel={nextPickLabel} available={available} withCall {...acts} />
        </div>
        {rosterSheet}
      </div>
    </>
  );
}

const EMPTY_TIERS: Readonly<Record<string, never>> = {};
