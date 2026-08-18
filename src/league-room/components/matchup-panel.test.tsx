import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { MATCHUP } from "../test-fixtures";
import { MatchupPanel } from "./matchup-panel";

describe("MatchupPanel", () => {
  it("shows both lineups, per-player points and the final score, in both themes, axe-clean", async () => {
    await inBothThemes(<MatchupPanel matchup={MATCHUP} myTeamId="t1" />, async ({ container }) => {
      expect(screen.getByText("Bay Bandits")).toBeInTheDocument();
      expect(screen.getByText("Iron Owls")).toBeInTheDocument();
      expect(screen.getByText("112.50")).toBeInTheDocument();
      expect(screen.getByText("Final")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("never implies live scoring", async () => {
    render(<MatchupPanel matchup={MATCHUP} myTeamId="t1" />);
    expect(screen.getByText(/there's no live scoring yet/)).toBeInTheDocument();
    expect(screen.queryByText(/live/i)?.textContent).not.toMatch(/in progress|live now|updating/i);
  });

  it("says a week is not scored yet rather than showing a zero", async () => {
    const pending = { ...MATCHUP, final: false, home: { ...MATCHUP.home, score: null }, away: { ...MATCHUP.away, score: null } };
    await inBothThemes(<MatchupPanel matchup={pending} myTeamId="t1" />, async ({ container }) => {
      expect(screen.getByText("Not scored yet")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
