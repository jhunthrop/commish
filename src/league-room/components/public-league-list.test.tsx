import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { GLOSSARY } from "@/help/glossary";
import { renderSurface } from "@/components/ui/test-utils";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { HOUSE_RUNG_LABEL } from "@/matchmaking/house-catalog";
import { fixtureLeagueDeps, PUBLIC_LEAGUES, renderInLeague } from "../test-fixtures";
import { HOUSE_SHELF_PROMISE, HouseLeagueShelf, PublicLeagueList, seatCountsAsOfSentence } from "./public-league-list";

// A signed-in list renders `JoinPublicLeagueButton` per card, which navigates via
// `next/navigation`'s `useRouter` and throws outside a mounted App Router. Stubbing the hook
// — not the component — is the idiom `join-form.test.tsx` and `league-home.test.tsx` established.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

/**
 * `PublicLeagueList`'s own job, since Phase 3.6 Task 5 extracted `OpenLeagueCard`: rendering a
 * list of cards, and the empty state when there are none — everything a SINGLE card says or does
 * is `open-league-card.test.tsx`'s job now, not this file's.
 */
describe("PublicLeagueList", () => {
  it("renders one OpenLeagueCard per league, in both themes, axe-clean", async () => {
    await renderSurface(<PublicLeagueList leagues={PUBLIC_LEAGUES} signedIn helpLevel="standard" />, async ({ container }) => {
      expect(screen.getByText("Rookie Snake Room")).toBeInTheDocument();
      expect(screen.getByText("Sharks Only Auction")).toBeInTheDocument();
      expect(screen.getByText(MATCHMAKING_CONFIG.stakeDisclosure)).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("gives a signed-in visitor a join button per league", () => {
    renderInLeague(<PublicLeagueList leagues={PUBLIC_LEAGUES} signedIn helpLevel="standard" />, fixtureLeagueDeps().deps);
    expect(screen.getByRole("button", { name: "Join Rookie Snake Room" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join Sharks Only Auction" })).toBeInTheDocument();
  });

  it("sends a signed-out visitor to the hold interstitial, one link per league", () => {
    render(<PublicLeagueList leagues={PUBLIC_LEAGUES} signedIn={false} helpLevel="standard" />);
    expect(screen.queryByRole("button", { name: /^Join / })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /^Take (a seat|the last seat) in / })).toHaveLength(PUBLIC_LEAGUES.length);
  });

  it("offers a next action when no league matches, rather than a dead end", async () => {
    await renderSurface(<PublicLeagueList leagues={[]} signedIn helpLevel="standard" />, async ({ container }) => {
      expect(screen.getByText("No open leagues match")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Clear the filters" })).toHaveAttribute("href", "/browse");
      expect(screen.getByRole("link", { name: "Start your own league" })).toHaveAttribute("href", "/app#create-league");
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});

const HOUSE_LEAGUE: PublicLeagueSummary = {
  id: "house_1",
  name: "Open 12-team League 3",
  format: "snake",
  experienceTier: "experienced",
  stakeTier: 0,
  teamCount: 12,
  filledTeams: 5,
  scoringLabel: "Half PPR",
  compositionCategory: "open",
  draftAt: "Saturday 12 September, 7:00 PM UTC (in 3 days)",
  medianGame: false,
  startTrigger: "scheduled",
  houseRung: "open_12",
  heldSeats: 0,
  rosterSummary: "15 slots, 1 flex",
  playoffWeeks: [15, 16, 17],
  kickoffRolls: 0,
};

describe("HouseLeagueShelf", () => {
  it("renders nothing at all when the shelf is empty, rather than an apology", () => {
    const { container } = render(<HouseLeagueShelf leagues={[]} signedIn helpLevel="standard" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows each house league's rung through its own OpenLeagueCard, in both themes, axe-clean", async () => {
    await renderSurface(<HouseLeagueShelf leagues={[HOUSE_LEAGUE]} signedIn helpLevel="guided" />, async ({ container }) => {
      // E3 (Phase 3.7, Task 5): a factory-named house league carries its rung IN the title —
      // "Open 12-team League 3" — so the card renders no duplicate badge beside it; the rung
      // still reaches the reader exactly once.
      expect(screen.getByRole("heading", { name: HOUSE_LEAGUE.name })).toBeInTheDocument();
      expect(screen.getAllByText(new RegExp(HOUSE_RUNG_LABEL.open_12))).toHaveLength(1);
      expect(screen.getByText(/5 of 12 seated/)).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  // NEW-3 (gauntlet fix wave, "reported, not fixed"): the shelf heading's own instance of
  // `open-league-card.tsx`'s guided-`InfoTip` layout break — `BROWSE_HELP_LEVEL` is
  // unconditionally `"guided"`, so the caption above is ALREADY present in every render of this
  // heading (including the axe-clean assertion above); this locks in the structural fix itself
  // rather than only its absence of axe violations, which a purely visual overflow would not
  // trip.
  it("wraps the shelf heading so its guided caption can drop to its own line instead of overflowing", () => {
    render(<HouseLeagueShelf leagues={[HOUSE_LEAGUE]} signedIn helpLevel="guided" />);
    const heading = screen.getByRole("heading", { level: 2, name: /Commish house leagues/ });
    expect(heading.className).toContain("flex-wrap");
    expect(heading.className).not.toContain("inline-flex");
  });

  it("prints the shelf's promise once, beneath the whole shelf, never per card", () => {
    const sitAndGo: PublicLeagueSummary = { ...HOUSE_LEAGUE, id: "house_sitandgo", houseRung: "sitandgo_12", startTrigger: "when_full" };
    render(<HouseLeagueShelf leagues={[HOUSE_LEAGUE, sitAndGo]} signedIn helpLevel="standard" />);
    expect(screen.getAllByText(HOUSE_SHELF_PROMISE)).toHaveLength(1);
  });

  it("renders no progress bar", () => {
    const { container } = render(<HouseLeagueShelf leagues={[HOUSE_LEAGUE]} signedIn helpLevel="guided" />);
    expect(container.querySelector("[role='progressbar']")).not.toBeInTheDocument();
  });

  it("opens an InfoTip on the shelf heading, guided by default, defining a house league", () => {
    render(<HouseLeagueShelf leagues={[HOUSE_LEAGUE]} signedIn helpLevel="guided" />);
    expect(screen.getByRole("button", { name: "What is a house league?" })).toBeInTheDocument();
    expect(screen.getByText(GLOSSARY["house-league"].short)).toBeInTheDocument();
  });

  it("gives a signed-in visitor a join button per house league", () => {
    renderInLeague(<HouseLeagueShelf leagues={[HOUSE_LEAGUE]} signedIn helpLevel="guided" />, fixtureLeagueDeps().deps);
    expect(screen.getByRole("button", { name: `Join ${HOUSE_LEAGUE.name}` })).toBeInTheDocument();
  });
});

describe("seatCountsAsOfSentence (F20)", () => {
  it("is the verbatim sentence, with the pre-formatted time interpolated", () => {
    expect(seatCountsAsOfSentence("Saturday 12 September, 7:42 PM UTC")).toBe(
      "Seat counts as of Saturday 12 September, 7:42 PM UTC. A seat being claimed is counted.",
    );
  });

  it("never says 'live' or 'updated just now' — the mock's own refused phrasing", () => {
    const sentence = seatCountsAsOfSentence("Saturday 12 September, 7:42 PM UTC");
    expect(sentence).not.toMatch(/live/i);
    expect(sentence).not.toMatch(/just now/i);
  });
});
