import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ChatRoomDepsProvider } from "@/chat-room/hooks/deps";
import { fixtureChatDeps } from "@/chat-room/test-fixtures";
import { HOME, MATCHUP, ROOM_DATA } from "../test-fixtures";
import type { LineupFixPlan } from "../lib/lineup-problems";
import { RoomFront, type RoomFrontProps } from "./room-front";

const PLAN: LineupFixPlan = {
  problem: { slot: "WR", slotIndex: 0, reason: "bye", severity: 2, playerId: "wr2", playerName: "Zay Flowers", position: "WR" },
  candidates: [],
  hasProjections: true,
  totalBefore: null,
  totalAfter: null,
};

function props(overrides: Partial<RoomFrontProps> = {}): RoomFrontProps {
  return {
    home: HOME,
    lineup: ROOM_DATA.lineup,
    week: ROOM_DATA.week,
    regularSeasonWeeks: 14,
    plans: [],
    inboxTrades: [],
    tradeContext: ROOM_DATA.tradeContext,
    pendingClaims: [],
    myMatchupDetail: MATCHUP,
    projectionsByPlayerId: new Map(),
    activityRows: [],
    grades: [],
    gradesBasis: "",
    present: new Set(["u1", "u2"]),
    onFixLineup: vi.fn(),
    onViewTrade: vi.fn(),
    ...overrides,
  };
}

function wrap(ui: React.ReactElement) {
  return <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>{ui}</ChatRoomDepsProvider>;
}

describe("RoomFront", () => {
  it("opens on your rival, who is here, and the stream, with the composer one tap away (P5, P6, P12)", async () => {
    render(wrap(<RoomFront {...props()} />));
    expect(screen.getByRole("region", { name: "Your game this week" })).toBeInTheDocument();
    expect(screen.getByText("Jordan is here.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Message")).toBeInTheDocument());
    // Nothing needs the manager, so the page carries no verb card and Send is the act.
    expect(screen.queryByTestId("moment-verb")).toBeNull();
    expect(screen.getByRole("button", { name: "Send" }).className).toContain("bg-accent");
  });

  it("carries exactly one solid button when something needs you, and it is the moment's verb (P3)", async () => {
    const onFixLineup = vi.fn();
    render(wrap(<RoomFront {...props({ plans: [PLAN], onFixLineup })} />));
    const verb = screen.getByRole("button", { name: "Set your lineup" });
    expect(verb.className).toContain("bg-accent");
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument());
    const solids = screen.getAllByRole("button").filter((button) => button.className.includes("bg-accent"));
    expect(solids).toHaveLength(1);
    fireEvent.click(verb);
    expect(onFixLineup).toHaveBeenCalledWith(PLAN);
  });

  it("keeps the arrival moment on a week-1 visit above the stream", () => {
    render(wrap(<RoomFront {...props({ home: { ...HOME, currentWeek: 1 } })} />));
    expect(screen.getByTestId("draft-complete-arrival")).toBeInTheDocument();
  });

  it("makes no presence claim when the store confirmed nobody, not even you", () => {
    render(wrap(<RoomFront {...props({ present: new Set() })} />));
    expect(screen.queryByTestId("who-is-here")).toBeNull();
  });
});
