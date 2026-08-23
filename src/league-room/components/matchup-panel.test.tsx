import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { fixtureLeagueDeps, MATCHUP, MATCHUP_WITH_MEDIAN, renderInLeague } from "../test-fixtures";
import { MatchupPanel } from "./matchup-panel";

/** Same matchup, mid-games: `final` and `weekStatus` both say so, independent of each other. */
const inProgressMatchup = { ...MATCHUP, final: false, weekStatus: "in_progress" as const };

describe("MatchupPanel", () => {
  it("shows both lineups, per-player points and the final score, in both themes, axe-clean", async () => {
    await renderSurface(<MatchupPanel matchup={MATCHUP} myTeamId="t1" weekStatus="final" />, async ({ container }) => {
      expect(screen.getByRole("heading", { name: "Bay Bandits" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Iron Owls" })).toBeInTheDocument();
      expect(screen.getByText("112.50")).toBeInTheDocument();
      expect(screen.getByText("Final")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  // Phase 2 Plan B: live scoring EXISTS. This case used to assert the opposite, and it was
  // correct while the stat set was a fixed file a commissioner scored by hand. Inverting it is
  // the point of the change, not a casualty of it: the panel must now say which of the three
  // states a week is in, and must never show a moving number with no state beside it.
  it("says which state the week is in, and never shows a score with no state", async () => {
    const { deps } = fixtureLeagueDeps();
    renderInLeague(<MatchupPanel matchup={inProgressMatchup} myTeamId="t1" weekStatus="in_progress" />, deps);
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.queryByText("Final")).not.toBeInTheDocument();
  });

  it("says a week is not scored yet rather than showing a zero", async () => {
    const pending = { ...MATCHUP, final: false, home: { ...MATCHUP.home, score: null }, away: { ...MATCHUP.away, score: null } };
    await renderSurface(<MatchupPanel matchup={pending} myTeamId="t1" weekStatus="scheduled" />, async ({ container }) => {
      expect(screen.getByText("Not started")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  // Non-median league: `matchup.median` is `null`, the same "nothing to say" state a week with
  // no scores reads as — no median residue anywhere on the page.
  it("shows no median line at all for a non-median league", () => {
    render(<MatchupPanel matchup={MATCHUP} myTeamId="t1" weekStatus="final" />);
    expect(screen.queryByText(/league median/)).not.toBeInTheDocument();
  });

  it("shows each team's own median result, second person for the viewer's own team, third person for the other, in both themes, axe-clean", async () => {
    await renderSurface(
      <MatchupPanel matchup={MATCHUP_WITH_MEDIAN} myTeamId="t1" weekStatus="final" />,
      async ({ container }) => {
        // `t1` (home, myTeamId) beat the median; `t2` (away) missed it.
        expect(
          screen.getByText("You scored 112.50. The league median was 104.20, so you won that one too."),
        ).toBeInTheDocument();
        expect(
          screen.getByText("Iron Owls scored 98.25. The league median was 104.20, so they lost that one too."),
        ).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  // The exact same matchup, viewed by nobody in it (a bye-week spectator, or a commissioner
  // browsing another pairing) — both sides read in the third person, and neither says "You".
  it("reads both sides in the third person for a viewer with no team in this matchup", () => {
    render(<MatchupPanel matchup={MATCHUP_WITH_MEDIAN} myTeamId={null} weekStatus="final" />);
    expect(
      screen.getByText("Bay Bandits scored 112.50. The league median was 104.20, so they won that one too."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Iron Owls scored 98.25. The league median was 104.20, so they lost that one too."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^You /)).not.toBeInTheDocument();
  });

  // The same "no median yet" state a week with no scores reads as (the brief's own equivalence):
  // a median exists for the week, but this particular side has no score to compare it to.
  it("shows no median line for a side with no score yet, even when the week's median is known", () => {
    const halfScored = { ...MATCHUP_WITH_MEDIAN, home: { ...MATCHUP_WITH_MEDIAN.home, score: null } };
    render(<MatchupPanel matchup={halfScored} myTeamId="t1" weekStatus="in_progress" />);
    expect(screen.queryByText(/Bay Bandits scored|You scored/)).not.toBeInTheDocument();
    expect(screen.getByText(/Iron Owls scored 98.25/)).toBeInTheDocument();
  });

  it("renders a starter's position as a PositionBadge sticker, not a bare string", () => {
    render(<MatchupPanel matchup={MATCHUP} myTeamId="t1" weekStatus="final" />);
    const position = MATCHUP.home.starters[0]!.position;
    if (position === null) throw new Error("fixture starter has no position");
    const candidates = screen.getAllByText(position, { selector: "span" });
    const sticker = candidates.find((el) => el.className.includes("bg-pos-"));
    expect(sticker?.className).toContain(`bg-pos-${position.toLowerCase()}`);
  });
});
