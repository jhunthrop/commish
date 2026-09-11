import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { LOST, WON } from "../test-fixtures";
import { MatchupCelebration } from "./matchup-celebration";

const MANAGERS = {
  t1: { name: "Alex Rivera", avatar: null, record: "9-4" },
  t2: { name: "Jordan Lee", avatar: null, record: "7-6" },
};

describe("MatchupCelebration", () => {
  // P8: A FRAME, NOT A SHOUT. The card has to answer "which league and who" on its own, because
  // the thing it is for is being screenshotted into a group text where neither is on screen.
  it("frames the win with the league, both managers, the score and its basis, in both themes, axe-clean", async () => {
    await renderSurface(
      <MatchupCelebration matchup={WON} myTeamId="t1" clinched={false} leagueName="Sunday Money" managers={MANAGERS} />,
      async ({ container }) => {
        const frame = screen.getByRole("status");
        expect(frame).toHaveTextContent("You won in Week 3");
        expect(frame).toHaveTextContent("Sunday Money");
        expect(frame).toHaveTextContent("Jordan Lee");
        expect(container.firstElementChild).toHaveAttribute("data-emphasis", "self");
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  // A frame handed no managers draws no faces rather than initials standing in for somebody.
  it("still frames a win with no managers threaded, and names nobody it was not given", () => {
    render(<MatchupCelebration matchup={WON} myTeamId="t1" clinched={false} leagueName="Sunday Money" />);
    const frame = screen.getByRole("status");
    expect(frame).toHaveTextContent("You won in Week 3");
    expect(frame).not.toHaveTextContent("Jordan Lee");
  });

  it("celebrates a clinched playoff spot even without a win this week", () => {
    render(<MatchupCelebration matchup={LOST} myTeamId="t1" clinched leagueName="Sunday Money" managers={MANAGERS} />);
    expect(screen.getByRole("status")).toHaveTextContent("You are in the playoffs");
  });

  it("says nothing on a loss, on an unscored week, or with no team", () => {
    expect(render(<MatchupCelebration matchup={LOST} myTeamId="t1" clinched={false} />).container).toBeEmptyDOMElement();
    expect(render(<MatchupCelebration matchup={{ ...WON, final: false }} myTeamId="t1" clinched={false} />).container).toBeEmptyDOMElement();
    expect(render(<MatchupCelebration matchup={WON} myTeamId={null} clinched={false} />).container).toBeEmptyDOMElement();
    expect(render(<MatchupCelebration matchup={null} myTeamId="t1" clinched={false} />).container).toBeEmptyDOMElement();
  });
});
