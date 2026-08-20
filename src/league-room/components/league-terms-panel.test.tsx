import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
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
  commissionerName: "Alex Rivera",
  commissionerAvatar: "preset:crown",
};

describe("LeagueTermsPanel", () => {
  it("names the league, its format, size, scoring, roster, stake and commissioner, in both themes, axe-clean", async () => {
    await inBothThemes(<LeagueTermsPanel terms={TERMS} />, async ({ container }) => {
      expect(screen.getByRole("heading", { name: "Sunday Money" })).toBeInTheDocument();
      expect(screen.getByText("Snake")).toBeInTheDocument();
      expect(screen.getByText("8 of 12 managers")).toBeInTheDocument();
      expect(screen.getByText("PPR")).toBeInTheDocument();
      expect(screen.getByText(TERMS.rosterLine)).toBeInTheDocument();
      expect(screen.getByText("Friendly")).toBeInTheDocument();
      expect(screen.getByText(MATCHMAKING_CONFIG.stakeDisclosure)).toBeInTheDocument();
      expect(screen.getByText("Alex Rivera")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("gives format and scoring their own InfoTip", () => {
    render(<LeagueTermsPanel terms={TERMS} />);
    expect(screen.getByRole("button", { name: "What is a snake draft?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What is PPR?" })).toBeInTheDocument();
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
    expect(labels).toEqual(["Format", "Stake", "Size", "Scoring", "Roster", "Commissioner"]);
  });
});
