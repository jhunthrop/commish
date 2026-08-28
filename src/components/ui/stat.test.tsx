import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { Stat, magnitudeStep, type StatComparison } from "./stat";
import { MAGNITUDE_STEPS } from "@/design/tokens";

/**
 * THE COLOURBLIND GATE, held at the component (docs/design/2026-08-27-fun-pass-spec.md):
 * green-versus-red is the worst available pair for deuteranopia, roughly one man in twelve has
 * it, and this product's audience is overwhelmingly men. `tokens.test.ts` proves the ramp's
 * pigments are legible and ordered by luminance rather than hue; that is necessary and nowhere
 * near sufficient. What actually keeps a heat map honest is that colour is never the only
 * channel, and only the component can promise that:
 *
 * - the value reads plainly as its own number in every state, and
 * - a judged value carries a caret (which side of the population it fell on) and a weight step
 *   (how far), so a manager who sees no colour at all still ranks the column correctly.
 *
 * A heat map that fails this is worse than no heat map, because it silently misinforms one
 * manager in twelve. These tests are the reason it cannot regress into one.
 */
const RB_WEEK: StatComparison = { percentile: 0.92, population: "running backs this week" };

describe("magnitudeStep", () => {
  it("returns every step across the percentile range, best first", () => {
    expect(magnitudeStep({ ...RB_WEEK, percentile: 0.97 })).toBe("strong");
    expect(magnitudeStep({ ...RB_WEEK, percentile: 0.7 })).toBe("good");
    expect(magnitudeStep({ ...RB_WEEK, percentile: 0.5 })).toBe("neutral");
    expect(magnitudeStep({ ...RB_WEEK, percentile: 0.2 })).toBe("weak");
    expect(magnitudeStep({ ...RB_WEEK, percentile: 0.02 })).toBe("bad");
  });

  it("renders neutral with no comparison at all, because we do not colour a number for looking big", () => {
    expect(magnitudeStep(undefined)).toBe("neutral");
  });

  it("refuses a comparison that is not genuine: an unnamed population, or a percentile off the scale", () => {
    // "Only permitted where the comparison is genuine and stated" (spec, rule 1). A percentile
    // outside 0..1 is a caller bug, and colouring on a caller bug is exactly the failure mode
    // this ramp exists to avoid — so the number goes back to being a plain number rather than
    // asserting a rank nobody computed.
    expect(magnitudeStep({ percentile: 0.99, population: "   " })).toBe("neutral");
    expect(magnitudeStep({ percentile: 1.4, population: "running backs this week" })).toBe("neutral");
    expect(magnitudeStep({ percentile: -0.1, population: "running backs this week" })).toBe("neutral");
    expect(magnitudeStep({ percentile: Number.NaN, population: "running backs this week" })).toBe("neutral");
  });
});

describe("Stat", () => {
  it("reads plainly as its own number in every magnitude state", async () => {
    // The first and least negotiable channel: whatever the tint is doing, the number is on
    // screen as text. Every step, not just the loud ones.
    const percentiles = [0.97, 0.7, 0.5, 0.2, 0.02];
    for (const percentile of percentiles) {
      await renderSurface(<Stat label="Projection" value="14.2" comparison={{ ...RB_WEEK, percentile }} />, ({ getByText }) => {
        expect(getByText("14.2")).toBeInTheDocument();
        expect(getByText("Projection")).toBeInTheDocument();
      });
    }
  });

  it("gives a judged value a caret and a weight step, so the ranking survives with no colour at all", async () => {
    await renderSurface(<Stat label="Projection" value="14.2" comparison={{ ...RB_WEEK, percentile: 0.97 }} />, ({ container }) => {
      const root = container.querySelector("[data-magnitude]")!;
      expect(root.getAttribute("data-magnitude")).toBe("strong");
      expect(root.textContent).toContain("▲");
      expect(container.querySelector(".font-semibold")).not.toBeNull();
    });
    await renderSurface(<Stat label="Projection" value="4.1" comparison={{ ...RB_WEEK, percentile: 0.02 }} />, ({ container }) => {
      const root = container.querySelector("[data-magnitude]")!;
      expect(root.getAttribute("data-magnitude")).toBe("bad");
      expect(root.textContent).toContain("▼");
      expect(container.querySelector(".font-semibold")).not.toBeNull();
    });
  });

  it("separates the two sides of the population by caret and the distance by weight", async () => {
    // Four verdict steps, three channels: side (caret), distance (weight), tint (colour). The
    // first two are the ones a monochrome eye still has.
    const cases = [
      { percentile: 0.97, caret: "▲", weight: "font-semibold" },
      { percentile: 0.7, caret: "▲", weight: "font-medium" },
      { percentile: 0.2, caret: "▼", weight: "font-medium" },
      { percentile: 0.02, caret: "▼", weight: "font-semibold" },
    ] as const;
    for (const { percentile, caret, weight } of cases) {
      await renderSurface(<Stat label="Projection" value="14.2" comparison={{ ...RB_WEEK, percentile }} />, ({ container }) => {
        expect(container.querySelector("[data-magnitude]")!.textContent).toContain(caret);
        expect(container.querySelector(`.${weight}`)).not.toBeNull();
      });
    }
  });

  it("renders an uncompared number exactly like ordinary text: no tint, no caret, no weight step", async () => {
    await renderSurface(<Stat label="Projection" value="14.2" />, ({ container }) => {
      const root = container.querySelector("[data-magnitude]")!;
      expect(root.getAttribute("data-magnitude")).toBe("neutral");
      expect(root.textContent).not.toContain("▲");
      expect(root.textContent).not.toContain("▼");
      expect(container.querySelector(".font-semibold")).toBeNull();
      expect(container.querySelector(".font-medium")).toBeNull();
      expect(container.innerHTML).toContain("text-mag-neutral");
    });
  });

  it("paints each step in its own magnitude ink, and nothing else", async () => {
    for (const step of MAGNITUDE_STEPS) {
      const percentile = { strong: 0.97, good: 0.7, neutral: 0.5, weak: 0.2, bad: 0.02 }[step];
      await renderSurface(<Stat label="Projection" value="14.2" comparison={{ ...RB_WEEK, percentile }} />, ({ container }) => {
        expect(container.innerHTML).toContain(`text-mag-${step}`);
      });
    }
  });

  it("states the population it compared against, in words, wherever the tint came from", async () => {
    await renderSurface(<Stat label="Projection" value="14.2" comparison={RB_WEEK} />, ({ getByText }) => {
      expect(getByText("Top 8% of running backs this week.")).toBeInTheDocument();
    });
    await renderSurface(<Stat label="Projection" value="4.1" comparison={{ ...RB_WEEK, percentile: 0.12 }} />, ({ getByText }) => {
      expect(getByText("Bottom 12% of running backs this week.")).toBeInTheDocument();
    });
  });

  it("says nothing about a population when there is no comparison to state", async () => {
    await renderSurface(<Stat label="Projection" value="14.2" />, ({ queryByText }) => {
      expect(queryByText(/running backs/)).toBeNull();
      expect(queryByText(/Top /)).toBeNull();
    });
  });

  it("takes its dynamic range from size, never from a heavier face than the display cap", async () => {
    // Rule 2 holds: the weight cap is 600 (`font-semibold`), and the number gets big by being
    // big. `font-bold` must never appear here, at any size or any magnitude.
    await renderSurface(<Stat label="Score" value="118.4" size="3xl" comparison={RB_WEEK} />, ({ container }) => {
      expect(container.innerHTML).toContain("text-display-3xl");
      expect(container.innerHTML).not.toContain("font-bold");
    });
  });

  it("pairs the top of the display scale with the eyebrow register, which is where the ~10x lives", async () => {
    // The scale carries the range (`tokens.test.ts`); this is the component that spends it. A
    // 116px number over a 12px mono label is the shape a sports interface has and a contract
    // does not.
    await renderSurface(<Stat label="Score" value="118.4" size="3xl" comparison={RB_WEEK} />, ({ getByText }) => {
      expect(getByText("Score").className).toContain("text-xs");
      expect(getByText("118.4").parentElement!.className).toContain("text-display-3xl");
    });
  });

  it("is axe-clean in both themes, coloured and uncoloured", async () => {
    await renderSurface(<Stat label="Projection" value="14.2" comparison={RB_WEEK} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
    await renderSurface(<Stat label="Projection" value="14.2" />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
