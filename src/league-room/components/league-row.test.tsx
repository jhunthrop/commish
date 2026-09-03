import { describe, it, expect, afterEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { REDUCED_MOTION_QUERY } from "@/design/use-reduced-motion";
import { renderSurface } from "@/components/ui/test-utils";
import { buttonClassName } from "@/components/ui";
import { UI_CONFIG } from "@/components/ui/config";
import { GLOSSARY } from "@/help/glossary";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { LEAGUE_ROW_GRID, LEAGUE_ROW_GRID_LIVE, LeagueRow, LeagueRowsHeader } from "./league-row";

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

/** A paid league as only a live-money world could store one — real fee, real stored table. */
const PAID: PublicLeagueSummary = {
  ...BASE,
  id: "paid1",
  name: "Paid League",
  entryFeeCents: 5000,
  payoutTable: [
    { place: 1, amountCents: 30000 },
    { place: 2, amountCents: 20000 },
    { place: 3, amountCents: 10000 },
  ],
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
 * viewports — one league per hairline-separated row, position-led (the tower), sharing every
 * derived fact with `OpenLeagueCard` through `open-league-shared.tsx`. Reconciled to the v5
 * tower row (2026-09-02, the deferred-tests campaign's own settle-up) and extended with the
 * front door blueprint's money columns and join-sheet opener.
 */
describe("LeagueRow", () => {
  it("lays the free-season columns on the one shared grid template the header row also uses", () => {
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

  it("leads with the board position, hidden from assistive tech (the verb carries the spoken name)", () => {
    const { container } = render(row(BASE, { position: 3 }));
    const position = container.querySelector('[aria-hidden="true"]');
    expect(position?.textContent).toBe("3");
  });

  describe("the money columns (front door blueprint, both states by injection)", () => {
    it("renders NO money column at all while money is dark — zero variance is zero information", () => {
      render(row(BASE, { live: false }));
      // Exactly ONE "Free": the member row's stake badge. No buy-in cell, no dollar anywhere.
      expect(screen.getAllByText("Free")).toHaveLength(1);
      expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
      expect(screen.queryByText("Bragging rights")).not.toBeInTheDocument();
    });

    it("prices the buy-in column from the real entry fee and pots the STORED table, once live", () => {
      const { container } = render(row(PAID, { live: true }));
      expect((container.firstElementChild as HTMLElement).className).toContain(LEAGUE_ROW_GRID_LIVE);
      expect(screen.getByText("$50.00")).toBeInTheDocument();
      // The pot is prizePotCents of the stored table with its places note, never fee × seats.
      expect(screen.getByText("$600.00")).toBeInTheDocument();
      expect(screen.getByText("top 3 paid")).toBeInTheDocument();
    });

    it("says 'Free' and 'Bragging rights' for a free league on a live shelf — real cells, no fabricated dollar", () => {
      render(row(BASE, { live: true }));
      // Two "Free" texts now: the stake badge and the buy-in cell.
      expect(screen.getAllByText("Free")).toHaveLength(2);
      expect(screen.getByText("Bragging rights")).toBeInTheDocument();
    });
  });

  it("makes seats-left the row's hero number, tabular, with the segment meter under it", () => {
    const { container } = render(row(BASE));
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText(/left of/)).toBeInTheDocument();
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

    it("leads with the relative fact outside the window, the absolute date on the faint line (v5 law 1)", () => {
      render(row({ ...BASE, draftAtIso: farIso() }));
      expect(screen.queryByTestId("draft-clock")).not.toBeInTheDocument();
      expect(screen.getByText("in 3 days")).toBeInTheDocument();
      expect(screen.getByText("Thursday 10 September, 8:00 PM UTC")).toBeInTheDocument();
    });

    it("prints a compact 'Drafts when full' value, never a placeholder date (storefront review E1)", () => {
      render(row({ ...BASE, startTrigger: "when_full" }));
      expect(screen.getByText("Drafts when full")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "What is a sit-and-go league?" })).not.toBeInTheDocument();
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
      render(row({ ...BASE, id: "house3", name: "The Longshot League", houseRung: "open_12" }));
      expect(screen.queryByText("Free")).not.toBeInTheDocument();
    });

    it("badges a member row with its stake tier, whatever the member named the league", () => {
      render(row({ ...BASE, id: "member2", name: "Free For All League", houseRung: null }));
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

  describe("the join-sheet opener (front door blueprint, 2026-09-02)", () => {
    it("turns the verb into the sheet opener when onOpen is provided — same name, dialog announced", () => {
      const onOpen = vi.fn();
      render(row(BASE, { onOpen }));
      const verb = screen.getByRole("button", { name: "Take a seat in Half-PPR #241." });
      expect(verb).toHaveAttribute("aria-haspopup", "dialog");
      fireEvent.click(verb);
      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("link", { name: /Take/ })).not.toBeInTheDocument();
    });

    it("opens the same sheet from a tap anywhere on the row — a pointer convenience onto the one act", () => {
      const onOpen = vi.fn();
      const { container } = render(row(BASE, { onOpen }));
      fireEvent.click(container.firstElementChild as HTMLElement);
      expect(onOpen).toHaveBeenCalled();
      expect((container.firstElementChild as HTMLElement).className).toContain("cursor-pointer");
    });
  });

  it("is axe-clean in both themes", async () => {
    await renderSurface(row(BASE), async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});

describe("LeagueRowsHeader", () => {
  it("names the free-season columns once, eyebrow register, hidden from assistive tech", () => {
    const { container } = render(<LeagueRowsHeader live={false} />);
    const header = container.firstElementChild as HTMLElement;
    expect(header.getAttribute("aria-hidden")).toBe("true");
    expect(header.className).toContain("font-mono");
    expect(header.className).toContain(LEAGUE_ROW_GRID);
    for (const label of ["League", "Format", "Drafts", "Seats"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText("Buy-in")).not.toBeInTheDocument();
    expect(screen.queryByText("LEAGUE")).not.toBeInTheDocument();
  });

  it("adds Buy-in and The pot on the live template, and only then", () => {
    const { container } = render(<LeagueRowsHeader live />);
    expect((container.firstElementChild as HTMLElement).className).toContain(LEAGUE_ROW_GRID_LIVE);
    expect(screen.getByText("Buy-in")).toBeInTheDocument();
    expect(screen.getByText("The pot")).toBeInTheDocument();
  });
});
