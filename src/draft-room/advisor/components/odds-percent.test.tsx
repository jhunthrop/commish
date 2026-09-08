import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SURVIVAL_BANDS } from "@/domain/draft-odds";
import { OddsPercent } from "./odds-percent";

const ODDS = { pickNumber: 20, runs: 200, survived: { safe: 140, middle: 100, reach: 49, edge: 50 } };

describe("OddsPercent", () => {
  it("prints the percent with the runs in the tooltip, banded at the shared thresholds: a soft positive chip, secondary ink, critical ink", () => {
    render(
      <>
        <OddsPercent odds={ODDS} playerId="safe" />
        <OddsPercent odds={ODDS} playerId="middle" />
        <OddsPercent odds={ODDS} playerId="reach" />
        <OddsPercent odds={ODDS} playerId="edge" />
      </>,
    );
    const chips = screen.getAllByTestId("advisor-odds-pct");
    expect(chips.map((chip) => chip.dataset.band)).toEqual(["safe", "middle", "reach", "middle"]);
    expect(chips[0]).toHaveAttribute("title", "still there at your next pick, 140 of 200 runs");
    expect(chips[0]).toHaveTextContent("70%");
    expect(chips[0]!.className).toContain("text-positive");
    expect(chips[0]!.className).toContain("bg-positive/10");
    expect(chips[1]!.className).toContain("text-text-muted");
    expect(chips[1]!.className).not.toMatch(/warning|live/);
    expect(chips[2]!.className).toContain("text-negative");
    expect(SURVIVAL_BANDS.safe).toBe(0.7);
    expect(SURVIVAL_BANDS.reach).toBe(0.25);
  });

  it("renders nothing for a player the odds do not cover or when no run reached the turn", () => {
    const { container } = render(
      <>
        <OddsPercent odds={ODDS} playerId="gone" />
        <OddsPercent odds={{ ...ODDS, runs: 0 }} playerId="safe" />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
