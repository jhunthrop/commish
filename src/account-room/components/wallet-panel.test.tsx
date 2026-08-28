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
    // money besides. `Stat` stamps the step it resolved; `neutral` IS `textPrimary`.
    for (const summary of [SUMMARY, null]) {
      await renderSurface(<WalletPanel summary={summary} />, ({ container }) => {
        expect(container.querySelector("[data-magnitude]")?.getAttribute("data-magnitude")).toBe("neutral");
      });
    }
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
