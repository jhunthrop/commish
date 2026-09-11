import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { BigNumber } from "./big-number";

describe("BigNumber", () => {
  it("prints the figure in the display face with its basis under it, in both themes, axe-clean", async () => {
    await renderSurface(<BigNumber value="20.2" basis="PPR a game, 2024 weeks 1 to 3" />, async ({ container }) => {
      const value = screen.getByText("20.2");
      expect(value.className).toContain("font-display");
      expect(value.className).toContain("font-extrabold");
      expect(value.className).toContain("tabular-nums");
      expect(value.className).toContain("text-display-md");
      expect(screen.getByText("PPR a game, 2024 weeks 1 to 3").className).toContain("text-text-faint");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("prints a dash and never a zero when there is no honest number, and the caption says why", () => {
    render(<BigNumber value={null} basis="no kicking line in this archive" />);
    const dash = screen.getByText("–");
    expect(dash).toHaveAttribute("data-absent", "true");
    expect(dash.className).toContain("text-text-muted");
    expect(screen.getByText("no kicking line in this archive")).toBeInTheDocument();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("steps the size with the object: a row figure is display-sm, a page figure display-xl", () => {
    const row = render(<BigNumber value="112.5" basis="this week" size="sm" />);
    expect(row.getByText("112.5").className).toContain("text-display-sm");
    row.unmount();
    const page = render(<BigNumber value="112.5" basis="this week" size="xl" />);
    expect(page.getByText("112.5").className).toContain("text-display-xl");
  });

  it("slides the new figure up only when the caller says the value changed, never on mount", () => {
    const still = render(<BigNumber value="12.4" basis="live" />);
    expect(still.getByText("12.4").className).not.toContain("animate-score-slide");
    still.unmount();
    const moved = render(<BigNumber value="18.1" basis="live" changed />);
    expect(moved.getByText("18.1").className).toContain("animate-score-slide");
  });

  it("aligns to the row's right by default and to the start when asked", () => {
    const end = render(<BigNumber value="1" basis="seat left of 12" />);
    expect(end.getByTestId("big-number").className).toContain("items-end");
    end.unmount();
    const start = render(<BigNumber value="1" basis="seat left of 12" align="start" />);
    expect(start.getByTestId("big-number").className).toContain("items-start");
  });
});
