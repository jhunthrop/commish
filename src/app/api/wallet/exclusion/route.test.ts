import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
  requireAdmin: vi.fn(),
}));

import { eq } from "drizzle-orm";
import { auditEvents, users } from "@/db/schema";
import { createTestDb } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import { getCurrentUser, requireAdmin } from "@/lib/auth/current-user";
import { MONEY_CONFIG } from "@/money/config";
import { resetExclusionRateLimit } from "../_shared";
import { DELETE, GET, POST } from "./route";

const db = createTestDb();

const memberRow = (id: string) => ({
  id,
  email: `${id}@test.local`,
  displayName: id,
  experienceTier: "beginner" as const,
  avatarUrl: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  isAdmin: false,
});

const signedInAs = (id: string | null) => {
  vi.mocked(getCurrentUser).mockResolvedValue(id === null ? null : memberRow(id));
};

const operatorSignedInAs = (id: string | null) => {
  if (id === null) {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("Not authenticated."));
    return;
  }
  if (id === "u_plain") {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("Not an operator."));
    return;
  }
  vi.mocked(requireAdmin).mockResolvedValue({ ...memberRow(id), isAdmin: true });
};

async function seedUser(id: string): Promise<void> {
  await db.insert(users).values({ id, email: `${id}@test.local`, displayName: id });
}

function post() {
  return POST(new Request("http://test/api/wallet/exclusion", { method: "POST" }));
}

function get(query: string) {
  return GET(new Request(`http://test/api/wallet/exclusion${query}`));
}

function del(body: unknown) {
  return DELETE(
    new Request("http://test/api/wallet/exclusion", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(async () => {
  await truncateAll(db);
  vi.mocked(getCurrentUser).mockReset();
  vi.mocked(requireAdmin).mockReset();
  resetExclusionRateLimit();
});

describe("POST /api/wallet/exclusion", () => {
  it("answers 401 to a caller with no session", async () => {
    signedInAs(null);
    const res = await post();
    expect(res.status).toBe(401);
  });

  it("stamps self_excluded_at for the caller, answers it back, and audits self_exclusion_set", async () => {
    signedInAs("u1");
    await seedUser("u1");
    const res = await post();
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { data: { selfExcludedAt: string } };
    expect(payload.data.selfExcludedAt).toMatch(/\S/);
    const [row] = await db.select({ selfExcludedAt: users.selfExcludedAt }).from(users).where(eq(users.id, "u1"));
    expect(row?.selfExcludedAt).not.toBeNull();

    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "self_exclusion_set"));
    expect(event).toMatchObject({ chainScope: "platform", actorId: "u1", actorType: "user", leagueId: null, payload: {} });
  });

  it("is idempotent: a second call answers the SAME stamp, never a fresh one", async () => {
    signedInAs("u1");
    await seedUser("u1");
    const first = ((await (await post()).json()) as { data: { selfExcludedAt: string } }).data.selfExcludedAt;
    const second = ((await (await post()).json()) as { data: { selfExcludedAt: string } }).data.selfExcludedAt;
    expect(second).toBe(first);
  });

  it("answers 429 past the per-user ceiling", async () => {
    signedInAs("u1");
    await seedUser("u1");
    for (let i = 0; i < MONEY_CONFIG.exclusion.rateLimit.maxRequests; i++) {
      expect((await post()).status).toBe(200);
    }
    expect((await post()).status).toBe(429);
  });
});

describe("GET /api/wallet/exclusion", () => {
  it("answers 401 to a caller with no session at all", async () => {
    operatorSignedInAs(null);
    const res = await get("?userId=u1");
    expect(res.status).toBe(401);
  });

  it("answers 404, never 403, to a signed-in non-operator", async () => {
    operatorSignedInAs("u_plain");
    const res = await get("?userId=u1");
    expect(res.status).toBe(404);
  });

  it("answers 400 for a missing userId", async () => {
    operatorSignedInAs("u_op");
    const res = await get("");
    expect(res.status).toBe(400);
  });

  it("previews the member's own name and exclusion date for an operator", async () => {
    operatorSignedInAs("u_op");
    await seedUser("u_op");
    await seedUser("u1");
    signedInAs("u1");
    await post(); // u1 self-excludes first

    const res = await get("?userId=u1");
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { data: { userId: string; displayName: string; selfExcludedAt: string } };
    expect(payload.data.userId).toBe("u1");
    expect(payload.data.displayName).toBe("u1");
    expect(payload.data.selfExcludedAt).toMatch(/\S/);
  });

  it("answers 404 for a member who is not excluded — nothing to preview", async () => {
    operatorSignedInAs("u_op");
    await seedUser("u_op");
    await seedUser("u1");
    const res = await get("?userId=u1");
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/wallet/exclusion", () => {
  it("answers 401 to a caller with no session at all", async () => {
    operatorSignedInAs(null);
    const res = await del({ userId: "u1" });
    expect(res.status).toBe(401);
  });

  it("answers 404, never 403, to a signed-in non-operator", async () => {
    operatorSignedInAs("u_plain");
    const res = await del({ userId: "u1" });
    expect(res.status).toBe(404);
  });

  it("answers 400 to a body carrying keys the boundary does not know", async () => {
    operatorSignedInAs("u_op");
    const res = await del({ userId: "u1", surprise: true });
    expect(res.status).toBe(400);
  });

  it("clears the stamp for an operator, audits self_exclusion_cleared, and answers 200", async () => {
    operatorSignedInAs("u_op");
    await seedUser("u_op");
    await seedUser("u1");
    signedInAs("u1");
    await post(); // u1 self-excludes first

    const res = await del({ userId: "u1" });
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { data: { userId: string } };
    expect(payload.data.userId).toBe("u1");

    const [row] = await db.select({ selfExcludedAt: users.selfExcludedAt }).from(users).where(eq(users.id, "u1"));
    expect(row?.selfExcludedAt).toBeNull();

    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "self_exclusion_cleared"));
    expect(event).toMatchObject({ actorId: "u_op", actorType: "user", leagueId: null });
    expect(event!.payload).toEqual({ subjectUserId: "u1" });
  });

  it("answers 404 for a member who is not excluded — nothing to clear", async () => {
    operatorSignedInAs("u_op");
    await seedUser("u_op");
    await seedUser("u1");
    const res = await del({ userId: "u1" });
    expect(res.status).toBe(404);
  });
});
