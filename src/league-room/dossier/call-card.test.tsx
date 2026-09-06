import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { CallCard, type CallCardMarket, type CallCardOurBoard } from "./call-card";

const MARKET: CallCardMarket = { adp: 24.3, expertRank: 23 };
const OUR_BOARD: CallCardOurBoard = { position: "WR", positionRank: 24, boardRank: 54, points: 197, scoringLabel: "PPR", perGameRank: 8, expectedGames: 15.4 };

function verdictEl(container: HTMLElement) {
  return container.querySelector('[data-call="verdict"]');
}
function gapEl(container: HTMLElement) {
  return container.querySelector('[data-call="gap"]');
}

describe("CallCard", () => {
  it("prints all three price columns with their stated bases", () => {
    const { container } = render(<CallCard verdict="The market is overpricing him." market={MARKET} ourBoard={OUR_BOARD} gap={-20} />);
    expect(container.textContent).toContain("pick 24.3");
    expect(container.textContent).toContain("experts 23rd");
    expect(container.textContent).toContain("WR24");
    expect(container.textContent).toContain("54th overall");
    expect(container.textContent).toContain("197 PPR pts");
    expect(container.textContent).toContain("-20 points vs his price");
  });

  it("colors the verdict and the gap column negative when the gap is negative", () => {
    const { container } = render(<CallCard verdict="Fade." market={MARKET} ourBoard={OUR_BOARD} gap={-20} />);
    expect(verdictEl(container)).toHaveClass("text-negative");
    expect(gapEl(container)).toHaveClass("text-negative");
  });

  it("colors the verdict and the gap column positive when the gap is positive", () => {
    const { container } = render(<CallCard verdict="Buy." market={MARKET} ourBoard={OUR_BOARD} gap={20} />);
    expect(verdictEl(container)).toHaveClass("text-positive");
    expect(gapEl(container)).toHaveClass("text-positive");
    expect(container.textContent).toContain("+20 points vs his price");
  });

  it("takes no verdict tint for a genuine zero gap or an absent one", () => {
    const zero = render(<CallCard verdict="Even." market={MARKET} ourBoard={OUR_BOARD} gap={0} />);
    expect(verdictEl(zero.container)).toHaveClass("text-text-muted");
    expect(gapEl(zero.container)).toHaveClass("text-text-muted");

    const unpriced = render(<CallCard verdict={null} market={MARKET} ourBoard={OUR_BOARD} gap={null} />);
    expect(verdictEl(unpriced.container)).toBeNull();
    expect(gapEl(unpriced.container)).toHaveClass("text-text-muted");
    expect(unpriced.container.textContent).toContain("Not priced by the market.");
  });

  it("renders the talent-vs-games sentence only when the per-game rank and expected games both exist", () => {
    const present = render(<CallCard verdict="Buy." market={MARKET} ourBoard={OUR_BOARD} gap={20} />);
    expect(present.container.textContent).toContain("Per game he projects like a WR8.");
    expect(present.container.textContent).toContain("our model expects 15.");

    const noPerGameRank = render(<CallCard verdict="Buy." market={MARKET} ourBoard={{ ...OUR_BOARD, perGameRank: null }} gap={20} />);
    expect(noPerGameRank.container.textContent).not.toContain("Per game he projects");

    const noExpectedGames = render(<CallCard verdict="Buy." market={MARKET} ourBoard={{ ...OUR_BOARD, expectedGames: null }} gap={20} />);
    expect(noExpectedGames.container.textContent).not.toContain("Per game he projects");
  });

  it("prints an honest dash for a market number this product cannot reach", () => {
    const { container } = render(<CallCard verdict="Buy." market={{ adp: null, expertRank: null }} ourBoard={OUR_BOARD} gap={20} />);
    expect(container.textContent).toContain("pick — · experts —");
  });

  it("follows the copy rules — no em-dash, no semicolon — in every sentence it composes itself", () => {
    const { container } = render(<CallCard verdict="The market is overpricing him." market={MARKET} ourBoard={OUR_BOARD} gap={-20} />);
    const verdict = verdictEl(container)!.textContent!;
    const gap = gapEl(container)!.textContent!;
    const talent = container.querySelector('[data-call="talent-vs-games"]')!.textContent!;
    for (const sentence of [verdict, gap, talent]) {
      expect(sentence).not.toMatch(/—/);
      expect(sentence).not.toMatch(/;/);
    }
  });

  it("renders axe-clean in both themes", async () => {
    await renderSurface(<CallCard verdict="The market is overpricing him." market={MARKET} ourBoard={OUR_BOARD} gap={-20} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
