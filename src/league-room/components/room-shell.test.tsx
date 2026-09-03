import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChatRoomDepsProvider } from "@/chat-room/hooks/deps";
import { fixtureChatDeps } from "@/chat-room/test-fixtures";
import type { TradesPageBody } from "@/trades/contract";
import type { RoomData } from "../contract";
import { LeagueRoomDepsProvider } from "../hooks/deps";
import { HOME, LINEUP, ROOM_DATA, fixtureLeagueDeps } from "../test-fixtures";
import { RoomShell } from "./room-shell";

let mockPathname = "/app/leagues/l1";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));
beforeEach(() => {
  mockPathname = "/app/leagues/l1";
});

const wrap = (data: RoomData, initialSurface: Parameters<typeof RoomShell>[0]["initialSurface"] = null) => (
  <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
    <LeagueRoomDepsProvider deps={fixtureLeagueDeps().deps}>
      <RoomShell data={data} initialSurface={initialSurface} playoffTeams={6} holdExpired={false} />
    </LeagueRoomDepsProvider>
  </ChatRoomDepsProvider>
);

/** ROOM_DATA with a bye-broken WR2: the starter's team is absent from the fixture map. */
const ATTENTION_DATA: RoomData = {
  ...ROOM_DATA,
  home: { ...HOME, weekStatus: "scheduled" },
  lineup: {
    ...LINEUP,
    starters: [
      ...LINEUP.starters,
      { slot: "WR", slotIndex: 0, playerId: "wr2", playerName: "Zay Flowers", position: "WR", nflTeam: "BAL", headshotUrl: null, adp: null },
    ],
    bench: [
      { slot: "BENCH", slotIndex: 0, playerId: "wr3", playerName: "Romeo Doubs", position: "WR", nflTeam: "BUF", headshotUrl: null, adp: 90 },
    ],
  },
  projectionsByPlayerId: new Map([
    ["qb1", 21.4],
    ["rb1", 15.8],
    ["wr3", 9.8],
  ]),
};

const INBOX_TRADE: TradesPageBody = {
  leagueId: "l1",
  meTeamId: "t1",
  inbox: [
    {
      id: "trade-1",
      leagueId: "l1",
      weekNumber: 3,
      status: "open",
      proposedAt: "2026-09-14T12:00:00.000Z",
      expiresAt: "2026-09-18T21:00:00.000Z",
      settledAt: null,
      reversedAt: null,
      note: null,
      from: { teamId: "t2", teamName: "Iron Owls", assets: [{ kind: "player", playerId: "p-owl" }] },
      to: { teamId: "t1", teamName: "Bay Bandits", assets: [{ kind: "player", playerId: "qb1" }] },
    },
  ],
  outbox: [],
  history: [],
};

describe("RoomShell", () => {
  it("rests at the pulse when nothing needs the viewer", () => {
    render(wrap(ROOM_DATA));
    expect(screen.getByText("The league this week")).toBeTruthy();
    expect(screen.getByText("Standings pulse")).toBeTruthy();
    expect(screen.queryByText(/needs you/i)).toBeNull();
  });

  it("deals an attention card for an unlocked lineup problem, and its verb opens the fix sheet", () => {
    render(wrap(ATTENTION_DATA));
    expect(screen.getByText("Your WR1 slot starts a player on bye")).toBeTruthy();
    expect(screen.getByText("1 thing needs you")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fix lineup" }));
    expect(screen.getByRole("dialog", { name: "Fix your WR1" })).toBeTruthy();
  });

  it("deals a trade card whose verb opens the trade sheet", () => {
    render(wrap({ ...ATTENTION_DATA, lineup: ROOM_DATA.lineup, trades: INBOX_TRADE }));
    fireEvent.click(screen.getByRole("button", { name: "View trade" }));
    expect(screen.getByRole("dialog", { name: /Iron Owls offer a trade/ })).toBeTruthy();
  });

  it("puts the live matchup on stage while the week runs, above every card", () => {
    const live: RoomData = {
      ...ATTENTION_DATA,
      home: { ...ATTENTION_DATA.home, weekStatus: "in_progress" },
      week: { ...ROOM_DATA.week!, weekStatus: "in_progress" },
    };
    render(wrap(live));
    expect(screen.getByText("Yours")).toBeTruthy();
    expect(screen.getByText("Theirs")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Fix lineup" })).toBeNull();
  });

  it("is the waiting room before the league has drafted, with no drawer chips", () => {
    const waiting: RoomData = {
      ...ROOM_DATA,
      home: {
        ...HOME,
        draftStatus: "scheduled",
        draftSchedule: { ...HOME.draftSchedule!, status: "scheduled" },
      },
      lineup: null,
      week: null,
    };
    render(wrap(waiting));
    expect(screen.queryByRole("button", { name: "Players" })).toBeNull();
    expect(screen.queryByText("The league this week")).toBeNull();
  });

  it("space opens the drawer at half on players, esc walks it back down", () => {
    render(wrap(ROOM_DATA));
    fireEvent.keyDown(window, { key: " " });
    expect(screen.getByRole("button", { name: "Full height" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Full height" })).toBeNull();
  });

  it("slash opens the players surface with its search", () => {
    render(wrap(ROOM_DATA));
    fireEvent.keyDown(window, { key: "/" });
    expect(screen.getByRole("searchbox", { name: "Search free agents" })).toBeTruthy();
  });

  it("a chip tap opens that surface over the room, one surface at a time", () => {
    render(wrap(ROOM_DATA));
    fireEvent.click(screen.getByRole("button", { name: "Standings" }));
    expect(screen.getByRole("button", { name: "Standings" }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Trades" }));
    expect(screen.getByRole("button", { name: "Standings" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: "Trades" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("a deep-linked surface starts at full height (the route rule)", () => {
    mockPathname = "/app/leagues/l1/standings";
    render(wrap(ROOM_DATA, "standings"));
    expect(screen.getByRole("button", { name: "Back to room" })).toBeTruthy();
  });
});
