import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { LeagueTerms } from "@/league";
import { LeagueTermsPanel } from "./league-terms-panel";

const TERMS: LeagueTerms = {
  name: "Sunday Money",
  format: "snake",
  teamCount: 12,
  filledTeams: 8,
  scoringLabel: "PPR",
  rosterLine: "1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 K, 1 DEF, 6 bench",
  stakeLabel: "Friendly",
  stakeDisclosure: MATCHMAKING_CONFIG.stakeDisclosure,
  entryFeeCents: 0,
  commissionerName: "Alex Rivera",
  commissionerAvatar: "preset:crown",
  draftAt: "Saturday 12 September, 7:00 PM UTC (in 3 days)",
  formatNotes: [],
};

describe("LeagueTermsPanel", () => {
  it("names the league, its format, size, scoring, roster, stake, draft time and commissioner, in both themes, axe-clean", async () => {
    await renderSurface(<LeagueTermsPanel terms={TERMS} />, async ({ container }) => {
      expect(screen.getByRole("heading", { name: "Sunday Money" })).toBeInTheDocument();
      expect(screen.getByText("Snake")).toBeInTheDocument();
      // F17: converged onto SeatMeter's own sentence, not this panel's own "N of N managers".
      expect(screen.getByText("8 of 12 seated")).toBeInTheDocument();
      expect(screen.getByText("PPR")).toBeInTheDocument();
      expect(screen.getByText(TERMS.rosterLine)).toBeInTheDocument();
      expect(screen.getByText("Friendly")).toBeInTheDocument();
      expect(screen.getByText(MATCHMAKING_CONFIG.stakeDisclosure)).toBeInTheDocument();
      expect(screen.getByText(TERMS.draftAt)).toBeInTheDocument();
      expect(screen.getByText("Alex Rivera")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("gives format and scoring their own InfoTip", () => {
    render(<LeagueTermsPanel terms={TERMS} />);
    expect(screen.getByRole("button", { name: "What is a snake draft?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What is PPR?" })).toBeInTheDocument();
  });

  // A15: the "stake-tier" glossary term's InfoTip caller.
  it("gives Stake its own InfoTip", () => {
    render(<LeagueTermsPanel terms={TERMS} />);
    expect(screen.getByRole("button", { name: "What is a stake tier?" })).toBeInTheDocument();
  });

  it("leaves Standard scoring untipped — it is already plain English", () => {
    render(<LeagueTermsPanel terms={{ ...TERMS, scoringLabel: "Standard" }} />);
    expect(screen.getByText("Standard")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "What is Standard?" })).not.toBeInTheDocument();
  });

  it("renders the auction format with its own InfoTip too", () => {
    render(<LeagueTermsPanel terms={{ ...TERMS, format: "auction" }} />);
    expect(screen.getByText("Auction")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What is an auction draft?" })).toBeInTheDocument();
  });

  it("opens an InfoTip's definition inline for a guided reader", () => {
    render(<LeagueTermsPanel terms={TERMS} helpLevel="guided" />);
    expect(screen.getAllByText(/snake back and forth/).length).toBeGreaterThan(0);
  });

  // Veteran persona review, fix round 1: this is a real-money decision, so the money fact
  // (Stake) reads right after Format — before Size, Scoring or Roster — rather than buried
  // second-to-last.
  it("puts Stake right after Format — the money fact a real-money decision reads first", () => {
    render(<LeagueTermsPanel terms={TERMS} />);
    const labels = screen.getAllByRole("term").map((node) => node.textContent);
    expect(labels).toEqual(["Format", "Stake", "Size", "Scoring", "Roster", "Draft", "Commissioner"]);
  });

  // Task 9 e2e regression (league-lifecycle.spec.ts): on the invite page there is no other
  // heading naming the league, so the default (`titleAs` omitted) keeps rendering an `h2` — this
  // is JoinForm's real, primary heading for its content.
  it("renders its name as a real heading by default, for the invite page", () => {
    render(<LeagueTermsPanel terms={TERMS} />);
    expect(screen.getByRole("heading", { name: "Sunday Money" }).tagName).toBe("H2");
  });

  // `LeagueHome` passes `titleAs="p"` because its own page `h1` already carries the league's
  // name — a second element exposed with `role="heading"` and the SAME accessible name is what
  // broke `league-lifecycle.spec.ts`'s `getByRole("heading", { name })` with a strict-mode
  // ambiguity. `terms.name` still renders, just not as a competing heading.
  it("renders its name as plain text, not a second heading, when embedded on a page with its own heading", async () => {
    await renderSurface(<LeagueTermsPanel terms={TERMS} titleAs="p" />, async ({ container }) => {
      expect(screen.queryByRole("heading", { name: "Sunday Money" })).not.toBeInTheDocument();
      expect(screen.getByText("Sunday Money").tagName).toBe("P");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  // Task 3 (Phase 3.5): a prospect reading the invite, or a member reading league home, learns
  // any facts `scoringLabel`/`rosterLine` alone don't already say. Inverted assertion first —
  // `TERMS.formatNotes` is `[]`, the plain-league default, and no "Notes" row renders at all.
  it("shows no Notes row for a league with nothing extra to say", () => {
    render(<LeagueTermsPanel terms={TERMS} />);
    expect(screen.queryByText("Notes")).not.toBeInTheDocument();
  });

  // Phase 3.5, Task 8 fix round 1 (review HIGH). `LeagueTermsPanel` never reads `startTrigger`
  // itself — `leagueTerms()` (`@/league`) already decided what `draftAt` says before this panel
  // ever sees it — so this only has to prove the panel renders WHATEVER `draftAt` carries, for
  // both the fills-truth sentence and an ordinary date, never a fabricated one.
  it("renders the fills-truth sentence a when_full league's terms carry, instead of a date", () => {
    render(<LeagueTermsPanel terms={{ ...TERMS, draftAt: "Starts as soon as it fills" }} />);
    expect(screen.getByText("Starts as soon as it fills")).toBeInTheDocument();
    expect(screen.queryByText(TERMS.draftAt)).not.toBeInTheDocument();
  });

  // Inverted: an ordinary scheduled league's terms render byte-identically to how this panel has
  // always rendered them — untouched by the fix.
  it("renders an ordinary scheduled league's real draft date, unchanged", () => {
    render(<LeagueTermsPanel terms={TERMS} />);
    expect(screen.getByText(TERMS.draftAt)).toBeInTheDocument();
    expect(screen.queryByText("Starts as soon as it fills")).not.toBeInTheDocument();
  });

  it("lists every format note, in the order the league sent them, in both themes, axe-clean", async () => {
    const withNotes = {
      ...TERMS,
      formatNotes: ["Every team also plays the league median each week.", "Superflex: you can start a second quarterback."],
    };
    await renderSurface(<LeagueTermsPanel terms={withNotes} />, async ({ container }) => {
      expect(screen.getByText("Notes")).toBeInTheDocument();
      expect(screen.getByText("Every team also plays the league median each week.")).toBeInTheDocument();
      expect(screen.getByText("Superflex: you can start a second quarterback.")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
