import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({
  requireAdmin: vi.fn(),
}));

import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll, truncateMoneyTables } from "@/db/test-db";
import { requireAdmin } from "@/lib/auth/current-user";
import { getAuditLogger } from "@/integrity-service/audit-logger";
import { accountIdFor } from "@/money/accounts";
import { postMoneyTransaction, type MoneyTransactionInput } from "@/money-service/post";
import { GET } from "./route";
import type { ReconcileDriftBody } from "./route";

const db = createTestDb();

const signedInAs = (id: string | null) => {
  if (id === null) {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("Not authenticated."));
    return;
  }
  if (id === "u_plain") {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("Not an operator."));
    return;
  }
  vi.mocked(requireAdmin).mockResolvedValue({
    id,
    email: `${id}@test.local`,
    displayName: id,
    experienceTier: "beginner",
    avatarUrl: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    isAdmin: true,
  });
};

function reconcile() {
  const request = new Request("http://test/api/admin/money/reconcile");
  return GET(request);
}

beforeEach(async () => {
  await truncateAll(db);
  await truncateMoneyTables(db);
  vi.mocked(requireAdmin).mockReset();
});

afterAll(async () => {
  await truncateAll(db);
});

describe("GET /api/admin/money/reconcile", () => {
  it("answers 401 JSON when nobody is signed in", async () => {
    signedInAs(null);
    const response = await reconcile();
    expect(response.status).toBe(401);
  });

  it("answers 404, never 403, for a signed-in non-operator (ruling 14)", async () => {
    signedInAs("u_plain");
    const response = await reconcile();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "Not found." });
  });

  it("answers a clean report on an empty book, with no findings", async () => {
    signedInAs("u_op");
    const response = await reconcile();
    expect(response.status).toBe(200);
    const envelope = (await response.json()) as { readonly ok: true; readonly data: ReconcileDriftBody };
    expect(envelope.ok).toBe(true);
    expect(envelope.data).toMatchObject({ drift: 0, ledgerBalanceDriftCents: 0, negativeUserAvailable: [], escrowMismatches: [], findings: [] });
  });

  it("reports the ledger's own drift as a named finding, computed fresh on every call", async () => {
    signedInAs("u_op");
    const post: MoneyTransactionInput = {
      kind: "deposit",
      stateOfEntry: "NJ",
      entries: [
        { accountId: accountIdFor("fbo_pool"), direction: "debit", amountCents: 40_00 },
        { accountId: accountIdFor("user_available", "u1"), direction: "credit", amountCents: 40_00 },
      ],
      auditEvent: { eventType: "deposit_completed", actorId: "u1", actorType: "user", leagueId: null, payload: { amountCents: 40_00 } },
    };
    let nextId = 0;
    await db.transaction((tx) =>
      postMoneyTransaction(tx, post, { audit: getAuditLogger(), clock: { now: () => "2026-09-01T00:00:00.000Z" }, newId: () => `r_${(nextId += 1)}` }),
    );

    const response = await reconcile();
    const envelope = (await response.json()) as { readonly ok: true; readonly data: ReconcileDriftBody };
    expect(envelope.data.ledgerFboPoolCents).toBe(40_00);
    expect(envelope.data.providerPooledBalanceCents).toBe(0);
    expect(envelope.data.drift).toBe(40_00);
    expect(envelope.data.findings).toEqual([{ code: "bank_drift", message: "The ledger's pooled balance disagrees with the bank by $40.00." }]);
  });
});
