import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { fixtureLeagueDeps, MATCHUP, renderInLeague } from "../test-fixtures";
import { MatchupPanel } from "./matchup-panel";

/** Same matchup, mid-games: `final` and `weekStatus` both say so, independent of each other. */
const inProgressMatchup = { ...MATCHUP, final: false, weekStatus: "in_progress" as const };

describe("MatchupPanel", () => {
  it("shows both lineups, per-player points and the final score, in both themes, axe-clean", async () => {
    await inBothThemes(<MatchupPanel matchup={MATCHUP} myTeamId="t1" weekStatus="final" />, async ({ container }) => {
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
    await inBothThemes(<MatchupPanel matchup={pending} myTeamId="t1" weekStatus="scheduled" />, async ({ container }) => {
      expect(screen.getByText("Not started")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
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
