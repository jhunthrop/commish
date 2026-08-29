import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { EdgeCell } from "./edge-cell";
import { LowerThird } from "./lower-third";
import { Movement } from "./movement";

/**
 * The three primitives Sunday v5 adds, tested against the laws that justify them rather than
 * against their markup. See `docs/design/2026-08-28-sunday-spec.md`.
 */
describe("Movement (law 2)", () => {
  it("says what happened in words, not only in a triangle", async () => {
    await renderSurface(<Movement places={9} against="the market" />, ({ getByText }) => {
      expect(getByText("9 places higher than the market")).toBeInTheDocument();
    });
  });

  it("carries no chroma for an unchanged rank, because unchanged is a fact and facts are grey", async () => {
    await renderSurface(<Movement places={0} against="the market" />, ({ container, getByText }) => {
      expect(getByText("Unchanged against the market")).toBeInTheDocument();
      expect(container.querySelector("[data-movement]")).toBeNull();
      expect(container.innerHTML).not.toMatch(/text-positive|text-negative/);
    });
  });

  it("uses the verdict pair and never green-versus-red", async () => {
    await renderSurface(<Movement places={-3} against="last week" />, ({ container }) => {
      expect(container.querySelector('[data-movement="down"]')?.className).toMatch(/text-negative/);
    });
    await renderSurface(<Movement places={3} against="last week" />, ({ container }) => {
      expect(container.querySelector('[data-movement="up"]')?.className).toMatch(/text-positive/);
    });
  });

  it("says place, not places, for one", async () => {
    await renderSurface(<Movement places={1} against="the market" />, ({ getByText }) => {
      expect(getByText("1 place higher than the market")).toBeInTheDocument();
    });
  });
});

describe("EdgeCell (law 1)", () => {
  /**
   * THE REFUSAL THAT MATTERS. Our own model is unwired for the season in progress, so a null gap
   * is the common case on a live board rather than an edge case. A tinted dash would read as a
   * verdict about something we have not measured.
   */
  it("takes no tint at all when there is nothing to compare", async () => {
    await renderSurface(<EdgeCell gap={null} against="the market" />, ({ container, getByText }) => {
      expect(container.querySelector('[data-edge="unknown"]')).not.toBeNull();
      expect(container.innerHTML).not.toMatch(/text-positive|text-negative/);
      expect(getByText("No comparison against the market yet")).toBeInTheDocument();
    });
  });

  it("prints the sign, so the direction survives a monochrome print", async () => {
    await renderSurface(<EdgeCell gap={5.7} against="the market" />, ({ container }) => {
      expect(container.textContent).toContain("+5.7");
    });
    await renderSurface(<EdgeCell gap={-6.9} against="the market" />, ({ container }) => {
      expect(container.textContent).toContain("−6.9");
    });
  });

  it("treats level as information but not as a verdict", async () => {
    await renderSurface(<EdgeCell gap={0} against="expert consensus" />, ({ container, getByText }) => {
      expect(container.querySelector('[data-edge="level"]')?.className).toMatch(/text-text-muted/);
      expect(getByText("Level with expert consensus")).toBeInTheDocument();
    });
  });

  it("names who we are disagreeing with, rather than implying it", async () => {
    await renderSurface(<EdgeCell gap={2} against="expert consensus" />, ({ getByText }) => {
      expect(getByText(/expert consensus/)).toBeInTheDocument();
    });
  });
});

describe("LowerThird (law 6)", () => {
  const cells = [
    { label: "On the clock", value: "0:42", clock: true },
    { label: "Your pick", value: "1.07" },
  ];

  it("draws the clock at the hero size in the live channel", async () => {
    await renderSurface(<LowerThird cells={cells} live />, ({ getByText }) => {
      expect(getByText("0:42").className).toMatch(/text-display-lg/);
      expect(getByText("0:42").className).toMatch(/text-live/);
    });
  });

  it("puts the verb last and alone, which is what frees the rest of the screen to repeat it", async () => {
    await renderSurface(
      <LowerThird cells={cells} action={<button type="button">Draft Nacua</button>} />,
      ({ getByRole }) => {
        expect(getByRole("button", { name: "Draft Nacua" })).toBeInTheDocument();
      },
    );
  });

  it("tops the strip in live only when something is live, and in furniture amber otherwise", async () => {
    await renderSurface(<LowerThird cells={cells} live />, ({ container }) => {
      expect(container.querySelector('[data-live="true"]')?.className).toMatch(/border-live/);
    });
    await renderSurface(<LowerThird cells={cells} />, ({ container }) => {
      expect(container.querySelector("[data-live]")).toBeNull();
      expect(container.firstElementChild?.className).toMatch(/border-accent/);
    });
  });

  it("stays axe-clean in both themes", async () => {
    await renderSurface(
      <LowerThird cells={cells} live action={<button type="button">Draft</button>} />,
      async ({ container }) => {
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });
});
