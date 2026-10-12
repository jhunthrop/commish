import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

import { screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { AccountRoomDepsProvider } from "@/account-room/hooks/deps";
import { fixtureAccountDeps } from "@/account-room/test-fixtures";
import { users } from "@/db/schema";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll, truncateMoneyTables } from "@/db/test-db";

vi.mock("@/lib/auth/current-user", () => ({ requireCurrentUser: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { requireCurrentUser } from "@/lib/auth/current-user";
import WalletPage from "./page";
import { renderWalletContent } from "./wallet-content";

const db = createTestDb();

const USER = {
  id: "u1",
  email: "u1@test.local",
  displayName: "Ada Lovelace",
  experienceTier: "beginner" as const,
  avatarUrl: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  isAdmin: false,
};

function callPage() {
  return WalletPage();
}

beforeEach(async () => {
  vi.mocked(requireCurrentUser).mockReset().mockResolvedValue(USER);
  await truncateAll(db);
  await truncateMoneyTables(db);
});

/**
 * `moneyIsLive()` reads the shipped `MONEY_STATES.enabled`, which ships EMPTY (decision 7) — a
 * module-level constant this page has no injection seam for, on purpose (the same "one dark/live
 * switch, read the same way everywhere" discipline `FREE_SEASON_ENTRY_FEE_MESSAGE`'s own callers
 * hold to). The page can therefore only be proven against the DARK branch here: the branch every
 * production request actually takes today. The LIVE branch's rendering (four figures, both forms,
 * both panels) is proven at the component level instead — `WalletPanel`, `DepositForm`,
 * `WithdrawalForm`, `KycPanel` and `ExclusionPanel` each take injected props directly, exactly the
 * shape their own test suites already exercise.
 */
describe("WalletPage — money is dark", () => {
  it("renders the dark-state sentence, no balance figures, no forms, axe-clean in both themes", async () => {
    const fixture = fixtureAccountDeps();
    const page = await callPage();
    await renderSurface(<AccountRoomDepsProvider deps={fixture.deps}>{page}</AccountRoomDepsProvider>, async ({ container }) => {
      expect(screen.getByText("Real-money play is not available yet. Every league is free this season.")).toBeInTheDocument();
      // No mock data on a real surface: no dollar figure, no deposit/withdrawal/KYC form.
      expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Amount")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Legal name")).not.toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});

/**
 * `live: true`, injected directly at `renderWalletContent` — proving the composition wiring
 * (`walletSummary` + `walletAccountFlags` + the shared provider's `listSupportedMethods()`, all
 * five components) is correct end to end against a real seeded row, not only that each component
 * renders correctly in isolation from injected props (already proven by their own suites).
 */
describe("WalletPage — money is live (composition proof, injected)", () => {
  it("wires a fresh member's real data into all five components with no figure, form or panel missing", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "Ada Lovelace" });
    const content = await renderWalletContent("u1", true);
    const fixture = fixtureAccountDeps();
    await renderSurface(<AccountRoomDepsProvider deps={fixture.deps}>{content}</AccountRoomDepsProvider>, async ({ container }) => {
      expect(screen.getByText("Balance")).toBeInTheDocument();
      expect(screen.getAllByText("$0.00").length).toBeGreaterThan(0);
      expect(screen.getAllByLabelText("Amount").length).toBe(2);
      expect(screen.getByRole("button", { name: "Add money" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Withdraw" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Verify identity" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Close paid play on this account" })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
