import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DraftRoom as DraftRoomState } from "../../hooks/use-draft-room";
import type { RoomActs } from "./room-acts";
import { PLAYERS, SNAKE_VIEW, playersById } from "../../test-fixtures";
import { seedSheet } from "../state/sheet";
import { MobileRoom } from "./mobile-room";

// The tab bar is the only thing under test here (finding 4: the six-tab row's own fit at
// 390px) — every tab's content beyond POOL (the default) needs its own deps this suite has no
// reason to build, so the room's advisor is the "nothing loaded yet" shape every other
// advisor-tab test starts from, and every act is a no-op.
const NO_ADVISOR = { view: null, prePickView: null, recomputing: false, error: null };

function room(over: Partial<DraftRoomState> = {}): DraftRoomState {
  return {
    status: "ready",
    error: null,
    view: SNAKE_VIEW,
    players: PLAYERS,
    reasons: new Map(),
    laws: [],
    byeWeeks: new Map(),
    teams: [],
    leagueName: "Sunday Money",
    myTeamId: "t1",
    isCommissioner: false,
    connection: "live",
    pendingPlayerId: null,
    submitting: false,
    lastPick: null,
    queue: [],
    nudge: null,
    mock: null,
    waiting: null,
    submit: vi.fn(),
    refresh: vi.fn(),
    setQueue: vi.fn(),
    ...over,
  };
}

const ACTS: RoomActs = {
  canDraft: false,
  submitting: false,
  queuedPlayerIds: new Set(),
  onDraft: vi.fn(),
  onQueueToggle: vi.fn(),
  onPeek: vi.fn(),
};

function renderMobileRoom(over: Partial<DraftRoomState> = {}) {
  const roomState = room(over);
  return render(
    <MobileRoom
      room={roomState}
      view={SNAKE_VIEW}
      playersById={playersById()}
      myTurn={false}
      acts={ACTS}
      pending={null}
      onUndo={vi.fn()}
      clockLabel={null}
      lens="picks"
      onLens={vi.fn()}
      byeWeeks={new Map()}
      reasons={new Map()}
      laws={[]}
      boardRanks={new Map()}
      sheetRanks={new Map()}
      sheet={seedSheet(PLAYERS.map((player) => player.id))}
      onSheetMove={vi.fn()}
      onNote={vi.fn()}
      onSheetReset={vi.fn()}
      onSeedQueue={vi.fn()}
      available={new Set(PLAYERS.map((player) => player.id))}
      hasServerSheet={false}
      onStartServerSheet={vi.fn()}
      historyCache={new Map()}
      advisor={NO_ADVISOR}
    />,
  );
}

describe("MobileRoom's bottom tab bar", () => {
  /** Pinned exactly, so a future relabel has to update this test rather than silently drift back
   *  over the 390px budget the ASSIST fix exists for (see `TAB_LABEL`'s own docblock for the
   *  arithmetic: 390 / 6 = 65px per tab, ~8.7px per glyph at this row's font, so no label may run
   *  past 6 characters). */
  it("labels all six tabs within the six-character budget the row's own math allows", () => {
    renderMobileRoom();
    const nav = screen.getByRole("navigation", { name: "Draft room tabs" });
    const labels = [...nav.querySelectorAll("button")].map((button) => button.textContent);
    expect(labels).toEqual(["POOL", "ASSIST", "SHEET", "ROSTER", "BOARD", "PICKS"]);
    for (const label of labels) {
      expect(label!.length).toBeLessThanOrEqual(6);
    }
  });

  it("hides the ROSTER tab for a teamless caller, the same gating the desktop handles apply", () => {
    renderMobileRoom({ myTeamId: null });
    const nav = screen.getByRole("navigation", { name: "Draft room tabs" });
    const labels = [...nav.querySelectorAll("button")].map((button) => button.textContent);
    expect(labels).toEqual(["POOL", "ASSIST", "SHEET", "BOARD", "PICKS"]);
  });
});
