import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SURVIVAL_BANDS } from "@/domain/draft-odds";
import { OddsGlance } from "./odds-glance";

const ODDS = { pickNumber: 20, runs: 200, survived: { safe: 140, middle: 100, reach: 49, edge: 50 } };

describe("OddsGlance", () => {
  it("prints the percent with the runs in the tooltip, banded at the shared thresholds: a soft positive chip, secondary ink, critical ink", () => {
    render(
      <>
        <OddsGlance odds={ODDS} playerId="safe" />
        <OddsGlance odds={ODDS} playerId="middle" />
        <OddsGlance odds={ODDS} playerId="reach" />
        <OddsGlance odds={ODDS} playerId="edge" />
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

  it("states the same odds as runs over runs for the advisor's own rows, in the same bands", () => {
    render(
      <>
        <OddsGlance odds={ODDS} playerId="safe" form="runs" />
        <OddsGlance odds={ODDS} playerId="middle" form="runs" />
        <OddsGlance odds={ODDS} playerId="reach" form="runs" />
      </>,
    );
    const cells = screen.getAllByTestId("advisor-odds-runs");
    expect(cells.map((cell) => cell.textContent?.replace(/still there.*$/, ""))).toEqual(["140 of 200", "100 of 200", "49 of 200"]);
    expect(cells.map((cell) => cell.dataset.band)).toEqual(["safe", "middle", "reach"]);
    expect(cells[0]!.className).toContain("bg-positive/10");
    expect(cells[1]!.className).toContain("text-text-muted");
    expect(cells[2]!.className).toContain("text-negative");
    expect(screen.queryAllByTestId("advisor-odds-pct")).toHaveLength(0);
  });

  it("renders nothing for a player the odds do not cover or when no run reached the turn", () => {
    const { container } = render(
      <>
        <OddsGlance odds={ODDS} playerId="gone" />
        <OddsGlance odds={{ ...ODDS, runs: 0 }} playerId="safe" />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
