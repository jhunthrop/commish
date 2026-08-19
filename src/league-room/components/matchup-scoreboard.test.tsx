import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import type { MatchupSummary } from "../contract";
import { MatchupScoreboard } from "./matchup-scoreboard";

const FINAL: MatchupSummary = {
  weekNumber: 3,
  homeTeamId: "t1",
  awayTeamId: "t2",
  homeTeamName: "Bay Bandits",
  awayTeamName: "Iron Owls",
  homeScore: 121.4,
  awayScore: 98.62,
  final: true,
};

describe("MatchupScoreboard", () => {
  it("shows both names and scores with the winner keeping full ink, in both themes, axe-clean", async () => {
    await inBothThemes(<MatchupScoreboard matchup={FINAL} myTeamId="t1" />, async ({ container }) => {
      expect(screen.getByText("121.40")).toBeInTheDocument();
      expect(screen.getByText("98.62")).toBeInTheDocument();
      expect(screen.getByText("Final")).toBeInTheDocument();
      // The loser recedes; the winner does not.
      expect(screen.getByText("Iron Owls").className).toContain("text-text-muted");
      expect(screen.getByText("Bay Bandits").className).not.toContain("text-text-muted");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("marks the caller's own side with YOU and never guesses at unscored matchups", () => {
    render(<MatchupScoreboard matchup={{ ...FINAL, final: false, homeScore: null, awayScore: null }} myTeamId="t2" />);
    expect(screen.getByText("YOU")).toBeInTheDocument();
    expect(screen.getByText("Not scored yet")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(2);
    // Nobody recedes before a result exists.
    expect(screen.getByText("Bay Bandits").className).not.toContain("text-text-muted");
  });
});
