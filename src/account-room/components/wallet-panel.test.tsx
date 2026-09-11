import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { NOT_STARTED_DASH } from "@/components/ui/game-state-chip";
import { renderSurface } from "@/components/ui/test-utils";
import type { WalletSummary } from "@/money-service/read";
import { WalletPanel } from "./wallet-panel";

const SUMMARY: WalletSummary = { availableCents: 12_345, escrowCents: 20_00, heldCents: 5_00, owedCents: 0 };

describe("WalletPanel", () => {
  it("renders all four figures from WalletSummary, money-first, formatted with formatUsd", async () => {
    await renderSurface(<WalletPanel summary={SUMMARY} />, ({ getByText }) => {
      // Available is the hero (Gameday law 2: a `Stat` at display scale over an 11px label), and
      // renders ONCE — the duplicate that used to sit in `Panel`'s `meta` slot beside the title
      // was the same fact said twice at two different sizes, which is the thing the law's own
      // number-over-label pairing replaces.
      expect(getByText("$123.45")).toBeInTheDocument();
      expect(getByText("$20.00")).toBeInTheDocument();
      expect(getByText("$5.00")).toBeInTheDocument();
      expect(getByText("$0.00")).toBeInTheDocument();
    });
  });

  it("renders a dash rather than a zero for every figure when there is no balance to read", async () => {
    // THE FREE-SEASON CONTRACT, and the spec's own rule about a fact that has not happened yet:
    // *"a player who has not played reads as a dash and a kickoff time, never a zero"*. A wallet
    // in a free season holds no balance; it does not hold $0.00. `$0.00` appearing here would be
    // the wallet telling the most common lie a scoreboard tells, about somebody's money.
    await renderSurface(<WalletPanel summary={null} />, ({ getAllByText, container, getByText }) => {
      expect(getAllByText(NOT_STARTED_DASH)).toHaveLength(4);
      expect(container.textContent).not.toMatch(/\$/);
      expect(getByText("Available")).toBeInTheDocument();
    });
  });

  it("never tints a balance, because a balance has no population to be judged against", async () => {
    // A magnitude tint needs a stated population (`Stat`'s own contract). "Top 12% of balances"
    // is a comparison this product does not hold, and it would be a judgement about a person's
    // money besides. The refusal is STRUCTURAL rather than a resolved-to-neutral `Stat`: this
    // figure is not a `Stat` at all, so there is no `comparison` seam to hand a percentile to.
    await renderSurface(<WalletPanel summary={SUMMARY} />, ({ container }) => {
      expect(container.querySelector("[data-magnitude]")).toBeNull();
    });
  });

  it("draws the dormant hero as an absence rather than as ink", async () => {
    // `Stat`'s neutral step is `textPrimary` by design, and at 44px a dash in that ink is not a
    // dash — it is a solid bar an em wide, which in daylight reads as a redaction over the
    // reader's own balance. So the no-balance branch is deliberately NOT a `Stat`: same eyebrow,
    // same display size, faint ink, and the absence said in words for a screen reader, which
    // hears nothing at all from a bare glyph.
    await renderSurface(<WalletPanel summary={null} />, ({ container, getByText }) => {
      expect(container.querySelector("[data-magnitude]")).toBeNull();
      expect(getByText("No balance yet.")).toBeInTheDocument();
      const hero = container.querySelector(".text-display-lg");
      expect(hero?.className).toContain("text-text-faint");
    });
  });

  it("gives every figure its own one-line plain explanation, escrow's worded exactly", async () => {
    await renderSurface(<WalletPanel summary={SUMMARY} />, ({ getByText }) => {
      expect(getByText("In escrow")).toBeInTheDocument();
      expect(getByText("Entry fees for leagues that have not finished.")).toBeInTheDocument();
      expect(getByText("Available")).toBeInTheDocument();
      expect(getByText("Held for review")).toBeInTheDocument();
      expect(getByText("Owed")).toBeInTheDocument();
    });
  });

  it("never renders a raw cents number — every figure passes through formatUsd", async () => {
    await renderSurface(<WalletPanel summary={SUMMARY} />, ({ container }) => {
      expect(container.textContent).not.toMatch(/12345|2000|500(?!\.)/);
    });
  });

  it("is axe-clean in both themes, with a balance and without one", async () => {
    for (const summary of [SUMMARY, null]) {
      await renderSurface(<WalletPanel summary={summary} />, async ({ container }) => {
        expect(await axe(container)).toHaveNoViolations();
      });
    }
  });
});
