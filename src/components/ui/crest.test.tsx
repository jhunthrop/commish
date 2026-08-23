import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { Crest, crestTone } from "./crest";

/** Fixture ids only — not a claim about what the app actually seeds. */
const SEED_LEAGUE_IDS: readonly string[] = ["lg_bandits", "lg_thunder", "lg_hawks", "lg_owls", "lg_sharks", "lg_wolves"];

describe("crestTone", () => {
  it("gives the same league the same tone forever, and different leagues different ones", () => {
    expect(crestTone("lg_bandits")).toBe(crestTone("lg_bandits"));
    expect(new Set(SEED_LEAGUE_IDS.map(crestTone)).size).toBeGreaterThan(1);
  });
});

describe("Crest", () => {
  it("shows the label and hides itself from the accessibility tree, in both themes, axe-clean", async () => {
    await renderSurface(<Crest id="lg_bandits" label="BB" />, async ({ container }) => {
      expect(screen.getByText("BB")).toBeInTheDocument();
      expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("sizes the tile from the size prop, defaulting to the rail's own 40px", () => {
    const { container, rerender } = render(<Crest id="lg_bandits" label="BB" />);
    expect(container.firstElementChild).toHaveStyle({ width: "40px", height: "40px" });
    rerender(<Crest id="lg_bandits" label="BB" size={64} />);
    expect(container.firstElementChild).toHaveStyle({ width: "64px", height: "64px" });
  });
});
