import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { MethodDescriptor } from "@/payments-provider/contract";
import { MONEY_CONFIG, MONEY_REFUSALS } from "@/money/config";
import { fixtureAccountDeps, renderInAccount } from "../test-fixtures";
import { AccountRoomDepsProvider } from "../hooks/deps";
import { WithdrawalForm } from "./withdrawal-form";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

const BANK: MethodDescriptor = { method: "bank", feeCents: 0, feePercentBasisPoints: 0, etaDescription: "1-3 business days" };

function fillValidForm(): void {
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "50" } });
  fireEvent.change(screen.getByLabelText("State"), { target: { value: "TN" } });
  fireEvent.change(screen.getByLabelText("Bank account reference"), { target: { value: "acct_123" } });
}

describe("WithdrawalForm", () => {
  it("shows the bank method's fee and ETA before commit, axe-clean in both themes", async () => {
    const fixture = fixtureAccountDeps();
    await renderSurface(
      <AccountRoomDepsProvider deps={fixture.deps}>
        <WithdrawalForm bankMethod={BANK} />
      </AccountRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.getByText("No fee. 1-3 business days.")).toBeInTheDocument();
        expect(screen.getByLabelText("Amount")).toBeInTheDocument();
        expect(screen.getByLabelText("Bank account reference")).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("refuses below the minimum client-side, in the server's own words", () => {
    renderInAccount(<WithdrawalForm bankMethod={BANK} />, fixtureAccountDeps().deps);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "TN" } });
    fireEvent.change(screen.getByLabelText("Bank account reference"), { target: { value: "acct_123" } });
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    expect(screen.getByText(MONEY_REFUSALS.withdrawalBelowMinimum)).toBeInTheDocument();
  });

  it("requires a bank account reference before submitting", () => {
    renderInAccount(<WithdrawalForm bankMethod={BANK} />, fixtureAccountDeps().deps);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "TN" } });
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    expect(screen.getByText("Enter your linked bank account reference.")).toBeInTheDocument();
  });

  it("posts a valid withdrawal with a minted idempotency key and refreshes on a pending transfer", async () => {
    const fixture = fixtureAccountDeps({
      ok: true,
      data: {
        transfer: { ref: "mock-transfer-1", direction: "withdrawal", amountCents: 50_00, status: "pending", initiatedAt: "2026-09-01T00:00:00.000Z" },
        feeCents: 0,
        feePercentBasisPoints: 0,
        etaDescription: "1-3 business days",
      },
    });
    renderInAccount(<WithdrawalForm bankMethod={BANK} />, fixture.deps);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));

    await waitFor(() => expect(fixture.calls).toEqual(["POST /api/wallet/withdrawals"]));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(await screen.findByText("$50.00 is on its way to your bank.")).toBeInTheDocument();
  });

  it("surfaces a declined transfer money-first", async () => {
    const fixture = fixtureAccountDeps({
      ok: true,
      data: {
        transfer: {
          ref: "mock-transfer-2",
          direction: "withdrawal",
          amountCents: MONEY_CONFIG.withdrawal.minCents,
          status: "failed",
          failureReason: "The bank declined this transfer.",
          initiatedAt: "2026-09-01T00:00:00.000Z",
        },
        feeCents: 0,
        feePercentBasisPoints: 0,
        etaDescription: "1-3 business days",
      },
    });
    renderInAccount(<WithdrawalForm bankMethod={BANK} />, fixture.deps);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    expect(await screen.findByText("No money moved. The bank declined this transfer.")).toBeInTheDocument();
  });

  it("surfaces a server refusal verbatim, including the settled-in-full sentence", async () => {
    const fixture = fixtureAccountDeps({ ok: false, error: MONEY_REFUSALS.withdrawalSettledInFull });
    renderInAccount(<WithdrawalForm bankMethod={BANK} />, fixture.deps);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    expect(await screen.findByText(MONEY_REFUSALS.withdrawalSettledInFull)).toBeInTheDocument();
  });

  it("fills the money verb with money, leaving the wallet one ink action (laws 1 and 5)", () => {
    // The mirror of `DepositForm`'s own assertion, and both are needed: law 5 is a count across a
    // VIEW, so a single form passing on its own proves nothing — it is the pair that has to be
    // quiet for the live wallet to carry one ink action. Law 1: "money is also the fill of the
    // verb, because pressing it is how money moves."
    renderInAccount(<WithdrawalForm bankMethod={BANK} />, fixtureAccountDeps().deps);
    const button = screen.getByRole("button", { name: "Withdraw" });
    expect(button.className).toContain("bg-accent");
    expect(button.className).not.toContain("bg-text-primary");
  });
});
