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

  // A15: the "matchup" glossary term's InfoTip caller.
  it("carries an InfoTip on its own Matchup eyebrow", () => {
    render(<MatchupPanel matchup={MATCHUP} myTeamId="t1" weekStatus="final" />);
    expect(screen.getByRole("button", { name: "What is a matchup?" })).toBeInTheDocument();
  });

  // Step 3c: the last two `Table` consumers to converge dense (the other is `budget-table.tsx`,
  // Task 12) — see `table.tsx`'s own docblock for the density-default decision this leaves.
  it("renders its starters table dense, the mocks' own 11px vertical cell padding", () => {
    render(<MatchupPanel matchup={MATCHUP} myTeamId="t1" weekStatus="final" />);
    const headerCell = screen.getAllByRole("columnheader", { name: "Player" })[0]!;
    expect(headerCell).toHaveStyle({ paddingTop: "11px", paddingBottom: "11px" });
  });

  // Gauntlet fix wave, NEW-10: `Pos` (a `PositionBadge` sticker) used to be its own column here,
  // identical to `Slot` for every row but FLEX — two columns for one fact. `Slot` is the one
  // that survives (the same precedent `LineupEditor`'s own roster table already sets); this
  // table no longer renders a `PositionBadge` at all.
  it("renders every starter's roster slot as a SlotChip, with no separate position column", () => {
    render(<MatchupPanel matchup={MATCHUP} myTeamId="t1" weekStatus="final" />);
    expect(screen.queryByRole("columnheader", { name: "Pos" })).not.toBeInTheDocument();
    const slot = MATCHUP.home.starters[0]!.slot;
    expect(screen.getAllByText(slot).length).toBeGreaterThan(0);
  });
});
