import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { MATCHUP } from "../test-fixtures";
import { MatchupPanel } from "./matchup-panel";

describe("MatchupPanel", () => {
  it("shows both lineups, per-player points and the final score, in both themes, axe-clean", async () => {
    await inBothThemes(<MatchupPanel matchup={MATCHUP} myTeamId="t1" />, async ({ container }) => {
      expect(screen.getByRole("heading", { name: "Bay Bandits" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Iron Owls" })).toBeInTheDocument();
      expect(screen.getByText("112.50")).toBeInTheDocument();
      expect(screen.getByText("Final")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("never implies live scoring", async () => {
    // The stat-set disclaimer lives once at page level now; the panel's own duty is narrower:
    // a week is "Final" or "Not scored yet", never "in progress" or "live".
    render(<MatchupPanel matchup={MATCHUP} myTeamId="t1" />);
    expect(screen.queryByText(/in progress|live now|updating/i)).not.toBeInTheDocument();
    expect(screen.getByText("Final")).toBeInTheDocument();
  });

  it("says a week is not scored yet rather than showing a zero", async () => {
    const pending = { ...MATCHUP, final: false, home: { ...MATCHUP.home, score: null }, away: { ...MATCHUP.away, score: null } };
    await inBothThemes(<MatchupPanel matchup={pending} myTeamId="t1" />, async ({ container }) => {
      expect(screen.getByText("Not scored yet")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("renders a starter's position as a PositionBadge sticker, not a bare string", () => {
    render(<MatchupPanel matchup={MATCHUP} myTeamId="t1" />);
    const position = MATCHUP.home.starters[0]!.position;
    if (position === null) throw new Error("fixture starter has no position");
    const candidates = screen.getAllByText(position, { selector: "span" });
    const sticker = candidates.find((el) => el.className.includes("bg-pos-"));
    expect(sticker?.className).toContain(`bg-pos-${position.toLowerCase()}`);
  });
});
