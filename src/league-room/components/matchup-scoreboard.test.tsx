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

  it("marks the caller's own side with You and never guesses at unscored matchups", () => {
    render(<MatchupScoreboard matchup={{ ...FINAL, final: false, weekStatus: "scheduled", homeScore: null, awayScore: null }} myTeamId="t2" />);
    expect(screen.getByText("You")).toBeInTheDocument();
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
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.queryByText("Not started")).not.toBeInTheDocument();
    expect(screen.queryByText("Final")).not.toBeInTheDocument();
  });

  // E1(a)+(c) (D2/E3, competition review): the two facts a manager needs to know whether a lead
  // is safe — the margin (a plain subtraction of two scores already on screen) and how much of
  // the week has played — composed into one honest sentence, from data already in the props.
  describe("the honest line (E1)", () => {
    it("says nothing when either score is not in yet", () => {
      render(<MatchupScoreboard matchup={{ ...FINAL, homeScore: null }} myTeamId="t1" gamesFinal={0} gamesTotal={4} />);
      expect(screen.queryByText(/games final/)).not.toBeInTheDocument();
    });

    it("speaks in the second person for the caller's own matchup, up or down", () => {
      render(<MatchupScoreboard matchup={FINAL} myTeamId="t1" gamesFinal={13} gamesTotal={13} />);
      expect(screen.getByText("You are up 22.78. 13 of 13 games final.")).toBeInTheDocument();

      render(<MatchupScoreboard matchup={FINAL} myTeamId="t2" gamesFinal={13} gamesTotal={13} />);
      expect(screen.getByText("You are down 22.78. 13 of 13 games final.")).toBeInTheDocument();
    });

    it("names the leader in the third person for a spectator with no team in this matchup", () => {
      render(<MatchupScoreboard matchup={FINAL} myTeamId={null} gamesFinal={13} gamesTotal={13} />);
      expect(screen.getByText("Bay Bandits leads by 22.78. 13 of 13 games final.")).toBeInTheDocument();
    });

    it("says tied rather than a zero margin", () => {
      render(<MatchupScoreboard matchup={{ ...FINAL, homeScore: 100, awayScore: 100 }} myTeamId="t1" gamesFinal={2} gamesTotal={4} />);
      expect(screen.getByText("You are tied at 100.00. 2 of 4 games final.")).toBeInTheDocument();
    });

    it("omits the games-final clause when the week has no stat_weeks row at all", () => {
      render(<MatchupScoreboard matchup={FINAL} myTeamId="t1" />);
      expect(screen.getByText("You are up 22.78.")).toBeInTheDocument();
    });
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

  /**
   * THE SCORE BECOMES A REAL DISPLAY NUMBER (the fun pass, Task 9). The spec's third named cause
   * of "it feels like a legal website" is that this product has almost no typographic dynamic
   * range: "sports interfaces live on roughly 10x scale contrast — a huge number, a tiny label."
   * A matchup's score is the single biggest number a manager looks at all week, and it rendered
   * at the same 44px a card title uses.
   *
   * `size` exists because the same component is ALSO a tile in a grid of league cards on `/app`
   * (`HomeLeagueCard`), where 82px would be a shout rather than a hierarchy. The default keeps
   * that caller byte-identical; only the two surfaces whose whole subject is this one matchup ask
   * for the hero.
   */
  describe("the score's own register", () => {
    it("stays at card scale by default, so a shelf of league cards is unchanged", () => {
      render(<MatchupScoreboard matchup={FINAL} myTeamId="t1" />);
      expect(screen.getByText("121.40").className).toContain("text-display-lg");
      expect(screen.getByText("121.40").className).not.toContain("text-display-2xl");
    });

    it("takes the top of the display scale when the whole page is about this one matchup", () => {
      render(<MatchupScoreboard matchup={FINAL} myTeamId="t1" size="hero" />);
      const score = screen.getByText("121.40").className;
      // Responsive by construction: 82px is a desktop matchup hero, never a 360px phone — the
      // same `text-display-* sm:text-display-*` idiom the front door's own headline uses.
      expect(score).toContain("text-display-xl");
      expect(score).toContain("sm:text-display-2xl");
    });

    it("gets its range from size and never from a heavier face, at either register", () => {
      // Rule 2 did not move with the fun pass: the weight cap is 600.
      const { container } = render(<MatchupScoreboard matchup={FINAL} myTeamId="t1" size="hero" />);
      expect(container.innerHTML).not.toContain("font-bold");
    });
  });
});
