import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { RangeRail, type RangeRailProjection } from "./range-rail";

const PROJECTION: RangeRailProjection = { floorPoints: 100, medianPoints: 200, ceilingPoints: 300, typicalLow: 170, typicalHigh: 230 };

function pointFor(container: HTMLElement, name: string): HTMLElement {
  return container.querySelector(`[data-rail-point="${name}"]`) as HTMLElement;
}

describe("RangeRail", () => {
  it("positions the median tick and the band by their real values along the rail", () => {
    const { container } = render(<RangeRail projection={PROJECTION} availability={null} />);
    // floor=100, ceiling=300: median 200 sits at the midpoint, the band 170-230 straddles it.
    expect(pointFor(container, "median").style.left).toBe("50%");
    expect(pointFor(container, "band").style.left).toBe("35%");
    expect(pointFor(container, "band").style.width).toBe("30%");
  });

  it("degrades to the rail's midpoint rather than dividing by zero when the band has no width", () => {
    const flat: RangeRailProjection = { floorPoints: 150, medianPoints: 150, ceilingPoints: 150, typicalLow: 150, typicalHigh: 150 };
    const { container } = render(<RangeRail projection={flat} availability={null} />);
    expect(pointFor(container, "median").style.left).toBe("50%");
  });

  it("labels the tails, the band and the median honestly", () => {
    const { container } = render(<RangeRail projection={PROJECTION} availability={null} />);
    expect(container.textContent).toContain("an injury year");
    expect(container.textContent).toContain("most seasons land in the band");
    expect(container.textContent).toContain("200");
    expect(container.textContent).toContain("is our number");
    expect(container.textContent).toContain("the smash case");
  });

  it("renders the expected-games chip only when availability is real", () => {
    const withAvailability = render(
      <RangeRail projection={PROJECTION} availability={{ expectedGames: 15.6, floorGames: 10, ceilingGames: 17 }} />,
    );
    expect(withAvailability.container.textContent).toContain("Expected 16 games, weeks 10 to 17");

    const without = render(<RangeRail projection={PROJECTION} availability={null} />);
    expect(without.container.querySelector('[data-rail-chip="expected-games"]')).toBeNull();
  });

  it("follows the copy rules — no em-dash, no semicolon", () => {
    const { container } = render(<RangeRail projection={PROJECTION} availability={{ expectedGames: 15.6, floorGames: 10, ceilingGames: 17 }} />);
    expect(container.textContent).not.toMatch(/—/);
    expect(container.textContent).not.toMatch(/;/);
  });

  it("renders axe-clean in both themes", async () => {
    await renderSurface(<RangeRail projection={PROJECTION} availability={{ expectedGames: 15.6, floorGames: 10, ceilingGames: 17 }} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
