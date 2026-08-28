import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { TierDivider } from "./tier-divider";
import { MICRO_LABEL } from "./config";
import { TIER_GRADES } from "@/design/tokens";

describe("TierDivider", () => {
  it("prints the grade as text and the label beside it, and is axe-clean in both themes", async () => {
    await renderSurface(<TierDivider grade="S" label="Elite backs" />, async ({ container }) => {
      expect(screen.getByText("S")).toBeInTheDocument();
      expect(screen.getByText("Elite backs")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  /**
   * THE COLOURBLIND CHANNEL, held at the component. The tier ramp's adjacent rungs are close in
   * hue deliberately (`TOKENS.tier`) — red, amber, gold — so unlike the position stickers it is
   * NOT separable by hue, and `tokens.test.ts` says so explicitly by refusing to hold tier pairs
   * to the pairwise rule. Everything therefore rests on the letter being real text: four bands a
   * manager with deuteranopia cannot rank are worse than a board with no tiers at all.
   */
  it("renders every grade's own letter as text, never as colour alone", () => {
    for (const grade of TIER_GRADES) {
      const { unmount } = render(<TierDivider grade={grade} label="Round 3 targets" />);
      expect(screen.getByText(grade)).toBeInTheDocument();
      unmount();
    }
  });

  it("paints each grade from its own token pair — the fill and the letter that is proven to sit on it", () => {
    // A literal class map per grade, because Tailwind ships only what it can see: a
    // template-built `bg-tier-${grade}` compiles, renders, and produces no CSS at all.
    for (const grade of TIER_GRADES) {
      const key = grade.toLowerCase();
      const { unmount } = render(<TierDivider grade={grade} label="Round 3 targets" />);
      // The PLATE carries the pair now, and the letter and the label both sit on it — the band
      // is filled across its own words rather than being a stamp beside grey text. The pairing is
      // unchanged, which is what lets this keep asserting the two proven token roles together.
      const plate = screen.getByText(grade).parentElement!;
      expect(plate.className).toContain(`bg-tier-${key}`);
      expect(plate.className).toContain(`text-tier-${key}-on`);
      expect(plate).toHaveTextContent("Round 3 targets");
      unmount();
    }
  });

  it("takes the theme-reactive route: a class over per-theme variables, never a baked-in colour", () => {
    // The whole reason `tier` became a CSS variable. If this ever regresses to an inline style
    // the component has to pick ONE of the two designed palettes at render time, and the theme it
    // did not pick ships badges that fail WCAG 1.4.11's 3:1 against their own ground.
    render(<TierDivider grade="A" label="Round 3 targets" />);
    expect(screen.getByText("A")).not.toHaveAttribute("style");
  });

  it("speaks the label in the one sanctioned all-caps register, imported rather than hand-rolled", () => {
    render(<TierDivider grade="B" label="Round 3 targets" />);
    for (const cls of MICRO_LABEL.split(" ")) {
      expect(screen.getByText("Round 3 targets").className).toContain(cls);
    }
  });

  it("fills the leftover width with a decorative hairline, on the line role and hidden from readers", () => {
    const { container } = render(<TierDivider grade="C" label="Bench fliers" />);
    const rule = container.querySelector("[aria-hidden='true']")!;
    expect(rule.className).toContain("bg-line");
    expect(rule.className).toContain("flex-1");
    // `line` is the decorative hairline between two surfaces; `edge` bounds a control, and a tier
    // band is not one.
    expect(rule.className).not.toContain("bg-edge");
  });

  it("lets the call site place the band without touching its pigment or its parts", () => {
    const { container } = render(<TierDivider grade="S" label="Elite backs" className="mt-3 px-2" />);
    const root = container.querySelector("[data-grade='S']")!;
    expect(root.className).toContain("mt-3");
    expect(root.className).toContain("px-2");
    expect(root.className).toContain("flex");
  });
});
