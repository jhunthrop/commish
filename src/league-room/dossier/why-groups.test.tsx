import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { Law } from "@/projections/laws/types";
import type { BoardReason } from "@/projections/preseason/board";
import { WhyGroups } from "./why-groups";

const REASONS: readonly BoardReason[] = [
  { code: "market_anchor", marketPoints: 200, delta: 14.2 },
  { code: "scarcity", positionRank: 4, replacementLevel: 140 },
  { code: "law", lawId: "rb_age_curve", effect: -1.8, magnitude: 29 },
  { code: "law", lawId: "rb_workload_cliff", effect: -0.9, magnitude: 320 },
  { code: "changed_team", from: "SF", to: "MIA" },
  { code: "availability", expectedGames: 14, floorGames: 10, ceilingGames: 17 },
  { code: "rookie", overallPick: null, landingMultiplier: 1 },
  { code: "new_play_caller", team: "MIA" },
];

describe("WhyGroups", () => {
  it("renders nothing when the board never ranked him", () => {
    const { container } = render(<WhyGroups reasons={[]} laws={[]} position="RB" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("states a law group as a bold lead plus what it does to him, in words", () => {
    render(<WhyGroups reasons={REASONS} laws={[]} position="RB" />);
    expect(screen.getByText("Age 29 season.")).toBeInTheDocument();
    // The direction is the verb and the magnitude is unsigned, never "Measured -1.8" (§3.7).
    expect(screen.getByText("Costs him 1.8 points a game.")).toBeInTheDocument();
  });

  it("states a non-law fact as its own bold lead plus explanation", () => {
    render(<WhyGroups reasons={REASONS} laws={[]} position="RB" />);
    expect(screen.getByText("Changed team.")).toBeInTheDocument();
    expect(screen.getByText("SF to MIA.")).toBeInTheDocument();
    expect(screen.getByText("Availability.")).toBeInTheDocument();
    expect(screen.getByText("Expected 14 games, 10 to 17.")).toBeInTheDocument();
  });

  it("never states market_anchor or scarcity as a peer group — those feed the call card's verdict, never a duplicate here", () => {
    render(<WhyGroups reasons={REASONS} laws={[]} position="RB" />);
    expect(screen.queryByText(/market/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/replacement level/i)).not.toBeInTheDocument();
  });

  it("caps at the given count with a 'the full case' expander, uncapped when cap is omitted", () => {
    const { rerender } = render(<WhyGroups reasons={REASONS} laws={[]} position="RB" cap={2} />);
    // 6 groups total (2 law groups + 4 fact groups — market_anchor/scarcity excluded), capped to 2.
    expect(screen.getByText("The full case (6)")).toBeInTheDocument();
    expect(screen.queryByText("New play caller.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("The full case (6)"));
    expect(screen.getByText("New play caller.")).toBeInTheDocument();
    expect(screen.queryByText("The full case (6)")).not.toBeInTheDocument();

    rerender(<WhyGroups reasons={REASONS} laws={[]} position="RB" />);
    expect(screen.getByText("New play caller.")).toBeInTheDocument();
    expect(screen.queryByText(/The full case/)).not.toBeInTheDocument();
  });

  it("prints no verdict sentence of its own — that stays the call card's, ruling R-d2", () => {
    render(<WhyGroups reasons={REASONS} laws={[]} position="RB" />);
    expect(screen.queryByText(/going later than he should|a reach where he is going|he has no adp\.|evidence stands alone/i)).not.toBeInTheDocument();
  });

  it("follows the copy rules — no em-dash, no semicolon", () => {
    const { container } = render(<WhyGroups reasons={REASONS} laws={[]} position="RB" />);
    expect(container.textContent).not.toMatch(/—/);
    expect(container.textContent).not.toMatch(/;/);
  });

  it("renders axe-clean in both themes", async () => {
    const laws: readonly Law[] = [];
    await renderSurface(<WhyGroups reasons={REASONS} laws={laws} position="RB" cap={5} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
