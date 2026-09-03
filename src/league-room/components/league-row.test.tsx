import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { REDUCED_MOTION_QUERY } from "@/design/use-reduced-motion";
import { renderSurface } from "@/components/ui/test-utils";
import { buttonClassName } from "@/components/ui";
import { UI_CONFIG } from "@/components/ui/config";
import { GLOSSARY } from "@/help/glossary";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { LEAGUE_ROW_GRID, LeagueRow, LeagueRowsHeader } from "./league-row";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function stubMatchMedia(reduced: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === REDUCED_MOTION_QUERY ? reduced : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const BASE: PublicLeagueSummary = {
  id: "hp241",
  name: "Half-PPR #241",
  format: "snake",
  experienceTier: "experienced",
  stakeTier: 0,
  entryFeeCents: 0,
  teamCount: 12,
  filledTeams: 9,
  scoringLabel: "Half PPR",
  compositionCategory: "open",
  draftAt: "Thursday 10 September, 8:00 PM UTC (in 3 days)",
  medianGame: false,
  startTrigger: "scheduled",
  houseRung: null,
  heldSeats: 0,
  rosterSummary: "15 slots, 1 flex",
  playoffWeeks: [15, 16, 17],
  kickoffRolls: 0,
};

/** A scheduled draft comfortably INSIDE `UI_CONFIG.openLeagueCard.clockWithinMs` (6h). */
const soonIso = () => new Date(Date.now() + UI_CONFIG.openLeagueCard.clockWithinMs / 2).toISOString();
/** A scheduled draft comfortably OUTSIDE the window. */
const farIso = () => new Date(Date.now() + UI_CONFIG.openLeagueCard.clockWithinMs * 4).toISOString();

const row = (league: PublicLeagueSummary, extra: Partial<Parameters<typeof LeagueRow>[0]> = {}) => (
  <LeagueRow league={league} signedIn={false} position={1} {...extra} />
);

/**
 * FOUNDER-ORDERED (2026-08-24, screenshot review): the shelf renders horizontal rows on lg+
 * viewports — "my eyes don't know where to focus" — one league per hairline-separated row,
 * six columns, sharing every derived fact (clock, chip, badge authority, CTA names) with
 * `OpenLeagueCard` through `open-league-shared.tsx` so the two forms can never drift apart.
 */
describe("LeagueRow", () => {
  it("lays the six columns on the one shared grid template the header row also uses", () => {
    const { container } = render(row(BASE));
    expect((container.firstElementChild as HTMLElement).className).toContain(LEAGUE_ROW_GRID);
  });

  it("keeps the league name a heading, in the tower's register — display face at its earned 700", () => {
    render(row(BASE));
    const heading = screen.getByRole("heading", { name: BASE.name });
    expect(heading.className).toContain("text-lg");
    expect(heading.className).toContain("font-display");
    expect(heading.className).toContain("font-bold");
  });

  it("folds team count, format, scoring and the beginner tier into the one shared format line", () => {
    render(row({ ...BASE, experienceTier: "beginner" }));
    expect(screen.getByText("12 teams")).toBeInTheDocument();
    expect(screen.getByText("Snake")).toBeInTheDocument();
    expect(screen.getByText("Half PPR")).toBeInTheDocument();
    expect(screen.getByText("newer players only")).toBeInTheDocument();
  });

  it("carries no tips and no captions — the words explain themselves (founder ruling, 2026-08-28)", () => {
    render(row(BASE));
    expect(screen.queryAllByRole("button", { name: /What is/ })).toHaveLength(0);
    expect(screen.queryByText(GLOSSARY["snake-draft"].short)).not.toBeInTheDocument();
  });

  // Sunday v5 (founder, 2026-08-28: "this table is boring... feels stagnant"): the Entry column
  // is deleted outright — every league is free this season, and a column with zero variance
  // carries no information. Position (`#`) took its place; the stake fact still says itself
  // once, in the name row's own badge (`the badge carries only what the title does not` below).
  it("leads the row with the board position, hero-numeral and tabular", () => {
    render(row(BASE, { position: 4 }));
    const numeral = screen.getByText("4");
    expect(numeral.className).toContain("tabular-nums");
    expect(numeral).toHaveAttribute("aria-hidden", "true");
  });

  it("states the seats-left hero number beside the segment meter, tabular", () => {
    const { container } = render(row(BASE));
    const microLabel = screen.getByText(/left of 12/);
    expect(microLabel.parentElement!.className).toContain("tabular-nums");
    expect(microLabel.parentElement!.textContent).toContain("3");
    expect(container.querySelector('[data-testid="seat-segments"]')).not.toBeNull();
  });

  it("keeps the seat sentence for screen readers — sr-only, never a second visible seat phrasing", () => {
    render(row({ ...BASE, heldSeats: 1 }));
    const sentence = screen.getByText(/9 of 12 seated\. 1 seat is being claimed right now\./);
    expect(sentence).toHaveClass("sr-only");
  });

  describe("the Drafts column (the Task 5 clock logic, one shared source)", () => {
    it("ticks in live mono red once a scheduled draft is inside the window", () => {
      render(row({ ...BASE, draftAtIso: soonIso() }));
      const clock = screen.getByTestId("draft-clock");
      expect(clock.className).toContain("text-negative");
      expect(clock.className).toContain("font-mono");
      expect(screen.queryByText(BASE.draftAt)).not.toBeInTheDocument();
    });

    it("keeps the absolute sentence when the draft is scheduled but not yet close", () => {
      render(row({ ...BASE, draftAtIso: farIso() }));
      expect(screen.queryByTestId("draft-clock")).not.toBeInTheDocument();
      // Law 1 (relativeFirst): the relative fact leads, and the absolute date drops to the
      // faint second line — split into its own element, never restated as one combined string.
      expect(screen.getByText("in 3 days")).toBeInTheDocument();
      expect(screen.getByText("Thursday 10 September, 8:00 PM UTC")).toBeInTheDocument();
    });

    it("prints a compact 'Drafts when full' value with the full commitment one press away, never a placeholder date (storefront review E1)", () => {
      render(row({ ...BASE, startTrigger: "when_full" }));
      expect(screen.getByText("Drafts when full")).toBeInTheDocument();
      // No tip: "Drafts when full" is the self-explaining register the no-tips ruling asks for.
      expect(screen.queryByRole("button", { name: "What is a sit-and-go league?" })).not.toBeInTheDocument();
      expect(screen.queryByText(/This one drafts the moment the last seat is taken/)).not.toBeInTheDocument();
      expect(screen.queryByText(BASE.draftAt)).not.toBeInTheDocument();
    });

    it("keeps the kickoff-roll disclosure beside a rolled date", () => {
      render(row({ ...BASE, kickoffRolls: 1 }));
      expect(screen.getByText(/moved/i)).toBeInTheDocument();
    });
  });

  describe("the live chip — the same derived-only states the card shows", () => {
    it("reads Filling when the remaining seats fall under the seat meter's own low threshold", () => {
      render(row({ ...BASE, filledTeams: BASE.teamCount - 2 }));
      expect(screen.getByText("Filling")).toBeInTheDocument();
    });

    it("reads On deck inside the clock window, outranking Filling", () => {
      render(row({ ...BASE, filledTeams: BASE.teamCount - 2, draftAtIso: soonIso() }));
      expect(screen.getByText("On deck")).toBeInTheDocument();
      expect(screen.queryByText("Filling")).not.toBeInTheDocument();
    });

    it("renders no chip when nothing is genuinely live", () => {
      render(row(BASE));
      expect(screen.queryByText("Filling")).not.toBeInTheDocument();
      expect(screen.queryByText("On deck")).not.toBeInTheDocument();
    });

    it("pulses only for a visitor who has not asked for reduced motion", () => {
      stubMatchMedia(false);
      const { container, unmount } = render(row({ ...BASE, filledTeams: BASE.teamCount - 1 }));
      expect(container.querySelector(".animate-pulse-live")).not.toBeNull();
      unmount();

      stubMatchMedia(true);
      const reduced = render(row({ ...BASE, filledTeams: BASE.teamCount - 1 }));
      expect(reduced.container.querySelector(".animate-pulse-live")).toBeNull();
    });
  });

  describe("the badge carries only what the title does not (E3), by authority", () => {
    it("renders no rung badge on a house row — the factory title carries the rung by construction", () => {
      // "The Longshot League" — a real `houseLeagueName("open_12", 3)` output (founder directive
      // 2026-08-26), not the retired "Open 12-team League 3" shape. The badge itself is decided
      // by authority (`stakeBadge`, `@/league-room/components/open-league-shared.tsx`), never by
      // inspecting the title text, so a fun name proves the same invariant just as well: exactly
      // one "Free" text renders (the Entry value), never a second one for a stake badge.
      render(row({ ...BASE, id: "house3", name: "The Longshot League", houseRung: "open_12" }));
      expect(screen.queryAllByText("Free")).toHaveLength(0);
    });

    it("badges a member row with its stake tier, whatever the member named the league", () => {
      render(row({ ...BASE, id: "member2", name: "Free For All League", houseRung: null }));
      // Exactly one exact "Free" text: the stake badge (the Entry column is gone, v5).
      expect(screen.getAllByText("Free")).toHaveLength(1);
    });
  });

  describe("the action pill — the identical CTA contract the card holds", () => {
    it("keeps every ctaAccessibleName verbatim for a signed-out visitor, into the hold interstitial", () => {
      render(row({ ...BASE, experienceTier: "beginner", filledTeams: 11, id: "median13", name: "Median #13" }));
      expect(screen.getByRole("link", { name: "Take the last seat in Median #13. Newer players only." })).toHaveAttribute(
        "href",
        "/sign-in?returnTo=%2Fjoin%2Fmedian13%2Fhold",
      );
    });

    it("renders through the pill map, quiet unless the parent grants ink (rule 5)", () => {
      const quiet = render(row(BASE));
      expect(screen.getByRole("link", { name: "Take a seat in Half-PPR #241." }).className).toBe(buttonClassName("secondary", "md"));
      quiet.unmount();

      render(row(BASE, { emphasis: "ink" }));
      // Sunday v5: a granted row wears the amber VERB, not the v3 ink pill.
      expect(screen.getByRole("link", { name: "Take a seat in Half-PPR #241." }).className).toBe(buttonClassName("verb", "md"));
    });

    it("gives a signed-in visitor the real join button", () => {
      render(row(BASE, { signedIn: true }));
      expect(screen.getByRole("button", { name: `Join ${BASE.name}` })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /Take/ })).not.toBeInTheDocument();
    });
  });

  it("is axe-clean in both themes", async () => {
    await renderSurface(row(BASE), async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});

describe("LeagueRowsHeader", () => {
  it("names the columns once, eyebrow register, sentence case, hidden from assistive tech (each cell carries its own key)", () => {
    const { container } = render(<LeagueRowsHeader />);
    const header = container.firstElementChild as HTMLElement;
    expect(header.getAttribute("aria-hidden")).toBe("true");
    expect(header.className).toContain("font-mono");
    expect(header.className).toContain(LEAGUE_ROW_GRID);
    // Sunday v5: the Entry column is gone (every league is free this season), and `#` leads —
    // the board is ranked by seats remaining, so the room that fires next reads as P1.
    for (const label of ["#", "League", "Format", "Drafts", "Seats"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText("Entry")).not.toBeInTheDocument();
    expect(screen.queryByText("LEAGUE")).not.toBeInTheDocument();
  });
});
