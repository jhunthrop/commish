import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
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
  weekStatus: "final",
};

describe("MatchupScoreboard", () => {
  it("shows both names and scores with the winner keeping full ink, in both themes, axe-clean", async () => {
    await renderSurface(<MatchupScoreboard matchup={FINAL} myTeamId="t1" />, async ({ container }) => {
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
    render(<MatchupScoreboard matchup={{ ...FINAL, final: false, weekStatus: "scheduled", homeScore: null, awayScore: null }} myTeamId="t2" />);
    expect(screen.getByText("YOU")).toBeInTheDocument();
    expect(screen.getByText("Not started")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(2);
    // Nobody recedes before a result exists.
    expect(screen.getByText("Bay Bandits").className).not.toContain("text-text-muted");
  });

  // Task 7's review flagged this exact gap: the badge used to read `matchup.final` directly,
  // which cannot tell "scheduled" from "in_progress" — both have `final: false`. WeekStatusBadge
  // reads `weekStatus` instead, so a week mid-games says so rather than reading "Not started".
  it("shows the week as in progress from weekStatus, not from final", () => {
    render(<MatchupScoreboard matchup={{ ...FINAL, final: false, weekStatus: "in_progress" }} myTeamId="t1" />);
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.queryByText("Not started")).not.toBeInTheDocument();
    expect(screen.queryByText("Final")).not.toBeInTheDocument();
  });

  // Fix round 1, F2: a regression test for the truncation fix, missing until now. Before `w-full`
  // was added to the name `<p>`, its `flex-col items-center` parent sized it to its own content
  // (the cross-axis default for that layout), so `truncate`'s `overflow-hidden`/`ellipsis` never
  // had a constrained box to clip against and a long name pushed the whole card — and the page —
  // wider. This name is long enough to have overflowed pre-fix.
  it("constrains a long team name inside its own half of the card, rather than letting it push the layout wider", () => {
    const longName = "The Absolutely Unstoppable Championship Dynasty Football Club";
    render(<MatchupScoreboard matchup={{ ...FINAL, homeTeamName: longName }} myTeamId={null} />);
    const nameEl = screen.getByText(longName);
    // `truncate` alone clips nothing without a box to clip against — `w-full` is what gives the
    // name its parent's already-shrunk (`min-w-0 flex-1`) width, which is the actual fix.
    expect(nameEl.className).toContain("truncate");
    expect(nameEl.className).toContain("w-full");
  });
});
