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
  <LeagueRow league={league} signedIn={false} {...extra} />
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

  it("keeps the league name a heading, in the ledger-card register (16.5/600, sentence case)", () => {
    render(row(BASE));
    const heading = screen.getByRole("heading", { name: BASE.name });
    expect(heading.className).toContain("text-lg");
    expect(heading.className).toContain("font-semibold");
  });

  it("folds team count, format, scoring and the beginner tier into the one shared format line", () => {
    render(row({ ...BASE, experienceTier: "beginner" }));
    expect(screen.getByText("12 teams")).toBeInTheDocument();
    expect(screen.getByText("Snake")).toBeInTheDocument();
    expect(screen.getByText("Half PPR")).toBeInTheDocument();
    expect(screen.getByText("newer players only")).toBeInTheDocument();
  });

  it("keeps InfoTips click-only in a row — guided captions never print inline, there is no helpLevel to ask", () => {
    render(row(BASE));
    expect(screen.getByRole("button", { name: "What is a snake draft?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What is Half PPR?" })).toBeInTheDocument();
    expect(screen.queryByText(GLOSSARY["snake-draft"].short)).not.toBeInTheDocument();
    expect(screen.queryByText(GLOSSARY["half-ppr"].short)).not.toBeInTheDocument();
  });

  it("prices the Entry column in money green, semibold, with an sr-only key for screen readers", () => {
    render(row(BASE));
    const entry = screen.getAllByText("Free").find((element) => element.className.includes("text-positive"));
    expect(entry).toBeDefined();
    expect(entry!.className).toContain("font-semibold");
    expect(screen.getByText("Entry")).toHaveClass("sr-only");
  });

  // Phase 4, Task 13: the live branch, proven through injection — no league that exists today
  // carries `entryFeeCents > 0` (`moneyIsLive()` gates paid creation dark), so this fixture is
  // the only way to exercise the column's real-money reading ahead of that day.
  it("prices the Entry column from the real entry fee, once a league carries one", () => {
    render(row({ ...BASE, entryFeeCents: 5000 }));
    const entry = screen.getByText("$50.00");
    expect(entry.className).toContain("text-positive");
    expect(entry.className).toContain("font-semibold");
  });

  it("counts the Seats column as '{n} of {t} open', tabular, with the segment meter beside it", () => {
    const { container } = render(row(BASE));
    const seats = screen.getByText("3 of 12 open");
    expect(seats.className).toContain("tabular-nums");
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
      expect(screen.getByText(BASE.draftAt)).toBeInTheDocument();
    });

    it("quotes the when-full sentence muted, never a placeholder date", () => {
      render(row({ ...BASE, startTrigger: "when_full" }));
      const sentence = screen.getByText(/This one drafts the moment the last seat is taken/);
      expect(sentence.className).toContain("text-text-muted");
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
      render(row({ ...BASE, id: "house3", name: "Open 12-team League 3", houseRung: "open_12" }));
      expect(screen.getAllByText(/Open 12-team/)).toHaveLength(1);
    });

    it("badges a member row with its stake tier, whatever the member named the league", () => {
      render(row({ ...BASE, id: "member2", name: "Free For All League", houseRung: null }));
      // Exactly two exact "Free" texts: the stake badge and the Entry value.
      expect(screen.getAllByText("Free")).toHaveLength(2);
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
      expect(screen.getByRole("link", { name: "Take a seat in Half-PPR #241." }).className).toBe(buttonClassName("primary", "md"));
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
  it("names the five columns once, eyebrow register, sentence case, hidden from assistive tech (each cell carries its own key)", () => {
    const { container } = render(<LeagueRowsHeader />);
    const header = container.firstElementChild as HTMLElement;
    expect(header.getAttribute("aria-hidden")).toBe("true");
    expect(header.className).toContain("font-mono");
    expect(header.className).toContain(LEAGUE_ROW_GRID);
    for (const label of ["League", "Format", "Drafts", "Entry", "Seats"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText("LEAGUE")).not.toBeInTheDocument();
  });
});
