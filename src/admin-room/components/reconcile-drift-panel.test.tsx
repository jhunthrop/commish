import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { AdminRoomDepsProvider } from "../hooks/deps";
import { fixtureAdminDeps, renderInAdmin } from "../test-fixtures";
import { ReconcileDriftPanel } from "./reconcile-drift-panel";

const cleanReport = {
  ledgerFboPoolCents: 100_00,
  providerPooledBalanceCents: 100_00,
  drift: 0,
  assetsCents: 100_00,
  liabilitiesCents: 100_00,
  ledgerBalanceDriftCents: 0,
  negativeUserAvailable: [],
  escrowMismatches: [],
  findings: [],
};

describe("ReconcileDriftPanel", () => {
  it("loads a clean report on mount and says so plainly, in both themes, axe-clean", async () => {
    const fixture = fixtureAdminDeps({ ok: true, data: cleanReport });
    await renderSurface(
      <AdminRoomDepsProvider deps={fixture.deps}>
        <ReconcileDriftPanel />
      </AdminRoomDepsProvider>,
      async ({ container }) => {
        expect(await screen.findByText("No drift found. The ledger agrees with the bank, and every internal check is clean.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("fetches the report on mount, without waiting for a click", async () => {
    const fixture = fixtureAdminDeps({ ok: true, data: cleanReport });
    renderInAdmin(<ReconcileDriftPanel />, fixture.deps);
    await screen.findByRole("status");
    expect(fixture.calls).toEqual(["GET /api/admin/money/reconcile"]);
  });

  it("names each finding, with what and how much, never why", async () => {
    const dirty = {
      ...cleanReport,
      drift: -10_00,
      findings: [
        { code: "bank_drift", message: "The ledger's pooled balance disagrees with the bank by $10.00." },
        { code: "negative_user_available", message: "user_available:u1 carries a negative balance of $3.00." },
      ],
    };
    const fixture = fixtureAdminDeps({ ok: true, data: dirty });
    renderInAdmin(<ReconcileDriftPanel />, fixture.deps);

    expect(await screen.findByText("The ledger's pooled balance disagrees with the bank by $10.00.")).toBeInTheDocument();
    expect(screen.getByText("user_available:u1 carries a negative balance of $3.00.")).toBeInTheDocument();
    expect(screen.queryByText("No drift found. The ledger agrees with the bank, and every internal check is clean.")).not.toBeInTheDocument();
  });

  it("re-fetches on Refresh, hitting the same door again", async () => {
    const fixture = fixtureAdminDeps({ ok: true, data: cleanReport });
    renderInAdmin(<ReconcileDriftPanel />, fixture.deps);
    await screen.findByRole("status");

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByRole("status");

    expect(fixture.calls).toEqual(["GET /api/admin/money/reconcile", "GET /api/admin/money/reconcile"]);
  });

  it("shows the server's own refusal sentence verbatim on a non-ok envelope", async () => {
    const fixture = fixtureAdminDeps({ ok: false, error: "Not found." });
    renderInAdmin(<ReconcileDriftPanel />, fixture.deps);

    expect(await screen.findByRole("alert")).toHaveTextContent("Not found.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("says the server is unreachable when the request itself throws", async () => {
    const deps = {
      fetchJson: () => Promise.reject(new Error("offline")),
    };
    renderInAdmin(<ReconcileDriftPanel />, deps);

    expect(await screen.findByRole("alert")).toHaveTextContent("We could not reach the server. Check your connection and try again.");
  });
});
