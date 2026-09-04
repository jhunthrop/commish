import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Icon, ICONS, type IconName } from "./icon";

describe("Icon", () => {
  it("is decorative (aria-hidden) by default", () => {
    const { container } = render(<Icon name="trophy" />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
  it("is an accessible image when given a label", () => {
    const { getByRole } = render(<Icon name="trophy" label="Champion" />);
    expect(getByRole("img", { name: "Champion" })).toBeInTheDocument();
  });
  it("renders an <svg> for every IconName the map knows, so a future addition cannot skip this", () => {
    for (const name of Object.keys(ICONS) as IconName[]) {
      const { container } = render(<Icon name={name} />);
      expect(container.querySelector("svg")).not.toBeNull();
    }
  });

  // Task 4, brand adoption pass: `ICONS` now holds ten of our own glyphs (`glyphs.tsx`) beside
  // lucide's, so this exercises the same decorative/labeled contract against a non-lucide entry
  // rather than trusting the widened `IconComponent` type alone.
  it("renders a custom glyph decoratively by default and as an accessible image when labeled", () => {
    const decorative = render(<Icon name="trade" />);
    expect(decorative.container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");

    render(<Icon name="trade" label="Trade" />);
    expect(screen.getByRole("img", { name: "Trade" })).toBeInTheDocument();
  });
});
