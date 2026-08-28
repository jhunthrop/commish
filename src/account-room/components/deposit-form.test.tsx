import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { MethodDescriptor } from "@/payments-provider/contract";
import { MONEY_CONFIG, MONEY_REFUSALS } from "@/money/config";
import { fixtureAccountDeps, renderInAccount } from "../test-fixtures";
import { AccountRoomDepsProvider } from "../hooks/deps";
import { DepositForm } from "./deposit-form";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

const METHODS: readonly MethodDescriptor[] = [
  { method: "bank", feeCents: 0, feePercentBasisPoints: 0, etaDescription: "1-3 business days" },
  { method: "card", feeCents: 30, feePercentBasisPoints: 325, etaDescription: "Within minutes" },
];

function fillValidForm(): void {
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "50" } });
  fireEvent.change(screen.getByLabelText("State"), { target: { value: "TN" } });
}

describe("DepositForm", () => {
  it("renders the amount, state and method fields plus the selected method's fee and ETA before commit, axe-clean in both themes", async () => {
    const fixture = fixtureAccountDeps();
    await renderSurface(
      <AccountRoomDepsProvider deps={fixture.deps}>
        <DepositForm methods={METHODS} />
      </AccountRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.getByLabelText("Amount")).toBeInTheDocument();
        expect(screen.getByLabelText("State")).toBeInTheDocument();
        expect(screen.getByLabelText("Method")).toBeInTheDocument();
        expect(screen.getByText("No fee. 1-3 business days.")).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("updates the shown fee and ETA when the method changes", () => {
    renderInAccount(<DepositForm methods={METHODS} />, fixtureAccountDeps().deps);
    fireEvent.change(screen.getByLabelText("Method"), { target: { value: "card" } });
    expect(screen.getByText("$0.30 plus 3.25% fee. Within minutes.")).toBeInTheDocument();
  });

  it("refuses below the minimum client-side, in the server's own words, and sends nothing", () => {
    renderInAccount(<DepositForm methods={METHODS} />, fixtureAccountDeps().deps);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "TN" } });
    fireEvent.click(screen.getByRole("button", { name: "Add money" }));
    expect(screen.getByText(MONEY_REFUSALS.depositBelowMinimum)).toBeInTheDocument();
  });

  it("refuses above the maximum client-side, in the server's own words", () => {
    renderInAccount(<DepositForm methods={METHODS} />, fixtureAccountDeps().deps);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "10001" } });
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "TN" } });
    fireEvent.click(screen.getByRole("button", { name: "Add money" }));
    expect(screen.getByText(MONEY_REFUSALS.depositAboveMaximum)).toBeInTheDocument();
  });

  it("requires a state before submitting", () => {
    renderInAccount(<DepositForm methods={METHODS} />, fixtureAccountDeps().deps);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Add money" }));
    expect(screen.getByText("Choose your state.")).toBeInTheDocument();
  });

  it("posts a valid deposit with a minted idempotency key, in whole cents, and refreshes on a pending transfer", async () => {
    const fixture = fixtureAccountDeps({
      ok: true,
      data: { transfer: { ref: "mock-transfer-1", direction: "deposit", amountCents: 50_00, status: "pending", initiatedAt: "2026-09-01T00:00:00.000Z" } },
    });
    renderInAccount(<DepositForm methods={METHODS} />, fixture.deps);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Add money" }));

    await waitFor(() => expect(fixture.calls).toEqual(["POST /api/wallet/deposits"]));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(await screen.findByText("$50.00 is on its way to your wallet.")).toBeInTheDocument();
  });

  it("surfaces a declined transfer money-first", async () => {
    const fixture = fixtureAccountDeps({
      ok: true,
      data: {
        transfer: {
          ref: "mock-transfer-2",
          direction: "deposit",
          amountCents: MONEY_CONFIG.deposit.minCents,
          status: "failed",
          failureReason: "The bank declined this transfer.",
          initiatedAt: "2026-09-01T00:00:00.000Z",
        },
      },
    });
    renderInAccount(<DepositForm methods={METHODS} />, fixture.deps);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Add money" }));
    expect(await screen.findByText("No money moved. The bank declined this transfer.")).toBeInTheDocument();
  });

  it("surfaces a server refusal verbatim, as the door's own money-first sentence", async () => {
    const fixture = fixtureAccountDeps({ ok: false, error: MONEY_REFUSALS.stateNotEnabled });
    renderInAccount(<DepositForm methods={METHODS} />, fixture.deps);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Add money" }));
    expect(await screen.findByText(MONEY_REFUSALS.stateNotEnabled)).toBeInTheDocument();
  });

  it("fills the money verb with money, leaving the wallet one ink action (laws 1 and 5)", () => {
    // The live wallet used to render three ink pills at once — add, withdraw and verify — and
    // force a reader to choose between three loud things on the one surface where being sure
    // matters most. Law 1: "money is also the fill of the verb, because pressing it is how money
    // moves." `bg-text-primary` is the ink pill's own fill and belongs to the one ceremonial act
    // on a view, which here is the identity gate, not a transfer.
    renderInAccount(<DepositForm methods={METHODS} />, fixtureAccountDeps().deps);
    const button = screen.getByRole("button", { name: "Add money" });
    expect(button.className).toContain("bg-accent");
    expect(button.className).not.toContain("bg-text-primary");
  });
});
