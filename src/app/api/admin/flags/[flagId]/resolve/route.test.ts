import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({
  requireAdmin: vi.fn(),
}));

import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { integrityFlags, memberNotices, reviews, users } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/current-user";
import { raiseFlag } from "@/integrity-service/flags";
import { createAuditLogger } from "@/integrity-service/audit-logger";
import { POST } from "./route";

const db = createTestDb();
let flagSeq = 0;
const logger = createAuditLogger({ newId: () => `evt_${(flagSeq += 1)}` });

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

function post(flagId: string, body: unknown) {
  const request = new Request(`http://test/api/admin/flags/${flagId}/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ flagId }) });
}

async function openReviewFlag(id: string): Promise<{ readonly flagId: string }> {
  flagSeq += 1;
  const reviewId = `r_${id}`;
  await db.insert(users).values({ id: `author_${id}`, email: `author_${id}@test.local`, displayName: `author_${id}` });
  await db.insert(reviews).values({ id: reviewId, userId: `author_${id}`, rating: 3, body: `review ${id}` });
  const flag = await db.transaction((tx) =>
    raiseFlag(tx, {
      flagType: "review_report",
      subjectId: reviewId,
      leagueId: null,
      evidence: {},
      raisedByUserId: null,
      occurredAt: "2026-09-01T00:00:00.000Z",
      newId: () => `flag_${id}`,
      audit: logger,
    }),
  );
  return { flagId: flag.id };
}

beforeEach(async () => {
  await truncateAll(db);
  vi.mocked(requireAdmin).mockReset();
  flagSeq = 0;
});

afterAll(async () => {
  await truncateAll(db);
});

describe("POST /api/admin/flags/[flagId]/resolve", () => {
  it("answers 401 JSON when nobody is signed in", async () => {
    signedInAs(null);
    const response = await post("flag_x", { decision: "no_action", note: "n" });
    expect(response.status).toBe(401);
  });

  it("answers 404, never 403, for a signed-in non-operator", async () => {
    signedInAs("u_plain");
    const response = await post("flag_x", { decision: "no_action", note: "n" });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "Not found." });
  });

  it("answers 400 naming the field for a decision this plan does not implement, before resolveFlag ever runs", async () => {
    await db.insert(users).values({ id: "u_op", email: "u_op@test.local", displayName: "u_op", isAdmin: true });
    signedInAs("u_op");
    const { flagId } = await openReviewFlag("boundary");

    const response = await post(flagId, { decision: "trade_reversed", note: "n" });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("decision");
  });

  it("resolves a real flag, notices nobody for no_action, and answers ok with the decision", async () => {
    await db.insert(users).values({ id: "u_op", email: "u_op@test.local", displayName: "u_op", isAdmin: true });
    signedInAs("u_op");
    const { flagId } = await openReviewFlag("resolve1");

    const response = await post(flagId, { decision: "no_action", note: "Looked into it, nothing here." });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { flagId, decision: "no_action" } });

    const [row] = await db.select().from(integrityFlags).where(eq(integrityFlags.id, flagId));
    expect(row?.resolution).toBe("no_action");
    expect(await db.select().from(memberNotices)).toHaveLength(0);
  });

  it("answers 409 for a flag that is already resolved", async () => {
    await db.insert(users).values({ id: "u_op", email: "u_op@test.local", displayName: "u_op", isAdmin: true });
    signedInAs("u_op");
    const { flagId } = await openReviewFlag("resolve2");

    const first = await post(flagId, { decision: "no_action", note: "n" });
    expect(first.status).toBe(200);

    const second = await post(flagId, { decision: "no_action", note: "n" });
    expect(second.status).toBe(409);
  });

  it("answers 400 for a note past the shared cap, before resolveFlag ever runs", async () => {
    await db.insert(users).values({ id: "u_op", email: "u_op@test.local", displayName: "u_op", isAdmin: true });
    signedInAs("u_op");
    const { flagId } = await openReviewFlag("resolve3");

    const response = await post(flagId, { decision: "no_action", note: "x".repeat(1000) });
    expect(response.status).toBe(400);
  });

  it("answers 400 with PRODUCT copy for a content_removed note past 200 chars, driven through the real route (fix round 1, FIX 6)", async () => {
    // 201 chars: past `REVIEW_CONFIG.removalReason.maxLength` (200) but well under the general
    // `INTEGRITY_CONFIG.moderation.noteMaxLength` (500) `resolveFlagSchema` itself enforces at
    // the boundary — so this note passes `parseJson` and is refused by `resolveFlag`'s own
    // tighter, content_removed-specific check, and the client's counter (`ResolutionForm`'s
    // `maxLengthFor`) is what should have warned an operator before they ever got here.
    await db.insert(users).values({ id: "u_op", email: "u_op@test.local", displayName: "u_op", isAdmin: true });
    signedInAs("u_op");
    const { flagId } = await openReviewFlag("resolve4");

    const response = await post(flagId, { decision: "content_removed", note: "x".repeat(201) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "Notes on a removal are limited to 200 characters." });

    const [row] = await db.select({ resolvedAt: integrityFlags.resolvedAt }).from(integrityFlags).where(eq(integrityFlags.id, flagId));
    expect(row?.resolvedAt).toBeNull();
  });
});
