import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ProofStats } from "@/matchmaking/contract";
import { proofPhrases, TrustFacts } from "./trust-facts";

const EMPTY_STATS: ProofStats = { leaguesFilled: null, roomsFillingNow: null, rating: null, tightestRoomSeatsRemaining: null, any: false };
const FULL_STATS: ProofStats = { leaguesFilled: 247, roomsFillingNow: 12, rating: { average: 4.8, count: 63 }, tightestRoomSeatsRemaining: 1, any: true };

describe("TrustFacts (the stranger's three questions, in facts)", () => {
  it("answers who runs it, what it costs, and the practice door — the free season claims no wallet", () => {
    render(<TrustFacts stats={EMPTY_STATS} signedIn={false} live={false} />);
    expect(screen.getByText(/No commissioner's cousin settles disputes/)).toBeInTheDocument();
    expect(screen.getByText("What it costs")).toBeInTheDocument();
    expect(screen.getByText(/Every league is free this season\. No buy-ins/)).toBeInTheDocument();
    expect(screen.queryByText(/wallet/)).not.toBeInTheDocument();
    // The practice door, with the honest signed-out label.
    expect(screen.getByRole("link", { name: "Sign up and try a mock draft" })).toBeInTheDocument();
  });

  it("says where money lives once money is live — the wallet machinery that exists behind the switch", () => {
    render(<TrustFacts stats={EMPTY_STATS} signedIn live />);
    expect(screen.getByText("Where money lives")).toBeInTheDocument();
    expect(screen.getByText(/buy-in sits in your wallet until the draft fires/)).toBeInTheDocument();
    expect(screen.queryByText("What it costs")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Try a mock draft" })).toBeInTheDocument();
  });

  it("renders no proof line at all when nothing has earned it — null is absent, never a zero", () => {
    render(<TrustFacts stats={EMPTY_STATS} signedIn={false} live={false} />);
    expect(screen.queryByTestId("proof-line")).not.toBeInTheDocument();
  });

  it("renders exactly the earned phrases once the floors clear, and never the rating cell", () => {
    render(<TrustFacts stats={FULL_STATS} signedIn={false} live={false} />);
    expect(screen.getByTestId("proof-line").textContent).toBe("247 leagues filled this season · 12 rooms filling right now");
  });

  it("keeps each phrase independent — one earned number renders alone", () => {
    expect(proofPhrases({ ...EMPTY_STATS, roomsFillingNow: 3 })).toEqual(["3 rooms filling right now"]);
    expect(proofPhrases({ ...EMPTY_STATS, leaguesFilled: 30 })).toEqual(["30 leagues filled this season"]);
  });
});
