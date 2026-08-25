import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { fixtureAccountDeps, renderInAccount } from "../test-fixtures";
import { AccountRoomDepsProvider } from "../hooks/deps";
import { KycPanel } from "./kyc-panel";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

function fillForm(): void {
  fireEvent.change(screen.getByLabelText("Legal name"), { target: { value: "Ada Lovelace" } });
  fireEvent.change(screen.getByLabelText("Date of birth"), { target: { value: "1990-01-01" } });
  fireEvent.change(screen.getByLabelText("State"), { target: { value: "TN" } });
}

describe("KycPanel", () => {
  it("renders a submit form and explains the federal requirement when status is none, axe-clean in both themes", async () => {
    const fixture = fixtureAccountDeps();
    await renderSurface(
      <AccountRoomDepsProvider deps={fixture.deps}>
        <KycPanel status="none" />
      </AccountRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.getByText("Verify your identity")).toBeInTheDocument();
        expect(screen.getByLabelText("Legal name")).toBeInTheDocument();
        expect(screen.getByLabelText("Date of birth")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Verify identity" })).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("shows a pending status with no form and no action", async () => {
    await renderSurface(<KycPanel status="pending" />, ({ getByText, queryByLabelText, queryByRole }) => {
      expect(getByText("Your verification is in review.")).toBeInTheDocument();
      expect(queryByLabelText("Legal name")).not.toBeInTheDocument();
      expect(queryByRole("button", { name: "Verify identity" })).not.toBeInTheDocument();
    });
  });

  it("shows a verified status with no form", async () => {
    await renderSurface(<KycPanel status="verified" />, ({ getByText, queryByLabelText }) => {
      expect(getByText("Verified")).toBeInTheDocument();
      expect(queryByLabelText("Legal name")).not.toBeInTheDocument();
    });
  });

  it("gives a failed status a concrete next action: the resubmit form, with an explanation", async () => {
    await renderSurface(<KycPanel status="failed" />, ({ getByText, getByLabelText, getByRole }) => {
      expect(getByText("Verification did not go through.")).toBeInTheDocument();
      expect(getByLabelText("Legal name")).toBeInTheDocument();
      expect(getByRole("button", { name: "Try again" })).toBeInTheDocument();
    });
  });

  it("submits the form, refreshes on success, and requires every field first", async () => {
    const fixture = fixtureAccountDeps({ ok: true, data: { status: "pending" } });
    renderInAccount(<KycPanel status="none" />, fixture.deps);

    fireEvent.click(screen.getByRole("button", { name: "Verify identity" }));
    expect(screen.getByText("Fill in every field.")).toBeInTheDocument();

    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Verify identity" }));
    await waitFor(() => expect(fixture.calls).toEqual(["POST /api/wallet/kyc"]));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(await screen.findByText("Submitted. Your verification is in review.")).toBeInTheDocument();
  });

  it("surfaces a server refusal verbatim", async () => {
    const fixture = fixtureAccountDeps({ ok: false, error: "No money moved. Paid play is not open in your state yet." });
    renderInAccount(<KycPanel status="none" />, fixture.deps);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Verify identity" }));
    expect(await screen.findByText("No money moved. Paid play is not open in your state yet.")).toBeInTheDocument();
  });
});
