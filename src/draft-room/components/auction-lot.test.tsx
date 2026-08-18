import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { DraftStateView } from "@/draft-engine";
import { inBothThemes } from "@/components/ui/test-utils";
import { AUCTION_VIEW, PLAYERS, TEAMS, playersById } from "../test-fixtures";
import { AuctionLotPanel } from "./auction-lot";

/** Relative deadline for the same reason `clock-banner.test.tsx` uses one: axe and fake timers deadlock. */
const withLot: DraftStateView = {
  ...AUCTION_VIEW,
  onClockTeamId: null,
  deadlineAt: new Date(Date.now() + 12_000).toISOString(),
  clockSeconds: 15,
  auction: { nominatingTeamId: "t1", lot: { playerId: "qb1", highBid: 24, highBidTeamId: "t2", nominatedByTeamId: "t1", autoNominated: false } },
};

describe("AuctionLotPanel", () => {
  it("shows the player up for bid, the high bid and bidder, and the time left — both themes, axe-clean", async () => {
    await inBothThemes(<AuctionLotPanel view={withLot} teams={TEAMS} playersById={playersById(PLAYERS)} />, async ({ container }) => {
      expect(screen.getByText("Jalen Croft")).toBeInTheDocument();
      expect(screen.getByText("$24")).toBeInTheDocument();
      expect(screen.getByText("Iron Owls")).toBeInTheDocument();
      expect(screen.getByTestId("lot-countdown")).toHaveTextContent("0:12");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("says who everyone is waiting on between lots", () => {
    render(<AuctionLotPanel view={AUCTION_VIEW} teams={TEAMS} playersById={playersById(PLAYERS)} />);
    expect(screen.getByText("Bay Bandits is choosing who goes up next.")).toBeInTheDocument();
  });

  it("flags a lot the clock nominated", () => {
    // Non-null asserted: `withLot.auction` is set explicitly above, TypeScript just can't see
    // that through the spread — fixed minimally rather than widening `DraftStateView`.
    const auto: DraftStateView = { ...withLot, auction: { ...withLot.auction!, lot: { ...withLot.auction!.lot!, autoNominated: true } } };
    render(<AuctionLotPanel view={auto} teams={TEAMS} playersById={playersById(PLAYERS)} />);
    expect(screen.getByText("Auto-nominated")).toBeInTheDocument();
  });
});
