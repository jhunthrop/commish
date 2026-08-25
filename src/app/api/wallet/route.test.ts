import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
}));

import { users } from "@/db/schema";
import { createTestDb, truncateAll, truncateMoneyTables } from "@/db/test-db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { postMoneyTransaction, type MoneyTransactionInput } from "@/money-service/post";
import { getAuditLogger } from "@/integrity-service/audit-logger";
import { accountIdFor } from "@/money/accounts";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { WalletBody } from "@/account-room/contract";
import { resetWalletRateLimit } from "./_shared";
import { GET } from "./route";

const db = createTestDb();

const currentUser = (id: string) => ({
  id,
  email: `${id}@test.local`,
  displayName: id,
  experienceTier: "beginner" as const,
  avatarUrl: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  isAdmin: false,
});

const signedInAs = (id: string | null) => {
  vi.mocked(getCurrentUser).mockResolvedValue(id === null ? null : currentUser(id));
};

async function seedUser(id: string): Promise<void> {
  await db.insert(users).values({ id, email: `${id}@test.local`, displayName: id });
}

const clock = { now: () => "2026-09-01T00:00:00.000Z" };
let nextId = 0;
const newId = () => `r_${(nextId += 1)}`;

const deposit = (userId: string, amountCents: number): MoneyTransactionInput => ({
  kind: "deposit",
  stateOfEntry: "TN",
  entries: [
    { accountId: accountIdFor("fbo_pool"), direction: "debit", amountCents },
    { accountId: accountIdFor("user_available", userId), direction: "credit", amountCents },
  ],
  auditEvent: { eventType: "deposit_completed", actorId: userId, actorType: "user", leagueId: null, payload: { amountCents } },
});

function get(): Request {
  return new Request("http://test/api/wallet");
}

beforeEach(async () => {
  await truncateAll(db);
  await truncateMoneyTables(db);
  vi.mocked(getCurrentUser).mockReset();
  nextId = 0;
  resetWalletRateLimit();
});

describe("GET /api/wallet", () => {
  it("401s when not signed in", async () => {
    signedInAs(null);
    expect((await GET(get())).status).toBe(401);
  });

  it("answers the caller's own walletSummary, verbatim, through the envelope", async () => {
    await seedUser("u1");
    await seedUser("u2");
    signedInAs("u1");
    await db.transaction((tx) => postMoneyTransaction(tx, deposit("u1", 50_00), { audit: getAuditLogger(), clock, newId }));
    await db.transaction((tx) => postMoneyTransaction(tx, deposit("u2", 999_00), { audit: getAuditLogger(), clock, newId }));

    const response = await GET(get());
    expect(response.status).toBe(200);
    const body = (await response.json()) as ApiEnvelope<WalletBody>;
    if (!body.ok) throw new Error("expected ok");
    // Only u1's own figures — never u2's, proving this is the caller's own read, not a shared one.
    expect(body.data.summary).toEqual({ availableCents: 50_00, escrowCents: 0, heldCents: 0, owedCents: 0 });
  });

  it("answers all zeros for a signed-in member the book has never seen", async () => {
    await seedUser("u_fresh");
    signedInAs("u_fresh");

    const response = await GET(get());
    const body = (await response.json()) as ApiEnvelope<WalletBody>;
    if (!body.ok) throw new Error("expected ok");
    expect(body.data.summary).toEqual({ availableCents: 0, escrowCents: 0, heldCents: 0, owedCents: 0 });
  });

  it("429s past the rate limit", async () => {
    await seedUser("u_rate");
    signedInAs("u_rate");
    for (let i = 0; i < 30; i += 1) expect((await GET(get())).status).toBe(200);
    expect((await GET(get())).status).toBe(429);
  });
});
