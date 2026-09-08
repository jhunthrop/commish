import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { SignalsStrip } from "./signals-strip";

describe("SignalsStrip", () => {
  it("renders nothing at all when there is no run and no collapse to report", () => {
    const { container } = render(<SignalsStrip signals={{ run: null, collapses: [] }} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/Best available/)).toBeNull();
  });

  it("shows the run and each collapse as a chip with its position, in plain words, axe-clean", async () => {
    const { container } = render(
      <SignalsStrip
        signals={{
          run: { position: "RB", count: 3, window: 4 },
          collapses: [
            { position: "TE", playersLeftInTier: 1, dropToNextTier: 20.6 },
            { position: "WR", playersLeftInTier: 2, dropToNextTier: 14.25 },
          ],
        }}
      />,
    );
    expect(screen.getByRole("list", { name: "Runs and tiers" })).toBeInTheDocument();
    expect(screen.getByTestId("advisor-run")).toHaveTextContent("Backs are going, 3 of the last 4 picks");
    const collapses = screen.getAllByTestId("advisor-collapse");
    expect(collapses.map((chip) => chip.textContent)).toEqual(["TELast tight end before a 20.6 point drop", "WR2 receivers left before a 14.3 point drop"]);
    expect(await axe(container)).toHaveNoViolations();
  });
});
