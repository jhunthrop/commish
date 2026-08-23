import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { StatPill } from "./stat-pill";

describe("StatPill", () => {
  it("keeps the label's own case in the DOM — capitals are CSS, in both themes, axe-clean", async () => {
    await renderSurface(<StatPill label="Final" tone="positive" />, async ({ container }) => {
      expect(screen.getByText("Final")).toBeInTheDocument();
      expect(screen.getByText("Final").className).toMatch(/uppercase/);
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("forwards glow to the underlying badge", () => {
    render(<StatPill label="Live" tone="accent" glow />);
    expect(screen.getByText("Live").className).toMatch(/ring-accent-glow/);
  });

  it("defaults to neutral, no glow", () => {
    render(<StatPill label="Not started" />);
    expect(screen.getByText("Not started").className).not.toMatch(/ring-/);
  });
});
