import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { Meter } from "./meter";

describe("Meter", () => {
  it("never renders a bar without its number, because a bar alone makes people estimate", () => {
    // public-league-list.tsx's own no-bar ruling, generalized: the bar is the glance and the
    // number is the decision. This primitive cannot be constructed without the number.
    renderSurface(<Meter label="Seats filled" value={10} max={12} />, ({ getByText }) => {
      expect(getByText("10 of 12")).toBeInTheDocument();
    });
  });

  it("shows the label beside the number", () => {
    renderSurface(<Meter label="Margin" value={5} max={20} />, ({ getByText }) => {
      expect(getByText("Margin")).toBeInTheDocument();
      expect(getByText("5 of 20")).toBeInTheDocument();
    });
  });

  it("never divides by zero when max is zero", () => {
    renderSurface(<Meter label="Empty" value={0} max={0} />, ({ container }) => {
      const fill = container.querySelector("[style]");
      expect(fill).toHaveStyle({ width: "0%" });
    });
  });

  it("is axe-clean in both themes", async () => {
    await renderSurface(<Meter label="Seats filled" value={10} max={12} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
