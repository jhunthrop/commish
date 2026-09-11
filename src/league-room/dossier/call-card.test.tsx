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
  it("prints all three columns with their stated bases", () => {
    const { container } = render(<CallCard verdict="He is a reach where he is going." market={MARKET} ourBoard={OUR_BOARD} gap={-20} />);
    expect(container.textContent).toContain("pick 24.3");
    expect(container.textContent).toContain("experts 23rd");
    expect(container.textContent).toContain("WR24");
    expect(container.textContent).toContain("54th overall");
    expect(container.textContent).toContain("197 PPR pts");
    expect(container.textContent).toContain("-20 points vs his ADP");
  });

  /**
   * ROSE IS THE RIVAL'S CHANNEL (Sideline, fix round 1 H2). `negative` in this palette is Rival
   * rose: your opponent, the swing against you. A player our board merely rates lower than the
   * drafting room does is not that, and painting him in it made a reader read "bad player" — the
   * same finding `vsMarketLabel` already rules neutral on the board ("drafters reach N picks
   * early", never red). The negative branch is ordinary ink; the sentence prints its own sign, so
   * nothing is lost. Asserted in BOTH themes, because ink and rose are different roles in each.
   */
  it("leaves a negative gap in ordinary ink, never the rival's rose, in both themes", async () => {
    await renderSurface(<CallCard verdict="Let him go." market={MARKET} ourBoard={OUR_BOARD} gap={-20} />, async ({ container }) => {
      expect(verdictEl(container)).toHaveClass("text-text-muted");
      expect(gapEl(container)).toHaveClass("text-text-muted");
      expect(verdictEl(container)).not.toHaveClass("text-negative");
      expect(gapEl(container)).not.toHaveClass("text-negative");
      // The sign survives without the colour, which is why the colour could go.
      expect(container.textContent).toContain("-20 points vs his ADP");
    });
  });

  it("keeps the positive gap in the good-outcome green, in both themes", async () => {
    await renderSurface(<CallCard verdict="Draft him." market={MARKET} ourBoard={OUR_BOARD} gap={20} />, async ({ container }) => {
      expect(verdictEl(container)).toHaveClass("text-positive");
      expect(gapEl(container)).toHaveClass("text-positive");
      expect(container.textContent).toContain("+20 points vs his ADP");
    });
  });

  it("takes no verdict tint for a genuine zero gap or an absent one", () => {
    const zero = render(<CallCard verdict="Even." market={MARKET} ourBoard={OUR_BOARD} gap={0} />);
    expect(verdictEl(zero.container)).toHaveClass("text-text-muted");
    expect(gapEl(zero.container)).toHaveClass("text-text-muted");

    const unpriced = render(<CallCard verdict={null} market={MARKET} ourBoard={OUR_BOARD} gap={null} />);
    expect(verdictEl(unpriced.container)).toBeNull();
    expect(gapEl(unpriced.container)).toHaveClass("text-text-muted");
    expect(unpriced.container.textContent).toContain("No ADP to compare against.");
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
    const { container } = render(<CallCard verdict="He is a reach where he is going." market={MARKET} ourBoard={OUR_BOARD} gap={-20} />);
    const verdict = verdictEl(container)!.textContent!;
    const gap = gapEl(container)!.textContent!;
    const talent = container.querySelector('[data-call="talent-vs-games"]')!.textContent!;
    for (const sentence of [verdict, gap, talent]) {
      expect(sentence).not.toMatch(/—/);
      expect(sentence).not.toMatch(/;/);
    }
  });

  it("renders axe-clean in both themes", async () => {
    await renderSurface(<CallCard verdict="He is a reach where he is going." market={MARKET} ourBoard={OUR_BOARD} gap={-20} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
