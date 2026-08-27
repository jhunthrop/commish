import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { AdminRoomDepsProvider } from "@/admin-room/hooks/deps";
import { fixtureAdminDeps } from "@/admin-room/test-fixtures";

vi.mock("@/lib/auth/current-user", () => ({ requireAdmin: vi.fn() }));

import { requireAdmin } from "@/lib/auth/current-user";
import AdminMoneyReconcilePage from "./page";

const OPERATOR = {
  id: "u_op",
  email: "u_op@test.local",
  displayName: "Op Erator",
  experienceTier: "beginner" as const,
  avatarUrl: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  isAdmin: true,
};

const cleanReport = {
  ledgerFboPoolCents: 0,
  providerPooledBalanceCents: 0,
  drift: 0,
  assetsCents: 0,
  liabilitiesCents: 0,
  ledgerBalanceDriftCents: 0,
  negativeUserAvailable: [],
  escrowMismatches: [],
  findings: [],
};

function callPage() {
  return AdminMoneyReconcilePage();
}

beforeEach(() => {
  vi.mocked(requireAdmin).mockReset().mockResolvedValue(OPERATOR);
});

describe("AdminMoneyReconcilePage — the gate", () => {
  it("404s a signed-in non-operator, never 403", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("Not an operator."));
    await expect(callPage()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });
});

describe("AdminMoneyReconcilePage — rendering", () => {
  it("renders the drift panel for an operator and loads a clean report, in both themes, axe-clean", async () => {
    const page = await callPage();
    const fixture = fixtureAdminDeps({ ok: true, data: cleanReport });
    await renderSurface(<AdminRoomDepsProvider deps={fixture.deps}>{page}</AdminRoomDepsProvider>, async ({ container }) => {
      expect(screen.getByText("Money reconciliation")).toBeInTheDocument();
      expect(await screen.findByText("The book holds no money yet. There is nothing to check.")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
