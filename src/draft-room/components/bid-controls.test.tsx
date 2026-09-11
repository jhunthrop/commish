import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { AUCTION_VIEW } from "../test-fixtures";
import { BidControls } from "./bid-controls";

const open = {
  ...AUCTION_VIEW,
  minBid: 25,
  maxBids: { t1: 80, t2: 97 },
  auction: { minBid: 1, nominatingTeamId: "t1", lot: { playerId: "qb1", highBid: 24, highBidTeamId: "t2", nominatedByTeamId: "t1", autoNominated: false } },
};

describe("BidControls", () => {
  it("states the legal range from the server's own numbers, in both themes, axe-clean", async () => {
    await renderSurface(<BidControls view={open} myTeamId="t1" submitting={false} onBid={() => {}} />, async ({ container }) => {
      const input = screen.getByLabelText("Your bid");
      expect(input).toHaveAttribute("min", "25");
      expect(input).toHaveAttribute("max", "80");
      expect(screen.getByText("Between $25 and $80.")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("submits the typed amount", () => {
    const onBid = vi.fn();
    render(<BidControls view={open} myTeamId="t1" submitting={false} onBid={onBid} />);
    fireEvent.change(screen.getByLabelText("Your bid"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Bid" }));
    expect(onBid).toHaveBeenCalledWith(30);
  });

  it("defaults to the minimum legal bid", () => {
    render(<BidControls view={open} myTeamId="t1" submitting={false} onBid={() => {}} />);
    expect((screen.getByLabelText("Your bid") as HTMLInputElement).value).toBe("25");
  });

  it("steps the bid one tap at a time, clamped at the team's own ceiling (review R5)", () => {
    render(<BidControls view={open} myTeamId="t1" submitting={false} onBid={() => {}} />);
    const input = screen.getByLabelText("Your bid") as HTMLInputElement;
    // From the $25 floor: +$5 lands 30, +$1 lands 31 — a bid war without typing.
    fireEvent.click(screen.getByRole("button", { name: "+$5" }));
    expect(input.value).toBe("30");
    fireEvent.click(screen.getByRole("button", { name: "+$1" }));
    expect(input.value).toBe("31");
    // The ceiling is the server's own maxBid (80): stepping never overshoots it...
    for (let i = 0; i < 12; i += 1) fireEvent.click(screen.getByRole("button", { name: "+$5" }));
    expect(input.value).toBe("80");
    // ...and at the ceiling both steppers refuse, while the input stays the precision path.
    expect(screen.getByRole("button", { name: "+$1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "+$5" })).toBeDisabled();
  });

  it("steppers are blocked exactly when bidding itself is blocked (review R5)", () => {
    const mine = { ...open, auction: { ...open.auction, lot: { ...open.auction.lot, highBidTeamId: "t1" } } };
    render(<BidControls view={mine} myTeamId="t1" submitting={false} onBid={() => {}} />);
    expect(screen.getByRole("button", { name: "+$1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "+$5" })).toBeDisabled();
  });

  it("tells you why you cannot bid instead of silently disabling", () => {
    const mine = { ...open, auction: { ...open.auction, lot: { ...open.auction.lot, highBidTeamId: "t1" } } };
    const { rerender } = render(<BidControls view={mine} myTeamId="t1" submitting={false} onBid={() => {}} />);
    expect(screen.getByText("You are the high bidder.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bid" })).toBeDisabled();

    rerender(<BidControls view={{ ...open, maxBids: { t1: 10, t2: 97 } }} myTeamId="t1" submitting={false} onBid={() => {}} />);
    expect(screen.getByText("You cannot afford the current bid and still fill your roster.")).toBeInTheDocument();

    rerender(<BidControls view={AUCTION_VIEW} myTeamId="t1" submitting={false} onBid={() => {}} />);
    expect(screen.getByText("Nobody is up for bid right now.")).toBeInTheDocument();

    rerender(<BidControls view={open} myTeamId={null} submitting={false} onBid={() => {}} />);
    // Fun pass, Task 4: the second sentence restated the first as a legal fact, and both
    // carried contractions the house register (C1) does not use. A spectator needs to be told
    // once.
    expect(screen.getByText("You are watching this one. No team in it.")).toBeInTheDocument();
  });
});
