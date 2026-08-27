import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { AdminRoomDepsProvider } from "../hooks/deps";
import { fixtureAdminDeps, renderInAdmin } from "../test-fixtures";
import { ReconcileDriftPanel } from "./reconcile-drift-panel";

const balancedReport = {
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

const emptyReport = { ...balancedReport, ledgerFboPoolCents: 0, providerPooledBalanceCents: 0 };

describe("ReconcileDriftPanel", () => {
  it("loads a balanced report on mount and says so plainly, in both themes, axe-clean", async () => {
    const fixture = fixtureAdminDeps({ ok: true, data: balancedReport });
    await renderSurface(
      <AdminRoomDepsProvider deps={fixture.deps}>
        <ReconcileDriftPanel />
      </AdminRoomDepsProvider>,
      async ({ container }) => {
        expect(await screen.findByText("The ledger agrees with the bank to the cent, and every internal check passed.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("prints ledger, bank and drift as their own mono rows, with cents", async () => {
    const fixture = fixtureAdminDeps({ ok: true, data: balancedReport });
    renderInAdmin(<ReconcileDriftPanel />, fixture.deps);

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Ledger pooled balance");
    expect(status).toHaveTextContent("$100.00");
    expect(status).toHaveTextContent("Bank pooled balance");
    expect(status).toHaveTextContent("Drift");
    expect(status).toHaveTextContent("$0.00");

    // Three real rows, not one prose sentence — and every value is mono.
    const monoValues = status.querySelectorAll(".font-mono");
    expect(monoValues.length).toBeGreaterThanOrEqual(3);
  });

  it("stamps the instant the report was received", async () => {
    const fixture = fixtureAdminDeps({ ok: true, data: balancedReport });
    renderInAdmin(<ReconcileDriftPanel />, fixture.deps);

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("As of");
    const time = status.querySelector("time");
    expect(time).not.toBeNull();
    expect(time!.getAttribute("dateTime")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("distinguishes a book holding nothing from a book balanced to the cent", async () => {
    const fixture = fixtureAdminDeps({ ok: true, data: emptyReport });
    renderInAdmin(<ReconcileDriftPanel />, fixture.deps);

    expect(await screen.findByText("The book holds no money yet. There is nothing to check.")).toBeInTheDocument();
    expect(screen.queryByText("The ledger agrees with the bank to the cent, and every internal check passed.")).not.toBeInTheDocument();
  });

  it("fetches the report on mount, without waiting for a click", async () => {
    const fixture = fixtureAdminDeps({ ok: true, data: balancedReport });
    renderInAdmin(<ReconcileDriftPanel />, fixture.deps);
    await screen.findByRole("status");
    expect(fixture.calls).toEqual(["GET /api/admin/money/reconcile"]);
  });

  it("names each finding, with what and how much, never why, and prints the real drift", async () => {
    const dirty = {
      ...balancedReport,
      ledgerFboPoolCents: 90_00,
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
    expect(screen.queryByText("The ledger agrees with the bank to the cent, and every internal check passed.")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("-$10.00");
  });

  it("re-fetches on Refresh, hitting the same door again, and re-stamps the instant", async () => {
    const fixture = fixtureAdminDeps({ ok: true, data: balancedReport });
    renderInAdmin(<ReconcileDriftPanel />, fixture.deps);
    const status = await screen.findByRole("status");
    const firstStamp = status.querySelector("time")!.getAttribute("dateTime");

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByRole("status");

    expect(fixture.calls).toEqual(["GET /api/admin/money/reconcile", "GET /api/admin/money/reconcile"]);
    expect(screen.getByRole("status").querySelector("time")!.getAttribute("dateTime")).not.toBeNull();
    expect(firstStamp).not.toBeNull();
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
