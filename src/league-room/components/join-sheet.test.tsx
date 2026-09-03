import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SEAT_HOLD } from "@/matchmaking/seat-hold";
import { SIT_AND_GO_GRACE_MINUTES } from "@/matchmaking/config";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { PUBLIC_LEAGUES, renderInLeague } from "@/league-room/test-fixtures";
import type { LeagueRoomDeps } from "@/league-room/hooks/deps";
import { JoinSheet, lobbyJoinFacts } from "./join-sheet";

// `OpenLeagueCta`'s signed-in branch renders `JoinPublicLeagueButton`, which calls `useRouter()`.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const FREE_LEAGUE: PublicLeagueSummary = {
  ...PUBLIC_LEAGUES[0]!,
  id: "sheet_free",
  name: "Sheet Free League",
  experienceTier: "experienced",
  teamCount: 12,
  filledTeams: 8,
  heldSeats: 1,
  startTrigger: "when_full",
};

/** A paid league as only a live-money world could store one — real fee, real stored table. */
const PAID_LEAGUE: PublicLeagueSummary = {
  ...FREE_LEAGUE,
  id: "sheet_paid",
  name: "Sheet Paid League",
  entryFeeCents: 5000,
  payoutTable: [
    { place: 1, amountCents: 30000 },
    { place: 2, amountCents: 20000 },
    { place: 3, amountCents: 10000 },
  ],
};

describe("lobbyJoinFacts (both money states, by injection)", () => {
  it("renders no money cells at all while money is dark — the free season fabricates no dollar", () => {
    const facts = lobbyJoinFacts(FREE_LEAGUE, false, false);
    expect(facts.cells.map((cell) => cell.label)).toEqual(["The draft", "Seats"]);
  });

  it("renders buy-in and the STORED table's pot once money is live", () => {
    const facts = lobbyJoinFacts(PAID_LEAGUE, false, true);
    expect(facts.cells.map((cell) => cell.label)).toEqual(["Buy-in", "The pot", "The draft", "Seats"]);
    const pot = facts.cells.find((cell) => cell.label === "The pot");
    expect(pot?.value).toBe("$600.00"); // prizePotCents of the stored table, never fee × seats
    expect(pot?.note).toBe("pays $300.00 / $200.00 / $100.00");
    const buyIn = facts.cells.find((cell) => cell.label === "Buy-in");
    expect(buyIn?.value).toBe("$50.00");
  });

  it("counts a held seat as claimed in the seats cell — the one seat-counting law", () => {
    const facts = lobbyJoinFacts(FREE_LEAGUE, false, false);
    const seats = facts.cells.find((cell) => cell.label === "Seats");
    expect(seats?.value).toBe("3 of 12"); // 12 - 8 filled - 1 held
    expect(seats?.note).toBe("1 being claimed right now");
  });

  it("states the real hold duration on the signed-out contract, and no hold at all signed in", () => {
    const signedOut = lobbyJoinFacts(FREE_LEAGUE, false, false);
    expect(signedOut.contract[0]).toBe(`Your seat is held for ${SEAT_HOLD.minutes} minutes while you sign in.`);
    const signedIn = lobbyJoinFacts(FREE_LEAGUE, true, false);
    expect(signedIn.contract[0]).not.toMatch(/held/);
  });

  it("derives the sit-and-go line from the real grace tunable and never invents a draft duration", () => {
    const facts = lobbyJoinFacts(FREE_LEAGUE, false, false);
    expect(facts.contract[1]).toContain(`about ${SIT_AND_GO_GRACE_MINUTES} minutes after the last seat fills`);
    expect(JSON.stringify(facts)).not.toMatch(/90 min/);
  });

  it("says the pot pays the podium only on a live, paid league", () => {
    expect(lobbyJoinFacts(PAID_LEAGUE, false, true).contract[2]).toContain("The pot pays the podium");
    expect(lobbyJoinFacts(FREE_LEAGUE, false, false).contract[2]).not.toContain("pot");
    expect(lobbyJoinFacts({ ...FREE_LEAGUE, payoutTable: null }, false, true).contract[2]).not.toContain("pot");
  });
});

describe("JoinSheet (the lobby door)", () => {
  it("rides the existing holds machinery signed out: the verb links to the hold interstitial", () => {
    render(<JoinSheet league={FREE_LEAGUE} signedIn={false} live={false} onClose={() => undefined} />);
    const verb = screen.getByRole("link", { name: `Take a seat in ${FREE_LEAGUE.name}.` });
    // `SignInLink` seals the hold page into the sign-in return intent — the existing machinery.
    expect(verb.getAttribute("href")).toContain(encodeURIComponent(`/join/${FREE_LEAGUE.id}/hold`));
    expect(screen.getByText(`Sign-in rides this tap, with the seat held for ${SEAT_HOLD.minutes} minutes while you do.`)).toBeInTheDocument();
  });

  it("gives a signed-in member the real join button, with no hold sentence to claim", () => {
    const deps: LeagueRoomDeps = { fetchJson: vi.fn() } as unknown as LeagueRoomDeps;
    renderInLeague(<JoinSheet league={FREE_LEAGUE} signedIn live={false} onClose={() => undefined} />, deps);
    expect(screen.getByRole("button", { name: `Join ${FREE_LEAGUE.name}` })).toBeInTheDocument();
    expect(screen.queryByText(/Sign-in rides this tap/)).not.toBeInTheDocument();
  });

  it("wears the FREE badge and the derived free-season sentence while money is dark", () => {
    render(<JoinSheet league={FREE_LEAGUE} signedIn={false} live={false} onClose={() => undefined} />);
    expect(screen.getByText("Free")).toBeInTheDocument();
    expect(screen.getByText("Every league is free this season.")).toBeInTheDocument();
    expect(screen.queryByText("Buy-in")).not.toBeInTheDocument();
  });

  it("prices the verb and drops the free badge once money is live", () => {
    render(<JoinSheet league={PAID_LEAGUE} signedIn={false} live onClose={() => undefined} />);
    expect(screen.getByRole("link", { name: `Take a seat in ${PAID_LEAGUE.name}.` }).textContent).toContain("· $50.00");
    expect(screen.queryByText("Every league is free this season.")).not.toBeInTheDocument();
    expect(screen.getByText("Buy-in")).toBeInTheDocument();
  });

  it("closes on Escape through the BottomSheet it rides", () => {
    const onClose = vi.fn();
    render(<JoinSheet league={FREE_LEAGUE} signedIn={false} live={false} onClose={onClose} />);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalled();
  });
});
