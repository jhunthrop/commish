import { describe, it, expect } from "vitest";
import { screen, waitFor, act, fireEvent, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { ToastProvider } from "@/components/ui";
import { inBothThemes } from "@/components/ui/test-utils";
import { ChatRoomDepsProvider } from "@/chat-room/hooks/deps";
import { fixtureChatDeps } from "@/chat-room/test-fixtures";
import { AUCTION_VIEW, fixtureDeps, renderInRoom, type FixtureDeps } from "../test-fixtures";
import { DraftRoomDepsProvider, type DraftRoomDeps } from "../hooks/deps";
import { DraftRoom } from "./draft-room";

const clockOf = (view: typeof AUCTION_VIEW, sequence: number) => ({
  phase: view.phase,
  sequence,
  pickNumber: view.pickNumber,
  onClockTeamId: null,
  deadlineAt: "2026-09-01T00:00:12.000Z",
  clockSeconds: 15,
  nextTightening: null,
  upcoming: view.upcoming,
});

function mountAuction(view = AUCTION_VIEW) {
  const fixture = fixtureDeps(view);
  const rendered = renderInRoom(
    <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
      <ToastProvider>
        <DraftRoom draftId="d1" dismissedAt="2026-01-01T00:00:00.000Z" />
      </ToastProvider>
    </ChatRoomDepsProvider>,
    fixture.deps,
  );
  return { fixture, rendered };
}

/**
 * `fixtureDeps`'s `calls` log records method + URL only. The queue tests below care about
 * WHAT was queued, so this wraps `fetchJson` to also capture each `POST /queue` body's
 * `playerIds` — without duplicating `fixtureDeps`'s own response-selection logic.
 */
function withQueueBodyCapture(deps: DraftRoomDeps): { readonly deps: DraftRoomDeps; readonly bodies: (readonly string[])[] } {
  const bodies: (readonly string[])[] = [];
  const inner = deps.fetchJson;
  return {
    bodies,
    deps: {
      ...deps,
      fetchJson: async (url, init) => {
        if (url.endsWith("/queue") && init?.method === "POST") {
          bodies.push((JSON.parse(String(init.body)) as { playerIds: readonly string[] }).playerIds);
        }
        return inner(url, init);
      },
    },
  };
}

function mountAuctionWithQueue(over: Partial<Pick<FixtureDeps, "queue" | "queueResponse">> = {}) {
  const fixture = fixtureDeps(AUCTION_VIEW);
  Object.assign(fixture, over);
  const capture = withQueueBodyCapture(fixture.deps);
  renderInRoom(
    <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
      <ToastProvider>
        <DraftRoom draftId="d1" dismissedAt="2026-01-01T00:00:00.000Z" />
      </ToastProvider>
    </ChatRoomDepsProvider>,
    capture.deps,
  );
  return { fixture, bodies: capture.bodies };
}

describe("AuctionRoom", () => {
  it("renders the auction layout — rail lot, left pool, budgets, dock — both themes, axe-clean", async () => {
    // `inBothThemes` does the render itself (once per theme), so the fixture's deps are wired
    // up through the same provider `renderInRoom`/`mountAuction` use elsewhere in this file —
    // the room still exercises the real loading → ready flow, in both themes.
    const fixture = fixtureDeps(AUCTION_VIEW);
    await inBothThemes(
      <DraftRoomDepsProvider deps={fixture.deps}>
        <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
          <ToastProvider>
            <DraftRoom draftId="d1" dismissedAt="2026-01-01T00:00:00.000Z" />
          </ToastProvider>
        </ChatRoomDepsProvider>
      </DraftRoomDepsProvider>,
      async ({ container }) => {
        await waitFor(() => expect(screen.getByRole("table", { name: /budgets/i })).toBeInTheDocument());
        // Between lots the rail names the nominator; the lot panel it replaced is gone.
        expect(screen.getByText("Bay Bandits is nominating.")).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: "Nominate" })[0]).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("shows every team's remaining budget and reserve-adjusted ceiling from the server", async () => {
    mountAuction();
    await waitFor(() => expect(screen.getByRole("table", { name: /budgets/i })).toBeInTheDocument());
    // Scope to the budgets table: team names also appear in the room header and roster cards.
    const table = screen.getByRole("table", { name: /budgets/i });
    const row = within(table).getByText("Bay Bandits").closest("tr")!;
    expect(row).toHaveTextContent("$100");
    expect(row).toHaveTextContent("$97");
  });

  it("follows a live bid war over the stream", async () => {
    const { fixture } = mountAuction();
    await waitFor(() => expect(fixture.sources).toHaveLength(1));

    act(() =>
      fixture.sources[0]!.emit("draft.nominate", {
        draftId: "d1",
        clock: clockOf(AUCTION_VIEW, 2),
        teamId: "t1",
        playerId: "qb1",
        openingBid: 5,
        auto: false,
        minBid: 6,
      }),
    );
    // The lot has exactly one home now: the rail. The dock becomes the bid console.
    await waitFor(() => expect(screen.getByTestId("room-rail")).toHaveTextContent("Jalen Croft · $5"));
    expect(screen.getByTestId("room-dock")).toHaveAttribute("data-mode", "bidding");
    expect(screen.getByTestId("bid-console")).toBeInTheDocument();

    act(() =>
      fixture.sources[0]!.emit("draft.bid", {
        draftId: "d1",
        clock: clockOf(AUCTION_VIEW, 3),
        teamId: "t2",
        playerId: "qb1",
        amount: 12,
        minBid: 13,
      }),
    );
    await waitFor(() => expect(screen.getByTestId("room-rail")).toHaveTextContent("Jalen Croft · $12"));
    expect(screen.getByText("Bidding is open on Jalen Croft. High bid $12 by Iron Owls.")).toBeInTheDocument();
  });

  it("resyncs the whole view when a bid arrives for a lot it never saw open — the missed bid war", async () => {
    const { fixture } = mountAuction();
    await waitFor(() => expect(fixture.sources).toHaveLength(1));
    const before = fixture.calls.filter((call) => call === "GET /api/drafts/d1").length;

    fixture.view = {
      ...AUCTION_VIEW,
      sequence: 7,
      onClockTeamId: null,
      auction: { minBid: 1, nominatingTeamId: "t1", lot: { playerId: "qb1", highBid: 31, highBidTeamId: "t2", nominatedByTeamId: "t1", autoNominated: false } },
    };
    // Sequence 2 is the very next one, so this is NOT a gap — it resyncs purely because a bid
    // arrived for a lot this client never saw open, which is the missed-bid-war case.
    act(() =>
      fixture.sources[0]!.emit("draft.bid", {
        draftId: "d1",
        clock: clockOf(AUCTION_VIEW, 2),
        teamId: "t2",
        playerId: "qb1",
        amount: 31,
        minBid: 32,
      }),
    );

    await waitFor(() => expect(screen.getByTestId("room-rail")).toHaveTextContent("Jalen Croft · $31"));
    expect(fixture.calls.filter((call) => call === "GET /api/drafts/d1")).toHaveLength(before + 1);
  });

  it("resyncs budgets when the stream skips an award", async () => {
    const { fixture } = mountAuction();
    await waitFor(() => expect(screen.getByRole("table", { name: /budgets/i })).toBeInTheDocument());
    // The stream opens on a LATER effect pass than the one that paints the snapshot (the
    // subscription waits on `leagueId`), so the table being on screen is not proof the
    // EventSource exists yet. Wait for the source itself, as every other stream test here does.
    await waitFor(() => expect(fixture.sources).toHaveLength(1));

    fixture.view = { ...AUCTION_VIEW, sequence: 11, budgets: { t1: 63, t2: 100 }, maxBids: { t1: 61, t2: 97 } };
    act(() =>
      fixture.sources[0]!.emit("draft.pick", {
        draftId: "d1",
        clock: clockOf(AUCTION_VIEW, 11),
        pickNumber: 1,
        round: 1,
        teamId: "t1",
        playerId: "qb1",
        slot: "QB",
        slotIndex: 0,
        price: 37,
        timestamp: "2026-09-01T00:05:00.000Z",
        auto: false,
      }),
    );

    await waitFor(() => {
      const table = screen.getByRole("table", { name: /budgets/i });
      expect(within(table).getByText("Bay Bandits").closest("tr")).toHaveTextContent("$63");
    });
  });

  it("nominates through a modal so the opening bid is a deliberate choice", async () => {
    const { fixture } = mountAuction();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Nominate" })[0]).toBeEnabled());
    fireEvent.click(screen.getAllByRole("button", { name: "Nominate" })[0]!);

    const dialog = screen.getByRole("dialog", { name: "Nominate Jalen Croft" });
    expect(dialog).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Opening bid"), { target: { value: "7" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Nominate for $7" }));
    });
    expect(fixture.calls).toContain("POST /api/drafts/d1/actions");
  });

  it("shows the moderator's nudge for my own team, and not for a rival's", async () => {
    const { fixture } = mountAuction();
    await waitFor(() => expect(fixture.sources).toHaveLength(1));

    act(() =>
      fixture.sources[0]!.emit("draft.nudge", {
        draftId: "d1",
        clock: clockOf(AUCTION_VIEW, AUCTION_VIEW.sequence),
        teamId: "t2",
        message: "Not for you.",
      }),
    );
    expect(screen.queryByText("Not for you.")).toBeNull();

    act(() =>
      fixture.sources[0]!.emit("draft.nudge", {
        draftId: "d1",
        clock: clockOf(AUCTION_VIEW, AUCTION_VIEW.sequence),
        teamId: "t1",
        message: "You're up.",
      }),
    );
    await waitFor(() => expect(screen.getByText("You're up.")).toBeInTheDocument());
  });

  it("queues a player from the pool, appending it to the request room.setQueue sends", async () => {
    const { bodies } = mountAuctionWithQueue();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Nominate" })[0]).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Queue Jalen Croft" }));
    await waitFor(() => expect(bodies).toContainEqual(["qb1"]));
  });

  it("reorders the queue through the dock's own chips, wired to room.setQueue", async () => {
    const { bodies } = mountAuctionWithQueue({ queue: ["rb1", "qb1"] });
    await waitFor(() => expect(screen.getByRole("button", { name: "Move Jalen Croft up" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Move Jalen Croft up" }));
    await waitFor(() => expect(bodies).toContainEqual(["qb1", "rb1"]));
  });

  it("toasts the reducer's reason when a queue change is rejected", async () => {
    mountAuctionWithQueue({ queueResponse: { ok: false, error: "A queue can hold at most 50 players." } });
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Nominate" })[0]).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Queue Jalen Croft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A queue can hold at most 50 players.");
  });
});
