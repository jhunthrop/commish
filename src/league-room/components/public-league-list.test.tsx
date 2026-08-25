import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { GLOSSARY } from "@/help/glossary";
import { renderSurface } from "@/components/ui/test-utils";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { PUBLIC_LEAGUES, fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import {
  HOUSE_SHELF_SENTENCE,
  OPEN_LEAGUE_LEGEND,
  OpenLeagueShelf,
  featuredLeagueId,
  seatCountsAsOfSentence,
} from "./public-league-list";

// A signed-in shelf renders `JoinPublicLeagueButton` per card, which navigates via
// `next/navigation`'s `useRouter` and throws outside a mounted App Router. Stubbing the hook
// — not the component — is the idiom `join-form.test.tsx` and `league-home.test.tsx` established.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const AS_OF = "Saturday 12 September, 7:42 PM UTC";

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

/** How many ink pills (rule 5's `bg-text-primary` fill) a rendered container holds. */
function inkPillCount(container: HTMLElement): number {
  return container.querySelectorAll('[class*="bg-text-primary"]').length;
}

function occurrences(container: HTMLElement, sentence: string): number {
  return (container.textContent ?? "").split(sentence).length - 1;
}

/**
 * D2's selector, tested as the pure function it is: the shelf's single featured card is the
 * nearest scheduled draft, else the fewest seats remaining — the exact rule Task 6's brief
 * states, with `when_full` placeholders never mistaken for a scheduled instant.
 */
describe("featuredLeagueId (D2)", () => {
  const scheduledSoon: PublicLeagueSummary = { ...HOUSE_LEAGUE, id: "soon", draftAtIso: "2026-09-10T19:00:00.000Z" };
  const scheduledLater: PublicLeagueSummary = { ...HOUSE_LEAGUE, id: "later", draftAtIso: "2026-09-12T19:00:00.000Z" };
  const whenFull: PublicLeagueSummary = {
    ...HOUSE_LEAGUE,
    id: "wf",
    startTrigger: "when_full",
    // A `when_full` league's `draftAtIso` is the same PLACEHOLDER its `draftAt` is
    // (`PublicLeagueSummary.draftAtIso`'s own docblock) — earlier than every scheduled
    // instant here, to prove the gate is `startTrigger`, never the raw timestamp.
    draftAtIso: "2026-09-01T00:00:00.000Z",
    filledTeams: 11,
  };

  it("answers null for an empty shelf", () => {
    expect(featuredLeagueId([])).toBeNull();
  });

  it("picks the nearest scheduled draft", () => {
    expect(featuredLeagueId([scheduledLater, scheduledSoon])).toBe("soon");
  });

  it("never lets a when_full placeholder instant outrank a scheduled draft", () => {
    expect(featuredLeagueId([whenFull, scheduledLater])).toBe("later");
  });

  it("falls back to the fewest seats remaining when nothing is scheduled with an instant", () => {
    const roomier: PublicLeagueSummary = { ...whenFull, id: "roomy", filledTeams: 3 };
    const noIso: PublicLeagueSummary = { ...HOUSE_LEAGUE, id: "no_iso" };
    delete (noIso as { draftAtIso?: string }).draftAtIso;
    expect(featuredLeagueId([roomier, whenFull, { ...noIso, filledTeams: 2 }])).toBe("wf");
  });

  it("breaks a tie by list order, deterministically", () => {
    const twinA: PublicLeagueSummary = { ...HOUSE_LEAGUE, id: "twin_a", draftAtIso: "2026-09-10T19:00:00.000Z" };
    const twinB: PublicLeagueSummary = { ...HOUSE_LEAGUE, id: "twin_b", draftAtIso: "2026-09-10T19:00:00.000Z" };
    expect(featuredLeagueId([twinA, twinB])).toBe("twin_a");
  });
});

/** The two responsive renderings of the one merged shelf (FOUNDER-ORDERED, 2026-08-24):
 *  hairline rows on lg+ viewports, the ledger cards below — jsdom applies no stylesheet, so
 *  every structural assertion here scopes to one rendering by its testid. */
const rows = () => screen.getByTestId("league-rows");
const cards = () => screen.getByTestId("league-cards");

describe("OpenLeagueShelf", () => {
  it("renders the merged shelf twice, house first in both: rows for lg+ viewports, cards below lg (E3 + Task 13)", async () => {
    await renderSurface(
      <OpenLeagueShelf house={[HOUSE_LEAGUE]} leagues={PUBLIC_LEAGUES} signedIn helpLevel="standard" asOfTime={AS_OF} />,
      async ({ container }) => {
        for (const rendering of [rows(), cards()]) {
          const items = within(rendering).getAllByRole("listitem");
          expect(items).toHaveLength(1 + PUBLIC_LEAGUES.length);
          expect(items[0]!.textContent).toContain(HOUSE_LEAGUE.name);
          expect(within(rendering).getByText("Rookie Snake Room")).toBeInTheDocument();
          expect(within(rendering).getByText("Sharks Only Auction")).toBeInTheDocument();
        }
        expect(screen.getByText(MATCHMAKING_CONFIG.stakeDisclosure)).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("shows rows at lg and up, cards below — the lg boundary, spelled as classes (Task 13)", () => {
    render(<OpenLeagueShelf house={[HOUSE_LEAGUE]} leagues={PUBLIC_LEAGUES} signedIn helpLevel="standard" asOfTime={AS_OF} />);
    // The row stack exists only at lg+ — the six-column row cannot fit 360px; the card IS the
    // mobile form.
    expect(rows().className).toContain("hidden");
    expect(rows().className).toContain("lg:block");
    // The card grid keeps its sub-lg tier and never renders at lg+ — its old lg:3/xl:4 tiers
    // moved out with the founder's rows ruling.
    expect(cards().className).toContain("sm:grid-cols-2");
    expect(cards().className).toContain("lg:hidden");
    expect(cards().className).not.toContain("lg:grid-cols-3");
    expect(cards().className).not.toContain("xl:grid-cols-4");
  });

  it("separates rows by hairline, no boxes (rule 4), under one eyebrow header naming the columns", () => {
    render(<OpenLeagueShelf house={[HOUSE_LEAGUE]} leagues={PUBLIC_LEAGUES} signedIn helpLevel="standard" asOfTime={AS_OF} />);
    for (const item of within(rows()).getAllByRole("listitem")) {
      expect(item.className).toContain("border-t");
      expect(item.className).toContain("border-line");
    }
    for (const label of ["League", "Format", "Drafts", "Entry", "Seats"]) {
      expect(within(rows()).getByText(label)).toBeInTheDocument();
    }
  });

  it("keeps guided captions out of the rows while the cards keep the member's preference (Task 13)", () => {
    render(<OpenLeagueShelf house={[]} leagues={PUBLIC_LEAGUES} signedIn helpLevel="guided" asOfTime={AS_OF} />);
    expect(within(rows()).queryByText(GLOSSARY["snake-draft"].short)).not.toBeInTheDocument();
    expect(within(rows()).getByRole("button", { name: "What is a snake draft?" })).toBeInTheDocument();
    expect(within(cards()).getByText(GLOSSARY["snake-draft"].short)).toBeInTheDocument();
  });

  it("renders ONE shelf head: the title at the caller's heading level, the freshness sentence as its quiet sub", () => {
    const { unmount } = render(
      <OpenLeagueShelf house={[]} leagues={PUBLIC_LEAGUES} signedIn helpLevel="standard" asOfTime={AS_OF} />,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Open leagues" })).toBeInTheDocument();
    expect(screen.getByText(seatCountsAsOfSentence(AS_OF))).toBeInTheDocument();
    unmount();

    render(<OpenLeagueShelf house={[]} leagues={PUBLIC_LEAGUES} signedIn helpLevel="standard" asOfTime={AS_OF} headingLevel={1} />);
    expect(screen.getByRole("heading", { level: 1, name: "Open leagues" })).toBeInTheDocument();
  });

  it("collapses the house explainer to ONE muted sentence under the head — never a heading, never a stack (Task 13)", () => {
    render(<OpenLeagueShelf house={[HOUSE_LEAGUE]} leagues={PUBLIC_LEAGUES} signedIn helpLevel="standard" asOfTime={AS_OF} />);
    // The old "Commish house leagues" floating caption is DEAD: one shelf, one head.
    expect(screen.queryByRole("heading", { name: /Commish house leagues/ })).not.toBeInTheDocument();
    const explainer = screen.getByText(new RegExp(HOUSE_SHELF_SENTENCE.slice(0, 40)));
    expect(explainer.closest("p")).not.toBeNull();
    expect(explainer.closest("h1, h2, h3")).toBeNull();
    // The old second sentence ("Everyone joins the same way…") is gone with the collapse — the
    // house-league InfoTip beside the sentence keeps the longer story one press away.
    expect(screen.queryByText(/Everyone joins the same way/)).not.toBeInTheDocument();
  });

  it("prints the house sentence (the factory's promise folded in) once, never per card", () => {
    const { container } = render(
      <OpenLeagueShelf
        house={[HOUSE_LEAGUE, { ...HOUSE_LEAGUE, id: "house_sitandgo", houseRung: "sitandgo_12", startTrigger: "when_full" }]}
        leagues={PUBLIC_LEAGUES}
        signedIn
        helpLevel="standard"
        asOfTime={AS_OF}
      />,
    );
    expect(occurrences(container, HOUSE_SHELF_SENTENCE)).toBe(1);
  });

  it("keeps the house sentence honest: no house leagues on the shelf, no house sentence", () => {
    const { container } = render(
      <OpenLeagueShelf house={[]} leagues={PUBLIC_LEAGUES} signedIn helpLevel="standard" asOfTime={AS_OF} />,
    );
    expect(occurrences(container, HOUSE_SHELF_SENTENCE)).toBe(0);
  });

  it("keeps the head's house-league InfoTip click-only — its guided caption was the stacked duplicate the founder cut (Task 13)", () => {
    render(<OpenLeagueShelf house={[HOUSE_LEAGUE]} leagues={[]} signedIn helpLevel="guided" asOfTime={AS_OF} />);
    expect(screen.getByRole("button", { name: "What is a house league?" })).toBeInTheDocument();
    expect(screen.queryByText(GLOSSARY["house-league"].short)).not.toBeInTheDocument();
  });

  it("prints the legend line once, above both renderings, whenever there are leagues to read (D1)", () => {
    render(<OpenLeagueShelf house={[HOUSE_LEAGUE]} leagues={PUBLIC_LEAGUES} signedIn helpLevel="standard" asOfTime={AS_OF} />);
    const legend = screen.getByText(OPEN_LEAGUE_LEGEND);
    for (const rendering of [rows(), cards()]) {
      expect(legend.compareDocumentPosition(rendering) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("passes emphasis='ink' to exactly one league PER RENDERING — never more, whatever the shelf holds (D2, extended to rows)", () => {
    const shelves = [
      { house: [HOUSE_LEAGUE], leagues: PUBLIC_LEAGUES },
      { house: [], leagues: PUBLIC_LEAGUES },
      { house: [HOUSE_LEAGUE], leagues: [] },
      {
        house: [{ ...HOUSE_LEAGUE, id: "wf_only", startTrigger: "when_full" as const }],
        leagues: [{ ...PUBLIC_LEAGUES[0]!, id: "wf_member", startTrigger: "when_full" as const }],
      },
    ];
    for (const { house, leagues } of shelves) {
      const { unmount } = render(
        <OpenLeagueShelf house={house} leagues={leagues} signedIn={false} helpLevel="standard" asOfTime={AS_OF} />,
      );
      // Only one rendering is ever on screen (the lg boundary), so one ink pill in each IS
      // rule 5's one ink action per view.
      expect(inkPillCount(rows()), `rows: house=${house.length} leagues=${leagues.length}`).toBe(1);
      expect(inkPillCount(cards()), `cards: house=${house.length} leagues=${leagues.length}`).toBe(1);
      unmount();
    }
  });

  it("gives the ink to the nearest scheduled draft in BOTH renderings, quiet pills everywhere else", () => {
    const soon: PublicLeagueSummary = { ...PUBLIC_LEAGUES[0]!, id: "soonest", name: "Soonest Draft Room", draftAtIso: "2026-09-10T19:00:00.000Z" };
    render(
      <OpenLeagueShelf house={[HOUSE_LEAGUE]} leagues={[soon, PUBLIC_LEAGUES[1]!]} signedIn={false} helpLevel="standard" asOfTime={AS_OF} />,
    );
    for (const rendering of [rows(), cards()]) {
      const ink = rendering.querySelector('[class*="bg-text-primary"]');
      expect(ink?.getAttribute("aria-label")).toContain("Soonest Draft Room");
    }
  });

  it("marks every member league, and only member leagues, for e2e scoping in both renderings (data-testid='member-league')", () => {
    render(
      <OpenLeagueShelf house={[HOUSE_LEAGUE]} leagues={PUBLIC_LEAGUES} signedIn helpLevel="standard" asOfTime={AS_OF} />,
    );
    for (const rendering of [rows(), cards()]) {
      const members = rendering.querySelectorAll('[data-testid="member-league"]');
      expect(members).toHaveLength(PUBLIC_LEAGUES.length);
      for (const member of members) expect(member.textContent).not.toContain(HOUSE_LEAGUE.name);
    }
  });

  it("gives a signed-in visitor a join button per league in both renderings, house and member alike", () => {
    renderInLeague(
      <OpenLeagueShelf house={[HOUSE_LEAGUE]} leagues={PUBLIC_LEAGUES} signedIn helpLevel="standard" asOfTime={AS_OF} />,
      fixtureLeagueDeps().deps,
    );
    for (const rendering of [rows(), cards()]) {
      expect(within(rendering).getByRole("button", { name: `Join ${HOUSE_LEAGUE.name}` })).toBeInTheDocument();
      expect(within(rendering).getByRole("button", { name: "Join Rookie Snake Room" })).toBeInTheDocument();
      expect(within(rendering).getByRole("button", { name: "Join Sharks Only Auction" })).toBeInTheDocument();
    }
  });

  it("sends a signed-out visitor to the hold interstitial, one link per league in each rendering", () => {
    render(<OpenLeagueShelf house={[HOUSE_LEAGUE]} leagues={PUBLIC_LEAGUES} signedIn={false} helpLevel="standard" asOfTime={AS_OF} />);
    expect(screen.queryByRole("button", { name: /^Join / })).not.toBeInTheDocument();
    for (const rendering of [rows(), cards()]) {
      expect(within(rendering).getAllByRole("link", { name: /^Take (a seat|the last seat) in / })).toHaveLength(1 + PUBLIC_LEAGUES.length);
    }
  });

  it("offers a next action when no member league matches, rather than a dead end", async () => {
    await renderSurface(
      <OpenLeagueShelf house={[]} leagues={[]} signedIn helpLevel="standard" asOfTime={AS_OF} />,
      async ({ container }) => {
        expect(screen.getByText("No open leagues match")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Clear the filters" })).toHaveAttribute("href", "/browse");
        expect(screen.getByRole("link", { name: "Start your own league" })).toHaveAttribute("href", "/app#create-league");
        // No cards, nothing to press: the legend has no ⓘ to point at.
        expect(screen.queryByText(OPEN_LEAGUE_LEGEND)).not.toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("keeps the house leagues standing beside the empty state when only the member list runs dry", () => {
    render(<OpenLeagueShelf house={[HOUSE_LEAGUE]} leagues={[]} signedIn helpLevel="standard" asOfTime={AS_OF} />);
    // One heading per rendering — jsdom sees both; a browser shows exactly one (the lg boundary).
    expect(screen.getAllByRole("heading", { name: HOUSE_LEAGUE.name })).toHaveLength(2);
    expect(screen.getByText("No open leagues match")).toBeInTheDocument();
  });

  it("renders no progress bar", () => {
    const { container } = render(
      <OpenLeagueShelf house={[HOUSE_LEAGUE]} leagues={PUBLIC_LEAGUES} signedIn helpLevel="guided" asOfTime={AS_OF} />,
    );
    expect(container.querySelector("[role='progressbar']")).not.toBeInTheDocument();
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
