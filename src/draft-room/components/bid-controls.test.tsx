import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { AUCTION_VIEW } from "../test-fixtures";
import { BidControls } from "./bid-controls";

const open = {
  ...AUCTION_VIEW,
  minBid: 25,
  maxBids: { t1: 80, t2: 97 },
  auction: { nominatingTeamId: "t1", lot: { playerId: "qb1", highBid: 24, highBidTeamId: "t2", nominatedByTeamId: "t1", autoNominated: false } },
};

describe("BidControls", () => {
  it("states the legal range from the server's own numbers, in both themes, axe-clean", async () => {
    await inBothThemes(<BidControls view={open} myTeamId="t1" submitting={false} onBid={() => {}} />, async ({ container }) => {
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

  it("tells you why you cannot bid instead of silently disabling", () => {
    const mine = { ...open, auction: { ...open.auction, lot: { ...open.auction.lot, highBidTeamId: "t1" } } };
    const { rerender } = render(<BidControls view={mine} myTeamId="t1" submitting={false} onBid={() => {}} />);
    expect(screen.getByText("You already have the high bid.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bid" })).toBeDisabled();

    rerender(<BidControls view={{ ...open, maxBids: { t1: 10, t2: 97 } }} myTeamId="t1" submitting={false} onBid={() => {}} />);
    expect(screen.getByText("You can't afford the current bid and still fill your roster.")).toBeInTheDocument();

    rerender(<BidControls view={AUCTION_VIEW} myTeamId="t1" submitting={false} onBid={() => {}} />);
    expect(screen.getByText("Nobody is up for bid right now.")).toBeInTheDocument();

    rerender(<BidControls view={open} myTeamId={null} submitting={false} onBid={() => {}} />);
    expect(screen.getByText("You're watching this draft — you don't have a team in it.")).toBeInTheDocument();
  });
});
