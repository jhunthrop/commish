import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { Crest, shortNameFor, crestTone } from "./crest";

/** Fixture ids only — not a claim about what the app actually seeds. */
const SEED_LEAGUE_IDS: readonly string[] = ["lg_bandits", "lg_thunder", "lg_hawks", "lg_owls", "lg_sharks", "lg_wolves"];

describe("crestTone", () => {
  it("gives the same league the same tone forever, and different leagues different ones", () => {
    expect(crestTone("lg_bandits")).toBe(crestTone("lg_bandits"));
    expect(new Set(SEED_LEAGUE_IDS.map(crestTone)).size).toBeGreaterThan(1);
  });
});

describe("shortNameFor", () => {
  /**
   * THE DEFECT THIS EXISTS FOR (founder, 2026-08-27): "why do all of my leagues show as O1 on the
   * left hand side?" The house factory names its rooms "Open 12-team League 40", and the old rule
   * — first letter of each of the first two words — read the 1 out of "12-team" and dropped the
   * trailing number entirely. Every twelve-team league in the product carried the identical mark.
   */
  it("keeps the trailing number, which is the whole identity in a numbered series", () => {
    expect(shortNameFor("Open 12-team League 40")).toBe("O40");
    expect(shortNameFor("Open 12-team League 31")).toBe("O31");
    expect(shortNameFor("Open 12-team League 29")).toBe("O29");
  });

  it("never lets a size token contribute a digit — three rooms of one size stay distinguishable", () => {
    const marks = ["Open 12-team League 1", "Open 12-team League 2", "Open 12-team League 3"].map(shortNameFor);
    expect(new Set(marks).size).toBe(3);
  });

  it("still takes the first letter of each of the first two words", () => {
    expect(shortNameFor("Bay Bandits")).toBe("BB");
    expect(shortNameFor("Thunder Squad")).toBe("TS");
    expect(shortNameFor("Golden Hawks")).toBe("GH");
  });

  it("falls back to the first two letters of a one-word name", () => {
    expect(shortNameFor("Ballers")).toBe("BA");
  });

  it("stays within three characters, so the 40px tile can never overflow", () => {
    for (const name of ["Open 12-team League 100", "Bay Bandits", "Ballers", "A", "The Red Zone Club 7"]) {
      expect(shortNameFor(name).length).toBeLessThanOrEqual(3);
    }
  });

  it("answers something rather than crashing on a name with nothing in it", () => {
    expect(shortNameFor("   ")).toBe("??");
  });
});

describe("Crest", () => {
  it("shows the label and hides itself from the accessibility tree, in both themes, axe-clean", async () => {
    await renderSurface(<Crest id="lg_bandits" name="Bay Bandits" />, async ({ container }) => {
      expect(screen.getByText("BB")).toBeInTheDocument();
      expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("sizes the tile from the size prop, defaulting to the rail's own 40px", () => {
    const { container, rerender } = render(<Crest id="lg_bandits" name="Bay Bandits" />);
    expect(container.firstElementChild).toHaveStyle({ width: "40px", height: "40px" });
    rerender(<Crest id="lg_bandits" name="Bay Bandits" size={64} />);
    expect(container.firstElementChild).toHaveStyle({ width: "64px", height: "64px" });
  });
});
