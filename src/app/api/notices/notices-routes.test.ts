import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

// The route handlers use the process-wide getDb()/getPublisher(); point them at the test
// infrastructure before any module is imported. vi.hoisted runs before the import graph —
// the same seam `src/app/api/preferences/route.test.ts` and `events/route.test.ts` use.
vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
}));

import type { NoticeView } from "@/account-room/contract";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { memberNotices, users } from "@/db/schema";
import type { ApiEnvelope } from "@/lib/api/respond";
import { getCurrentUser } from "@/lib/auth/current-user";
import { NOTICES_RATE_LIMIT, resetNoticesRateLimit } from "./_shared";
import { GET } from "./route";
import { POST } from "./read/route";
import { GET as STREAM } from "./stream/route";

const db = createTestDb();

const signedInAs = (id: string | null) =>
  vi.mocked(getCurrentUser).mockResolvedValue(
    id === null
      ? null
      : { id, email: `${id}@test.local`, displayName: id, experienceTier: "beginner", avatarUrl: null, createdAt: "2026-09-01T00:00:00.000Z", isAdmin: false },
  );

function get(): Request {
  return new Request("http://test/api/notices");
}

function post(body: unknown): Request {
  return new Request("http://test/api/notices/read", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function streamRequest(): Request {
  return new Request("http://test/api/notices/stream");
}

/** Seeds one `member_notices` row directly — the routes' own read/write paths are what's under test. */
async function seedNotice(id: string, userId: string, createdAt: string): Promise<void> {
  await db.insert(memberNotices).values({
    id,
    userId,
    leagueId: null,
    noticeType: "review_removed",
    title: "Your review was removed",
    body: "An operator removed your review.",
    context: { reason: "off topic" },
    auditEventId: null,
    createdAt: new Date(createdAt),
    readAt: null,
  });
}

beforeEach(async () => {
  await truncateAll(db);
  vi.mocked(getCurrentUser).mockReset();
  resetNoticesRateLimit();
  await db.insert(users).values([
    { id: "user_bob", email: "user_bob@test.local", displayName: "Bob" },
    { id: "user_alice", email: "user_alice@test.local", displayName: "Alice" },
  ]);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("GET /api/notices", () => {
  it("returns only the caller's notices, newest first", async () => {
    await seedNotice("notice_1", "user_bob", "2026-08-20T18:00:00.000Z");
    await seedNotice("notice_2", "user_bob", "2026-08-20T19:00:00.000Z");
    await seedNotice("notice_3", "user_alice", "2026-08-20T19:30:00.000Z");
    signedInAs("user_bob");

    const response = await GET(get());
    expect(response.status).toBe(200);
    const body = (await response.json()) as ApiEnvelope<{ notices: readonly NoticeView[]; unreadCount: number }>;
    if (!body.ok) throw new Error("expected success");
    expect(body.data.notices.map((n) => n.id)).toEqual(["notice_2", "notice_1"]);
    expect(body.data.unreadCount).toBe(2);
  });

  it("answers 401 with JSON rather than redirecting", async () => {
    signedInAs(null);
    const response = await GET(get());
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ ok: false, error: "Not signed in." });
  });

  it("rate-limits notices reads the same way every other read in this codebase is limited", async () => {
    signedInAs("user_bob");
    for (let i = 0; i < NOTICES_RATE_LIMIT + 1; i += 1) await GET(get());
    expect((await GET(get())).status).toBe(429);
  });

  it("keys that ceiling per caller: a different user spends its own budget", async () => {
    signedInAs("user_bob");
    for (let i = 0; i < NOTICES_RATE_LIMIT + 1; i += 1) await GET(get());
    expect((await GET(get())).status).toBe(429);

    signedInAs("user_alice");
    expect((await GET(get())).status).toBe(200);
  });
});

describe("POST /api/notices/read", () => {
  it("marks only the caller's own notices read, and answers what it stamped", async () => {
    await seedNotice("notice_1", "user_bob", "2026-08-20T18:00:00.000Z");
    await seedNotice("someone_elses", "user_alice", "2026-08-20T18:00:00.000Z");
    signedInAs("user_bob");

    const response = await POST(post({ noticeIds: ["notice_1", "someone_elses"] }));
    expect(await response.json()).toEqual({ ok: true, data: { stamped: 1 } });
  });

  it("rejects a body that is not a list of ids, naming the field", async () => {
    signedInAs("user_bob");
    const response = await POST(post({ noticeIds: "notice_1" }));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/noticeIds/);
  });

  it("answers 401 with JSON rather than redirecting", async () => {
    signedInAs(null);
    const response = await POST(post({ noticeIds: ["notice_1"] }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "Not signed in." });
  });

  it("shares its rate ceiling with GET /api/notices, not a second budget", async () => {
    signedInAs("user_bob");
    for (let i = 0; i < NOTICES_RATE_LIMIT + 1; i += 1) await GET(get());
    const response = await POST(post({ noticeIds: ["notice_1"] }));
    expect(response.status).toBe(429);
  });
});

describe("GET /api/notices/stream", () => {
  it("answers 401 with JSON rather than redirecting", async () => {
    signedInAs(null);
    const response = await STREAM(streamRequest());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "Not signed in." });
  });

  it("opens a live stream on the caller's own user id", async () => {
    signedInAs("user_bob");
    const response = await STREAM(streamRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    await response.body?.cancel();
  });
});
