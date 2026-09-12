import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { GLOSSARY } from "@/help/glossary";
import { renderSurface } from "@/components/ui/test-utils";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { PUBLIC_LEAGUES, fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import {
  HOUSE_SHELF_SENTENCE,
  OpenLeagueShelf,
  featuredLeagueId,
  featuredFillingLeague,
  seatCountsAsOfSentence,
} from "./public-league-list";
import { ctaAccessibleName } from "./open-league-shared";

// A signed-in shelf renders `JoinPublicLeagueButton` per card, which navigates via
// `next/navigation`'s `useRouter` and throws outside a mounted App Router. Stubbing the hook
// — not the component — is the idiom `join-form.test.tsx` and `league-home.test.tsx` established.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const AS_OF = "Saturday 12 September, 7:42 PM UTC";

const HOUSE_LEAGUE: PublicLeagueSummary = {
  id: "house_1",
  // "The Longshot League" — a real `houseLeagueName("open_12", 3)` output (founder directive
  // 2026-08-26), not the retired "Open 12-team League 3" shape.
  name: "The Longshot League",
  format: "snake",
  experienceTier: "experienced",
  stakeTier: 0,
  entryFeeCents: 0,
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

/** How many granted verbs (Sunday v5's `bg-accent` fill) a rendered container holds. */
function inkPillCount(container: HTMLElement): number {
  return container.querySelectorAll('a[class*="bg-accent"], button[class*="bg-accent"]').length;
}

function occurrences(container: HTMLElement, sentence: string): number {
  return (container.textContent ?? "").split(sentence).length - 1;
}

/**
 * D2's selector, repointed by storefront review R1: the shelf's single featured card is the
 * FULLEST FILLING league (at least one seat taken, and, if `scheduled`, never rolled), else the
 * fewest seats remaining across the whole shelf.
 */
describe("featuredLeagueId (D2, repointed by storefront review R1)", () => {
  const fullest: PublicLeagueSummary = { ...HOUSE_LEAGUE, id: "fullest", filledTeams: 11 }; // 1 remaining
  const filling: PublicLeagueSummary = { ...HOUSE_LEAGUE, id: "filling", filledTeams: 5 }; // 7 remaining
  const empty: PublicLeagueSummary = { ...HOUSE_LEAGUE, id: "empty", filledTeams: 0 };
  const whenFullFilling: PublicLeagueSummary = { ...HOUSE_LEAGUE, id: "wf", startTrigger: "when_full", filledTeams: 10 }; // 2 remaining

  it("answers null for an empty shelf", () => {
    expect(featuredLeagueId([])).toBeNull();
  });

  it("picks the fullest filling league", () => {
    expect(featuredLeagueId([filling, fullest])).toBe("fullest");
  });

  it("never lets an empty room outrank one that has at least one seat taken", () => {
    expect(featuredLeagueId([empty, filling])).toBe("filling");
  });

  it("lets a rolled league win on fullness — a roll is a fact about the DATE, not a disqualification", () => {
    // Reverses storefront review R1's E4 clause (the doors-and-rooms fix round, 2026-09-10).
    // Rooms roll until they fill, so E4 disqualified every filling room on a real board and the
    // feature quietly turned itself off. The row shows the date current either way.
    const rolledButFullest: PublicLeagueSummary = { ...HOUSE_LEAGUE, id: "rolled", filledTeams: 11, kickoffRolls: 2 };
    expect(featuredLeagueId([rolledButFullest, filling])).toBe("rolled");
  });

  it("a when_full league's own fill counts exactly like a scheduled one's", () => {
    expect(featuredLeagueId([filling, whenFullFilling])).toBe("wf");
  });

  it("falls back to the fewest seats remaining across the whole shelf when nothing is filling", () => {
    const roomier: PublicLeagueSummary = { ...empty, id: "roomy", teamCount: 20 };
    const tighter: PublicLeagueSummary = { ...empty, id: "tight", teamCount: 4 };
    expect(featuredLeagueId([roomier, tighter])).toBe("tight");
  });

  it("breaks a tie by list order, deterministically", () => {
    const twinA: PublicLeagueSummary = { ...HOUSE_LEAGUE, id: "twin_a", filledTeams: 6 };
    const twinB: PublicLeagueSummary = { ...HOUSE_LEAGUE, id: "twin_b", filledTeams: 6 };
    expect(featuredLeagueId([twinA, twinB])).toBe("twin_a");
  });
});

/**
 * The front door hero's own "Next draft" module reads (2026-08-25 founder finding; repointed by
 * storefront review R1): the exact qualifying subset of `featuredLeagueId` — a genuinely filling
 * league — returned as the league object, `null` whenever `featuredLeagueId` would have fallen
 * back to the tightest-seats pick across an all-empty shelf (or the shelf is empty). The module
 * renders nothing in either `null` case.
 */
describe("featuredFillingLeague (2026-08-25 hero finding; repointed by storefront review R1)", () => {
  const fullest: PublicLeagueSummary = { ...HOUSE_LEAGUE, id: "fullest", filledTeams: 11 };
  const filling: PublicLeagueSummary = { ...HOUSE_LEAGUE, id: "filling", filledTeams: 5 };
  const empty: PublicLeagueSummary = { ...HOUSE_LEAGUE, id: "empty", filledTeams: 0 };

  it("answers null for an empty shelf", () => {
    expect(featuredFillingLeague([])).toBeNull();
  });

  it("returns the fullest filling league as the object, not just its id", () => {
    const result = featuredFillingLeague([filling, fullest]);
    expect(result).toBe(fullest);
  });

  it("answers null when nothing has a single seat taken — never the fallback tightest-seats pick across an empty shelf", () => {
    const roomier: PublicLeagueSummary = { ...empty, id: "roomy", teamCount: 20 };
    const tighter: PublicLeagueSummary = { ...empty, id: "tight", teamCount: 4 };
    // `featuredLeagueId` would answer "tight" here (its own fallback branch); the module must
    // answer null instead — a shelf where nothing is filling has nothing genuinely featured.
    expect(featuredLeagueId([roomier, tighter])).toBe("tight");
    expect(featuredFillingLeague([roomier, tighter])).toBeNull();
  });

  it("features an already-rolled scheduled league when it is the fullest one", () => {
    const rolled: PublicLeagueSummary = { ...HOUSE_LEAGUE, id: "rolled", filledTeams: 11, kickoffRolls: 1 };
    expect(featuredFillingLeague([rolled, filling])).toBe(rolled);
  });

  it("agrees with featuredLeagueId's id whenever something is genuinely filling", () => {
    const merged = [empty, filling, fullest];
    expect(featuredFillingLeague(merged)?.id).toBe(featuredLeagueId(merged));
  });
});

/** The two responsive renderings of the one merged shelf (FOUNDER-ORDERED, 2026-08-24):
 *  hairline rows on lg+ viewports, the ledger cards below — jsdom applies no stylesheet, so
 *  every structural assertion here scopes to one rendering by its testid. */
const rows = () => screen.getByTestId("league-rows");
const cards = () => screen.getByTestId("league-cards");

describe("OpenLeagueShelf", () => {
  it("renders the merged shelf twice: RANKED rows for lg+ viewports (soonest joinable first), house-first cards below lg", async () => {
    await renderSurface(
      <OpenLeagueShelf house={[HOUSE_LEAGUE]} leagues={PUBLIC_LEAGUES} signedIn asOfTime={AS_OF} />,
      async ({ container }) => {
        for (const rendering of [rows(), cards()]) {
          const items = within(rendering).getAllByRole("listitem");
          expect(items).toHaveLength(1 + PUBLIC_LEAGUES.length);
          expect(within(rendering).getByText(HOUSE_LEAGUE.name)).toBeInTheDocument();
          expect(within(rendering).getByText("Rookie Snake Room")).toBeInTheDocument();
          expect(within(rendering).getByText("Sharks Only Auction")).toBeInTheDocument();
        }
        // The board is ranked by soonest joinable draft (v5's tower + the blueprint's sort):
        // "Sharks Only Auction" sits at 9 of 10 — one seat left — so it is P1, house or not.
        // House-first ordering died with the ranking; the CARD grid below lg keeps house first.
        expect(within(rows()).getAllByRole("listitem")[0]!.textContent).toContain("Sharks Only Auction");
        expect(within(cards()).getAllByRole("listitem")[0]!.textContent).toContain(HOUSE_LEAGUE.name);
        expect(screen.getByText(MATCHMAKING_CONFIG.stakeDisclosure)).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  // Front door blueprint (2026-09-02): sorted by soonest draft you can still join — within the
  // filling chapter, a CHOSEN kickoff breaks a seats tie, sooner first.
  it("breaks a seats tie inside a chapter by the sooner chosen kickoff", () => {
    const later: PublicLeagueSummary = {
      ...HOUSE_LEAGUE, id: "later", name: "Later Twin", houseRung: null, filledTeams: 6,
      draftAtIso: "2026-09-08T20:00:00.000Z",
    };
    const sooner: PublicLeagueSummary = {
      ...HOUSE_LEAGUE, id: "sooner", name: "Sooner Twin", houseRung: null, filledTeams: 6,
      draftAtIso: "2026-09-05T20:00:00.000Z",
    };
    render(<OpenLeagueShelf house={[]} leagues={[later, sooner]} signedIn={false} asOfTime={AS_OF} />);
    const items = within(rows()).getAllByRole("listitem");
    expect(items[0]!.textContent).toContain("Sooner Twin");
    expect(items[1]!.textContent).toContain("Later Twin");
  });

  // 2026-08-25, the absolutism sweep's carried finding: the shelf-wide disclosure defers to the
  // Entry column once `moneyIsLive()` is true, rather than re-asserting "no money changes hands"
  // for a merged list that can now hold a real fee.
  it("defers to the Entry column once live, and never claims 'no money changes hands' for a mixed list (live prop, injected)", () => {
    render(<OpenLeagueShelf house={[HOUSE_LEAGUE]} leagues={PUBLIC_LEAGUES} signedIn asOfTime={AS_OF} live />);
    expect(screen.getByText(MATCHMAKING_CONFIG.liveShelfStakeDisclosure)).toBeInTheDocument();
    expect(screen.queryByText(MATCHMAKING_CONFIG.stakeDisclosure)).not.toBeInTheDocument();
  });

  it("keeps the dark disclosure byte-identical when `live` is left at its default (moneyIsLive() false today)", () => {
    render(<OpenLeagueShelf house={[HOUSE_LEAGUE]} leagues={PUBLIC_LEAGUES} signedIn asOfTime={AS_OF} />);
    expect(screen.getByText(MATCHMAKING_CONFIG.stakeDisclosure)).toBeInTheDocument();
    expect(screen.queryByText(MATCHMAKING_CONFIG.liveShelfStakeDisclosure)).not.toBeInTheDocument();
  });

  it("shows rows at lg and up, cards below — the lg boundary, spelled as classes (Task 13)", () => {
    render(<OpenLeagueShelf house={[HOUSE_LEAGUE]} leagues={PUBLIC_LEAGUES} signedIn asOfTime={AS_OF} />);
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

  it("is one paper board of row plates, hairlines gone, under one header naming the columns", () => {
    render(<OpenLeagueShelf house={[HOUSE_LEAGUE]} leagues={PUBLIC_LEAGUES} signedIn asOfTime={AS_OF} />);
    // SIDELINE (2026-09-10): the board is the one material — paper at the 20px card radius on
    // the chalk ground — and each row is a 12px plate inside it. The per-row hairlines are gone:
    // a plate that lifts on hover is already a boundary, and a rule under every plate read as a
    // table (P10 forbids a comparison list that looks like a spreadsheet).
    expect(rows().className).toContain("rounded-xl");
    expect(rows().className).toContain("bg-surface-elevated");
    for (const item of within(rows()).getAllByRole("listitem")) {
      expect(item.className).not.toContain("border-t");
    }
    // The header is the rows rendering's first element. Free season: no money column at all —
    // the blueprint's money columns exist only behind `moneyIsLive()` (their own tests).
    const header = rows().firstElementChild as HTMLElement;
    for (const label of ["Who is in", "Format", "Drafts", "Seats"]) {
      expect(within(header).getByText(label)).toBeInTheDocument();
    }
    expect(within(header).queryByText("Buy-in")).not.toBeInTheDocument();
  });

  /**
   * FOUNDER RULING (2026-08-28): "the UX should explain itself - we shouldn't need tips." The
   * shelf's whole guidance apparatus — the ⓘ triggers, the guided captions, the "Press any ⓘ"
   * legend, the built-in house sentence — is retired, and these assertions hold the ABSENCE so
   * it cannot drift back the way the head's one-line rule drifted back once before. The operator
   * -transparency sentence survives on /browse through the `intro` slot (that page's own test).
   */
  it("renders no tips and no guided captions in either rendering, whatever the caller's helpLevel", () => {
    render(<OpenLeagueShelf house={[HOUSE_LEAGUE]} leagues={PUBLIC_LEAGUES} signedIn asOfTime={AS_OF} />);
    expect(screen.queryAllByRole("button", { name: /What is/ })).toHaveLength(0);
    expect(screen.queryByText(GLOSSARY["snake-draft"].short)).not.toBeInTheDocument();
    expect(screen.queryByText(GLOSSARY["house-league"].short)).not.toBeInTheDocument();
  });

  it("renders ONE shelf head: the title at the caller's heading level, the freshness sentence as its quiet sub", () => {
    const { unmount } = render(
      <OpenLeagueShelf house={[]} leagues={PUBLIC_LEAGUES} signedIn asOfTime={AS_OF} />,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Open leagues" })).toBeInTheDocument();
    expect(screen.getByText(seatCountsAsOfSentence(AS_OF))).toBeInTheDocument();
    unmount();

    render(<OpenLeagueShelf house={[]} leagues={PUBLIC_LEAGUES} signedIn asOfTime={AS_OF} headingLevel={1} />);
    expect(screen.getByRole("heading", { level: 1, name: "Open leagues" })).toBeInTheDocument();
  });

  it("prints no explainer prose between the head and the first league — the board explains itself", () => {
    const { container } = render(
      <OpenLeagueShelf house={[HOUSE_LEAGUE]} leagues={PUBLIC_LEAGUES} signedIn asOfTime={AS_OF} />,
    );
    expect(occurrences(container, HOUSE_SHELF_SENTENCE)).toBe(0);
    expect(screen.queryByText(/Press any/)).not.toBeInTheDocument();
  });

  // The heading-order fix the storefront track handed over: an `aside` renders INSIDE the head,
  // after the heading, so a caller can no longer put an interactive control ahead of the page's
  // only `<h1>` however it composes the page around this component.
  it("renders its aside after the heading, never before it", () => {
    render(
      <OpenLeagueShelf
        house={[HOUSE_LEAGUE]}
        leagues={PUBLIC_LEAGUES}
        signedIn
       
        asOfTime={AS_OF}
        headingLevel={1}
        aside={<button type="button">Try a mock draft</button>}
      />,
    );
    const heading = screen.getByRole("heading", { level: 1, name: "Open leagues" });
    const aside = screen.getByRole("button", { name: "Try a mock draft" });
    expect(heading.compareDocumentPosition(aside) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
        <OpenLeagueShelf house={house} leagues={leagues} signedIn={false} asOfTime={AS_OF} />,
      );
      // Only one rendering is ever on screen (the lg boundary), so one ink pill in each IS
      // rule 5's one ink action per view.
      expect(inkPillCount(rows()), `rows: house=${house.length} leagues=${leagues.length}`).toBe(1);
      expect(inkPillCount(cards()), `cards: house=${house.length} leagues=${leagues.length}`).toBe(1);
      unmount();
    }
  });

  it("gives the ink to the fullest filling league in BOTH renderings, quiet pills everywhere else (repointed by storefront review R1)", () => {
    // 11 of 12 seated — tighter than HOUSE_LEAGUE (5 of 12) and PUBLIC_LEAGUES[1] (9 of 10).
    const soon: PublicLeagueSummary = { ...PUBLIC_LEAGUES[0]!, id: "soonest", name: "Fullest Draft Room", filledTeams: 11 };
    render(
      <OpenLeagueShelf house={[HOUSE_LEAGUE]} leagues={[soon, PUBLIC_LEAGUES[1]!]} signedIn={false} asOfTime={AS_OF} />,
    );
    for (const rendering of [rows(), cards()]) {
      const ink = rendering.querySelector('a[class*="bg-accent"], button[class*="bg-accent"]');
      expect(ink?.getAttribute("aria-label")).toContain("Fullest Draft Room");
    }
  });

  // Blueprint law 2 (2026-09-02): when nothing GENUINELY fills — every room untouched — NO row
  // wears the solid; the page-level nav pill stays loud instead, and two solids on one surface
  // (the dev-render defect) cannot recur.
  it("marks NOTHING ink when nothing genuinely fills — the fallback tightest-seats pick never wears the solid", () => {
    const untouched = PUBLIC_LEAGUES.map((league) => ({ ...league, filledTeams: 0 }));
    render(<OpenLeagueShelf house={[]} leagues={untouched} signedIn={false} asOfTime={AS_OF} />);
    for (const rendering of [rows(), cards()]) {
      expect(inkPillCount(rendering)).toBe(0);
    }
  });

  it("features the fullest filling room even when its kickoff has rolled — exactly one solid per rendering", () => {
    // The fix round's H1: while rolled rooms were disqualified, a board of rolled rooms wore no
    // solid at all and the round's stated P3 outcome never rendered. One per rendering, not one
    // per page: both renderings are in the DOM at every width and CSS picks which is seen.
    const rolled = { ...PUBLIC_LEAGUES[0]!, id: "rolled", name: "Rolled Room", filledTeams: 11, kickoffRolls: 2 };
    render(<OpenLeagueShelf house={[]} leagues={[rolled, { ...PUBLIC_LEAGUES[1]!, filledTeams: 0 }]} signedIn={false} asOfTime={AS_OF} />);
    for (const rendering of [rows(), cards()]) {
      expect(inkPillCount(rendering)).toBe(1);
      const ink = rendering.querySelector('a[class*="bg-accent"], button[class*="bg-accent"]');
      expect(ink?.getAttribute("aria-label")).toContain("Rolled Room");
    }
  });

  // 2026-08-25 founder finding: the hero's own "Next draft" module carries this league's ink
  // instead, so the shelf goes all-quiet rather than double-inking the same league.
  it("marks NOTHING ink, in either rendering, once the hero module carries the featured league (featuredInHero)", () => {
    const soon: PublicLeagueSummary = { ...PUBLIC_LEAGUES[0]!, id: "soonest", name: "Soonest Draft Room", filledTeams: 11 };
    render(
      <OpenLeagueShelf
        house={[HOUSE_LEAGUE]}
        leagues={[soon, PUBLIC_LEAGUES[1]!]}
        signedIn={false}
       
        asOfTime={AS_OF}
        featuredInHero
      />,
    );
    for (const rendering of [rows(), cards()]) {
      expect(inkPillCount(rendering)).toBe(0);
    }
  });

  it("marks every member league, and only member leagues, for e2e scoping in both renderings (data-testid='member-league')", () => {
    render(
      <OpenLeagueShelf house={[HOUSE_LEAGUE]} leagues={PUBLIC_LEAGUES} signedIn asOfTime={AS_OF} />,
    );
    for (const rendering of [rows(), cards()]) {
      const members = rendering.querySelectorAll('[data-testid="member-league"]');
      expect(members).toHaveLength(PUBLIC_LEAGUES.length);
      for (const member of members) expect(member.textContent).not.toContain(HOUSE_LEAGUE.name);
    }
  });

  // Front door blueprint (2026-09-02): every row and card verb opens the JOIN SHEET — the
  // sheet's own verb is what joins (signed in) or rides the hold interstitial (signed out).
  it("opens the join sheet from a verb, and the sheet carries the real join button signed in", () => {
    renderInLeague(
      <OpenLeagueShelf house={[HOUSE_LEAGUE]} leagues={PUBLIC_LEAGUES} signedIn asOfTime={AS_OF} />,
      fixtureLeagueDeps().deps,
    );
    for (const rendering of [rows(), cards()]) {
      // One opener per league in each rendering, each announcing the dialog it opens.
      const openers = within(rendering).getAllByRole("button", { name: /^Take (a seat|the last seat) in / });
      expect(openers).toHaveLength(1 + PUBLIC_LEAGUES.length);
      for (const opener of openers) expect(opener).toHaveAttribute("aria-haspopup", "dialog");
    }
    fireEvent.click(within(rows()).getByRole("button", { name: `Take a seat in ${HOUSE_LEAGUE.name}.` }));
    const sheet = screen.getByRole("dialog", { name: `Join ${HOUSE_LEAGUE.name}` });
    expect(within(sheet).getByRole("button", { name: ctaAccessibleName(HOUSE_LEAGUE) })).toBeInTheDocument();
  });

  it("opens the join sheet signed out too, whose verb rides the hold interstitial for THAT league", () => {
    render(<OpenLeagueShelf house={[HOUSE_LEAGUE]} leagues={PUBLIC_LEAGUES} signedIn={false} asOfTime={AS_OF} />);
    expect(screen.queryByRole("button", { name: /^Join / })).not.toBeInTheDocument();
    fireEvent.click(within(rows()).getByRole("button", { name: "Take the last seat in Sharks Only Auction." }));
    const sheet = screen.getByRole("dialog", { name: "Join Sharks Only Auction" });
    const verb = within(sheet).getByRole("link", { name: "Take the last seat in Sharks Only Auction." });
    expect(verb.getAttribute("href")).toContain(encodeURIComponent("/join/p2/hold"));
    // And the whole contract is on the sheet: the real hold duration, never a made-up one.
    expect(within(sheet).getByText(/Your seat is held for 10 minutes while you sign in\./)).toBeInTheDocument();
  });

  it("closes the sheet and returns to the board", () => {
    render(<OpenLeagueShelf house={[HOUSE_LEAGUE]} leagues={PUBLIC_LEAGUES} signedIn={false} asOfTime={AS_OF} />);
    fireEvent.click(within(rows()).getByRole("button", { name: `Take a seat in ${HOUSE_LEAGUE.name}.` }));
    expect(screen.getByRole("dialog", { name: `Join ${HOUSE_LEAGUE.name}` })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers a next action when no member league matches, rather than a dead end", async () => {
    await renderSurface(
      <OpenLeagueShelf house={[]} leagues={[]} signedIn asOfTime={AS_OF} />,
      async ({ container }) => {
        expect(screen.getByText("No open leagues match")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Clear the filters" })).toHaveAttribute("href", "/browse");
        expect(screen.getByRole("link", { name: "Start your own league" })).toHaveAttribute("href", "/app#create-league");
        // No cards, nothing to press: the legend has no ⓘ to point at.
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("keeps the house leagues standing beside the empty state when only the member list runs dry", () => {
    render(<OpenLeagueShelf house={[HOUSE_LEAGUE]} leagues={[]} signedIn asOfTime={AS_OF} />);
    // One heading per rendering — jsdom sees both; a browser shows exactly one (the lg boundary).
    expect(screen.getAllByRole("heading", { name: HOUSE_LEAGUE.name })).toHaveLength(2);
    expect(screen.getByText("No open leagues match")).toBeInTheDocument();
  });

  it("renders no progress bar", () => {
    const { container } = render(
      <OpenLeagueShelf house={[HOUSE_LEAGUE]} leagues={PUBLIC_LEAGUES} signedIn asOfTime={AS_OF} />,
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
