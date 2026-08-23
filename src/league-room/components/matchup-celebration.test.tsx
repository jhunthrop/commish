import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { LOST, WON } from "../test-fixtures";
import { MatchupCelebration } from "./matchup-celebration";

describe("MatchupCelebration", () => {
  it("celebrates a win, in both themes, axe-clean", async () => {
    await renderSurface(<MatchupCelebration matchup={WON} myTeamId="t1" clinched={false} />, async ({ container }) => {
      expect(screen.getByRole("status")).toHaveTextContent("You won in Week 3!");
      expect(container.firstElementChild).toHaveAttribute("data-emphasis", "self");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("celebrates a clinched playoff spot even without a win this week", () => {
    render(<MatchupCelebration matchup={LOST} myTeamId="t1" clinched />);
    expect(screen.getByRole("status")).toHaveTextContent("playoff spot");
  });

  it("says nothing on a loss, on an unscored week, or with no team", () => {
    expect(render(<MatchupCelebration matchup={LOST} myTeamId="t1" clinched={false} />).container).toBeEmptyDOMElement();
    expect(render(<MatchupCelebration matchup={{ ...WON, final: false }} myTeamId="t1" clinched={false} />).container).toBeEmptyDOMElement();
    expect(render(<MatchupCelebration matchup={WON} myTeamId={null} clinched={false} />).container).toBeEmptyDOMElement();
    expect(render(<MatchupCelebration matchup={null} myTeamId="t1" clinched={false} />).container).toBeEmptyDOMElement();
  });
});
