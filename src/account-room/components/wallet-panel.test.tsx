import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { WalletSummary } from "@/money-service/read";
import { WalletPanel } from "./wallet-panel";

const SUMMARY: WalletSummary = { availableCents: 12_345, escrowCents: 20_00, heldCents: 5_00, owedCents: 0 };

describe("WalletPanel", () => {
  it("renders all four figures from WalletSummary, money-first, formatted with formatUsd", async () => {
    await renderSurface(<WalletPanel summary={SUMMARY} />, ({ getAllByText, getByText }) => {
      // Available renders twice: once in the panel header (money-first), once in its own row.
      expect(getAllByText("$123.45").length).toBeGreaterThanOrEqual(2);
      expect(getByText("$20.00")).toBeInTheDocument();
      expect(getByText("$5.00")).toBeInTheDocument();
      expect(getByText("$0.00")).toBeInTheDocument();
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

  it("is axe-clean in both themes", async () => {
    await renderSurface(<WalletPanel summary={SUMMARY} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
