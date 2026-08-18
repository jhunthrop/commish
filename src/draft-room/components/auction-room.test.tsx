import { describe, it, expect } from "vitest";
import { screen, waitFor, act, fireEvent, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { ToastProvider } from "@/components/ui";
import { AUCTION_VIEW, fixtureDeps, renderInRoom } from "../test-fixtures";
import { DraftRoom } from "./draft-room";

const clockOf = (view: typeof AUCTION_VIEW, sequence: number) => ({
  phase: view.phase,
  sequence,
  pickNumber: view.pickNumber,
  onClockTeamId: null,
  deadlineAt: "2026-09-01T00:00:12.000Z",
  clockSeconds: 15,
  nextTightening: null,
});

function mountAuction(view = AUCTION_VIEW) {
  const fixture = fixtureDeps(view);
  const rendered = renderInRoom(
    <ToastProvider>
      <DraftRoom draftId="d1" />
    </ToastProvider>,
    fixture.deps,
  );
  return { fixture, rendered };
}

describe("AuctionRoom", () => {
  it("renders the auction layout — lot, bid controls, budgets — axe-clean", async () => {
    const { rendered } = mountAuction();
    await waitFor(() => expect(screen.getByRole("table", { name: /budgets/i })).toBeInTheDocument());
    expect(screen.getByText("Bay Bandits is choosing who goes up next.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Nominate" })[0]).toBeInTheDocument();
    expect(await axe(rendered.container)).toHaveNoViolations();
  });

  it("shows every team's remaining budget and reserve-adjusted ceiling from the server", async () => {
    mountAuction();
    await waitFor(() => expect(screen.getByRole("table", { name: /budgets/i })).toBeInTheDocument());
    // Scope to the budgets table: team names also appear in the clock banner and roster cards.
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
    await waitFor(() => expect(screen.getByText("$5")).toBeInTheDocument());

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
    await waitFor(() => expect(screen.getByText("$12")).toBeInTheDocument());
    expect(screen.getAllByText("Iron Owls").length).toBeGreaterThan(0);
  });

  it("resyncs the whole view when a bid arrives for a lot it never saw open — the missed bid war", async () => {
    const { fixture } = mountAuction();
    await waitFor(() => expect(fixture.sources).toHaveLength(1));
    const before = fixture.calls.filter((call) => call === "GET /api/drafts/d1").length;

    fixture.view = {
      ...AUCTION_VIEW,
      sequence: 7,
      onClockTeamId: null,
      auction: { nominatingTeamId: "t1", lot: { playerId: "qb1", highBid: 31, highBidTeamId: "t2", nominatedByTeamId: "t1", autoNominated: false } },
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

    await waitFor(() => expect(screen.getByText("$31")).toBeInTheDocument());
    expect(fixture.calls.filter((call) => call === "GET /api/drafts/d1")).toHaveLength(before + 1);
  });

  it("resyncs budgets when the stream skips an award", async () => {
    const { fixture } = mountAuction();
    await waitFor(() => expect(screen.getByRole("table", { name: /budgets/i })).toBeInTheDocument());

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
});
