import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { REDUCED_MOTION_QUERY } from "@/design/use-reduced-motion";
import { renderSurface } from "@/components/ui/test-utils";
import { buttonClassName } from "@/components/ui";
import { UI_CONFIG } from "@/components/ui/config";
import { GLOSSARY } from "@/help/glossary";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { OpenLeagueCard } from "./open-league-card";

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

// join-flow-panel.md, HIGH: "the moment it fills" is honestly distinct from a date and says
// nothing about the commitment, which is being reachable on short notice. F9/C5: this card does
// not phrase the promise — `describeStartTiming` does, and this card and the waiting room quote
// the identical string, reassurance second.
const WHEN_FULL: PublicLeagueSummary = {
  ...BASE,
  id: "sf78",
  name: "Superflex #78",
  startTrigger: "when_full",
  filledTeams: 4,
};

const BEGINNERS_ONLY_LAST_SEAT: PublicLeagueSummary = {
  ...BASE,
  id: "median13",
  name: "Median #13",
  experienceTier: "beginner",
  filledTeams: 11,
};

/** A scheduled draft comfortably INSIDE `UI_CONFIG.openLeagueCard.clockWithinMs` (6h). */
const soonIso = () => new Date(Date.now() + UI_CONFIG.openLeagueCard.clockWithinMs / 2).toISOString();
/** A scheduled draft comfortably OUTSIDE the window. */
const farIso = () => new Date(Date.now() + UI_CONFIG.openLeagueCard.clockWithinMs * 4).toISOString();

const card = (league: PublicLeagueSummary, extra: Partial<Parameters<typeof OpenLeagueCard>[0]> = {}) => (
  <OpenLeagueCard league={league} signedIn={false} helpLevel="standard" {...extra} />
);

describe("OpenLeagueCard", () => {
  it("tells a when-full joiner what they are actually agreeing to, in the one sentence that owns it, as reassurance not warning", () => {
    render(card(WHEN_FULL));
    const sentence = screen.getByText(
      "This one drafts the moment the last seat is taken. We tell you as soon as it fills, and the room opens a few minutes after that. You do not have to wait here.",
    );
    expect(sentence).toBeInTheDocument();
    // E5: `warning` is reserved for a tightening clock; this sentence is reassurance, muted.
    expect(sentence.className).toContain("text-text-muted");
    expect(sentence.className).not.toContain("text-warning");
    // Never both a date and the sentence — the placeholder kickoff is never rendered as if
    // somebody chose it.
    expect(screen.queryByText(BASE.draftAt)).not.toBeInTheDocument();
  });

  it("says who a league is for before the button, not after the refusal", () => {
    render(card(BEGINNERS_ONLY_LAST_SEAT));
    expect(screen.getByRole("link", { name: "Take the last seat in Median #13. Newer players only." })).toBeInTheDocument();
  });

  it("says 'a seat', not 'the last seat', when more than one remains", () => {
    render(card(BASE));
    expect(screen.getByRole("link", { name: "Take a seat in Half-PPR #241." })).toBeInTheDocument();
  });

  it("folds team count, format, scoring and the beginner tier into one dot-separated format line (F1, S7)", () => {
    render(card(BEGINNERS_ONLY_LAST_SEAT));
    expect(screen.getByText("12 teams")).toBeInTheDocument();
    expect(screen.getByText("Snake")).toBeInTheDocument();
    expect(screen.getByText("Half PPR")).toBeInTheDocument();
    expect(screen.getByText("newer players only")).toBeInTheDocument();
  });

  it("says nothing about newer players on an open card's format line", () => {
    render(card(BASE));
    expect(screen.queryByText("newer players only")).not.toBeInTheDocument();
  });

  it("shows the five ledger facts a veteran shops on, in both themes, axe-clean (S7)", async () => {
    await renderSurface(card(BASE), async ({ container }) => {
      expect(screen.getByText("Drafts")).toBeInTheDocument();
      expect(screen.getByText("Entry")).toBeInTheDocument();
      expect(screen.getByText("Seats")).toBeInTheDocument();
      expect(screen.getByText("Roster")).toBeInTheDocument();
      expect(screen.getByText("Playoffs")).toBeInTheDocument();
      expect(screen.getByText("Thursday 10 September, 8:00 PM UTC (in 3 days)")).toBeInTheDocument();
      expect(screen.getByText("3 of 12 open")).toBeInTheDocument();
      expect(screen.getByText("15 slots, 1 flex")).toBeInTheDocument();
      expect(screen.getByText("Weeks 15, 16 and 17")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("prices the Entry row in money green — every league is free this season, and the label says so", () => {
    // "Free" also appears as the member card's stake badge — the Entry row's value is the one
    // in the money-green register.
    render(card(BASE));
    const entry = screen.getAllByText("Free").find((element) => element.className.includes("text-positive"));
    expect(entry).toBeDefined();
    expect(entry!.className).toContain("font-semibold");
  });

  // Phase 4, Task 13: the live branch, proven through injection — no league that exists today
  // carries `entryFeeCents > 0` (`moneyIsLive()` gates paid creation dark), so this fixture is
  // the only way to exercise the row's real-money reading ahead of that day.
  it("prices the Entry row from the real entry fee, once a league carries one", () => {
    // `stakeTier` stays cosmetic (`stakeBadge` still reads "Free" from it, unchanged) — only the
    // Entry ROW switches from the tier label to the real fee.
    render(card({ ...BASE, entryFeeCents: 5000 }));
    const entry = screen.getByText("$50.00");
    expect(entry.className).toContain("text-positive");
    expect(entry.className).toContain("font-semibold");
  });

  describe("the ledger clock (rule 6)", () => {
    it("ticks the Drafts value in live red once a scheduled draft is inside the window", () => {
      render(card({ ...BASE, draftAtIso: soonIso() }));
      const clock = screen.getByTestId("draft-clock");
      expect(clock.className).toContain("text-negative");
      expect(clock.className).toContain("font-mono");
      // The coarse aria-live sibling `Countdown` always pairs with its digits.
      expect(screen.getByText(/About 3 hours left/)).toHaveAttribute("aria-live", "polite");
      expect(screen.queryByText(BASE.draftAt)).not.toBeInTheDocument();
    });

    it("keeps the absolute sentence when the draft is scheduled but not yet close", () => {
      render(card({ ...BASE, draftAtIso: farIso() }));
      expect(screen.queryByTestId("draft-clock")).not.toBeInTheDocument();
      expect(screen.getByText(BASE.draftAt)).toBeInTheDocument();
    });

    it("keeps the absolute sentence when the summary carries no instant at all", () => {
      render(card(BASE));
      expect(screen.queryByTestId("draft-clock")).not.toBeInTheDocument();
      expect(screen.getByText(BASE.draftAt)).toBeInTheDocument();
    });
  });

  describe("the live chip — derived-only, never a stored flag", () => {
    it("reads Filling when the remaining seats fall under the seat meter's own low threshold", () => {
      render(card({ ...BASE, filledTeams: BASE.teamCount - 2 }));
      expect(screen.getByText("Filling")).toBeInTheDocument();
    });

    it("reads On deck when a scheduled draft is inside the clock window, outranking Filling", () => {
      render(card({ ...BASE, filledTeams: BASE.teamCount - 2, draftAtIso: soonIso() }));
      expect(screen.getByText("On deck")).toBeInTheDocument();
      expect(screen.queryByText("Filling")).not.toBeInTheDocument();
    });

    it("renders no chip when nothing is genuinely live", () => {
      render(card(BASE));
      expect(screen.queryByText("Filling")).not.toBeInTheDocument();
      expect(screen.queryByText("On deck")).not.toBeInTheDocument();
    });

    it("pulses its dot only for a visitor who has not asked for reduced motion", () => {
      stubMatchMedia(false);
      const { container, unmount } = render(card({ ...BASE, filledTeams: BASE.teamCount - 1 }));
      expect(container.querySelector(".animate-pulse-live")).not.toBeNull();
      unmount();

      stubMatchMedia(true);
      const reduced = render(card({ ...BASE, filledTeams: BASE.teamCount - 1 }));
      expect(screen.getByText("Filling")).toBeInTheDocument();
      expect(reduced.container.querySelector(".animate-pulse-live")).toBeNull();
    });
  });

  describe("the badge carries only what the title does not (E3) — decided by authority, never by user text", () => {
    it("renders no rung badge on a house card — the factory title carries the rung by construction", () => {
      render(card({ ...BASE, id: "house3", name: "Open 12-team League 3", houseRung: "open_12" }));
      // The rung reaches the reader exactly once, via the title.
      expect(screen.getByRole("heading", { name: "Open 12-team League 3" })).toBeInTheDocument();
      expect(screen.getAllByText(/Open 12-team/)).toHaveLength(1);
    });

    it("badges a member league with its stake tier", () => {
      render(card({ ...BASE, id: "member1", houseRung: null }));
      // "Free" appears as the stake badge AND as the Entry row's value.
      expect(screen.getAllByText("Free").length).toBeGreaterThanOrEqual(2);
    });

    it("keeps the stake badge on a member league whose NAME happens to contain the label", () => {
      // Review HIGH (fix round 1): the earlier substring test on the league name silently
      // stripped this card's badge — a member's arbitrary name must never decide it.
      render(card({ ...BASE, id: "member2", name: "Free For All League", houseRung: null }));
      // Exactly two exact "Free" texts survive: the stake badge and the Entry row's value —
      // the title node is "Free For All League", never an exact match.
      expect(screen.getAllByText("Free")).toHaveLength(2);
    });
  });

  it("gives a signed-in visitor a real join button, quiet by default", () => {
    render(card(BASE, { signedIn: true }));
    expect(screen.getByRole("button", { name: `Join ${BASE.name}` })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Take/ })).not.toBeInTheDocument();
  });

  it("renders the CTA through the pill map, quiet unless the parent grants ink (rule 5)", () => {
    const quiet = render(card(BASE));
    expect(screen.getByRole("link", { name: "Take a seat in Half-PPR #241." }).className).toBe(buttonClassName("secondary", "md"));
    quiet.unmount();

    render(card(BASE, { emphasis: "ink" }));
    expect(screen.getByRole("link", { name: "Take a seat in Half-PPR #241." }).className).toBe(buttonClassName("primary", "md"));
  });

  it("sends a signed-out visitor into the hold interstitial for THIS league", () => {
    render(card(BASE));
    expect(screen.getByRole("link", { name: "Take a seat in Half-PPR #241." })).toHaveAttribute(
      "href",
      `/sign-in?returnTo=%2Fjoin%2F${BASE.id}%2Fhold`,
    );
  });

  it("offers the escape hatch to experienced players on a beginner-only card, and nowhere else", () => {
    const beginner = render(card(BEGINNERS_ONLY_LAST_SEAT));
    expect(screen.getByText(/Reserved for players newer to Commish/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse leagues open to everyone" })).toHaveAttribute(
      "href",
      "/browse?experienceTier=experienced",
    );
    beginner.unmount();

    render(card(BASE));
    expect(screen.queryByText(/Reserved for players newer to Commish/)).not.toBeInTheDocument();
  });

  it("shows a live hold through SeatMeter's own clause", () => {
    render(card({ ...BASE, heldSeats: 1 }));
    expect(screen.getByText(/1 seat is being claimed right now/)).toBeInTheDocument();
  });

  it("carries an InfoTip on the format, the scoring label and the playoffs", () => {
    render(card(BASE));
    expect(screen.getByRole("button", { name: "What is a snake draft?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What is Half PPR?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What is the playoff bracket?" })).toBeInTheDocument();
  });

  describe("helpLevel is the caller's decision, never a constant (D1, E7)", () => {
    it("keeps inline captions for a guided caller", () => {
      render(card(BASE, { helpLevel: "guided" }));
      expect(screen.getByText(GLOSSARY["snake-draft"].short)).toBeInTheDocument();
    });

    it("keeps definitions one click away, not inline, for a standard caller", () => {
      render(card(BASE));
      expect(screen.queryByText(GLOSSARY["snake-draft"].short)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "What is a snake draft?" })).toBeInTheDocument();
    });
  });
});
