import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChatRoomDepsProvider } from "@/chat-room/hooks/deps";
import { fixtureChatDeps } from "@/chat-room/test-fixtures";
import type { TradesPageBody } from "@/trades/contract";
import type { RoomData } from "../contract";
import { LeagueRoomDepsProvider } from "../hooks/deps";
import { HOME, LINEUP, ROOM_DATA, fixtureLeagueDeps } from "../test-fixtures";
import { RAIL_QUERY } from "../hooks/use-rail-visible";
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
      <RoomShell data={data} initialSurface={initialSurface} playoffTeams={6} regularSeasonWeeks={14} holdExpired={false} />
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
  it("deals the arrival moment as the top card on a week-1 visit, ordinary cards beneath", () => {
    const weekOne = {
      ...ATTENTION_DATA,
      home: { ...ATTENTION_DATA.home, currentWeek: 1 },
    };
    render(wrap(weekOne));
    const arrival = screen.getByTestId("draft-complete-arrival");
    expect(arrival.textContent).toContain("Your draft is in the books");
    expect(screen.getByRole("link", { name: "View the draft board" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "See the matchup" }).getAttribute("href")).toBe(
      "/app/leagues/l1/matchups/3",
    );
    // The stage still deals the lineup card, beneath the arrival.
    const fix = screen.getByRole("button", { name: "Fix lineup" });
    expect(arrival.compareDocumentPosition(fix) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the arrival moment off every later week", () => {
    render(wrap(ROOM_DATA));
    expect(screen.queryByTestId("draft-complete-arrival")).toBeNull();
  });

  it("a live Sunday still outranks the arrival moment (law 1)", () => {
    const liveWeekOne = {
      ...ROOM_DATA,
      home: { ...ROOM_DATA.home, currentWeek: 1, weekStatus: "in_progress" as const },
      week: { ...ROOM_DATA.week!, weekStatus: "in_progress" as const },
    };
    render(wrap(liveWeekOne));
    expect(screen.queryByTestId("draft-complete-arrival")).toBeNull();
    expect(screen.getByText("Yours")).toBeTruthy();
  });

  it("rests at the pulse when nothing needs the viewer — and the pulse spends the stage on the full standings", () => {
    render(wrap(ROOM_DATA));
    expect(screen.getByText("The league this week")).toBeTruthy();
    // No cards dealt, so the pulse is the room: the full standings table, not the compact teaser
    // (founder defect 2026-09-03, "the league home landing page feels empty").
    expect(screen.getByRole("heading", { name: "Standings" })).toBeTruthy();
    expect(screen.queryByText("Standings pulse")).toBeNull();
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

  // Task 10: the commissioner's own toggle for `GradeBoard`'s visibility, mounted in the rail.
  it("mounts the draft grades toggle for the commissioner once the league has drafted", () => {
    render(wrap(ROOM_DATA));
    expect(screen.getByText("Draft grades on league home")).toBeInTheDocument();
  });

  it("never mounts the draft grades toggle for an ordinary member", () => {
    render(wrap({ ...ROOM_DATA, home: { ...ROOM_DATA.home, isCommissioner: false } }));
    expect(screen.queryByText("Draft grades on league home")).not.toBeInTheDocument();
  });

  it("never mounts the draft grades toggle before the league has drafted — there is nothing yet for it to control", () => {
    render(
      wrap({
        ...ROOM_DATA,
        home: { ...HOME, draftStatus: "scheduled", draftSchedule: { ...HOME.draftSchedule!, status: "scheduled" } },
        lineup: null,
        week: null,
      }),
    );
    expect(screen.queryByText("Draft grades on league home")).not.toBeInTheDocument();
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

/**
 * Link audit, 2026-09-04 (the founder's "the invite link doesn't work from a created league
 * page"): `WaitingRoom`'s "Invite someone" links target `#invite-managers`, and the block lived
 * only in the rail — an aside that is `hidden` below `xl`, so below 1280px the click changed the
 * hash and nothing else. The anchor now mounts exactly once, where it is visible: in the rail at
 * `xl`, inline under the waiting stage below it.
 */
describe("RoomShell — the #invite-managers anchor follows the rail breakpoint", () => {
  const WAITING: RoomData = {
    ...ROOM_DATA,
    home: {
      ...HOME,
      draftStatus: "scheduled",
      draftSchedule: { ...HOME.draftSchedule!, status: "scheduled" },
    },
    lineup: null,
    week: null,
  };

  /** `use-reduced-motion.test.tsx`'s stub idiom, answering the rail query specifically —
   *  every other query (reduced motion included) reads as unmatched. */
  function stubRailQuery(matches: boolean) {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === RAIL_QUERY ? matches : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("below xl, the anchor and invite panel live inline in the waiting stage, not in the hidden rail", async () => {
    stubRailQuery(false);
    render(wrap(WAITING));
    const anchors = document.querySelectorAll("#invite-managers");
    expect(anchors).toHaveLength(1);
    expect(anchors[0]!.closest("aside")).toBeNull();
    expect(await screen.findByRole("button", { name: "Create invite link" })).toBeInTheDocument();
  });

  it("at xl, the anchor keeps its place in the rail, still exactly once", () => {
    stubRailQuery(true);
    render(wrap(WAITING));
    const anchors = document.querySelectorAll("#invite-managers");
    expect(anchors).toHaveLength(1);
    expect(anchors[0]!.closest("aside")).not.toBeNull();
  });

  it("renders no anchor at all for a non-commissioner, at either width", () => {
    stubRailQuery(false);
    render(wrap({ ...WAITING, home: { ...WAITING.home, isCommissioner: false } }));
    expect(document.querySelector("#invite-managers")).toBeNull();
  });
});
