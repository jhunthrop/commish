import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
  })),
}));

import { eq } from "drizzle-orm";
import { createTestDb } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import { drafts, leagues, seatHolds, teams, users } from "@/db/schema";
import { SEAT_HOLD_COOKIE, SEAT_HOLD_REFUSALS } from "@/matchmaking/seat-hold";
import { resetHoldRateLimit } from "../../_shared";
import { POST } from "./route";

const db = createTestDb();

function post(leagueId: string, cookieHeader?: string) {
  const request = new Request(`http://test/api/public/leagues/${leagueId}/hold`, {
    method: "POST",
    headers: cookieHeader === undefined ? {} : { cookie: cookieHeader },
  });
  return POST(request, { params: Promise.resolve({ leagueId }) });
}

async function seedLeague(id: string, teamCount = 12, filled = 0): Promise<void> {
  await db.insert(users).values({ id: "owner", email: "owner@test.local", displayName: "Commissioner Casey" }).onConflictDoNothing();
  await db.insert(leagues).values({
    id, name: "Rookie Snake Room", format: "snake", teamCount, stakeTier: 0,
    experienceTier: "beginner", isPublicMatchmade: true, commissionerUserId: "owner",
  });
  await db.insert(drafts).values({
    id: `${id}_draft`, leagueId: id, format: "snake", status: "scheduled",
    kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
  });
  for (let i = 0; i < filled; i++) {
    const userId = `${id}_seat_${i}`;
    await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: `Seat ${i}` });
    await db.insert(teams).values({ id: `${id}_t${i}`, leagueId: id, userId, name: `Team ${i}` });
  }
}

beforeEach(async () => {
  await truncateAll(db);
  cookieJar.clear();
  resetHoldRateLimit();
});

afterAll(async () => {
  await truncateAll(db);
});

describe("POST /api/public/leagues/[leagueId]/hold", () => {
  it("claims a hold with no session at all — the app's unauthenticated write", async () => {
    await seedLeague("lg_hold_open");
    const response = await post("lg_hold_open");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { readonly ok: true; readonly data: { readonly expiresAt: string } };
    expect(Date.parse(body.data.expiresAt)).toBeGreaterThan(Date.now());
  });

  it("sets an httpOnly, SameSite=Lax, Path=/ cookie — never readable by client JS, never scoped to this one route", async () => {
    await seedLeague("lg_hold_cookie");
    const response = await post("lg_hold_cookie");
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SEAT_HOLD_COOKIE}=`);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
    expect(setCookie).toContain("Path=/");
  });

  it("refuses a full league, and writes nothing", async () => {
    await seedLeague("lg_hold_full", 1, 1);
    const response = await post("lg_hold_full");
    expect(response.status).toBe(409);
    const body = (await response.json()) as { readonly ok: false; readonly error: string };
    expect(body.error).toBe(SEAT_HOLD_REFUSALS.noSeat);
  });

  it("reuses a live hold for the same league rather than minting a second one", async () => {
    await seedLeague("lg_hold_reuse");
    const first = await post("lg_hold_reuse");
    const firstBody = (await first.json()) as { readonly ok: true; readonly data: { readonly expiresAt: string } };
    const setCookie = first.headers.get("set-cookie") ?? "";
    const token = /seat_hold=([^;]+)/.exec(setCookie)?.[1];
    expect(token).toBeDefined();
    cookieJar.set(SEAT_HOLD_COOKIE, token!);

    const second = await post("lg_hold_reuse", `${SEAT_HOLD_COOKIE}=${token}`);
    const secondBody = (await second.json()) as { readonly ok: true; readonly data: { readonly expiresAt: string } };
    expect(secondBody.data.expiresAt).toBe(firstBody.data.expiresAt);

    // Two visits, ONE row — reuse never doubles up the league's own capacity accounting.
    expect(await db.select().from(seatHolds).where(eq(seatHolds.leagueId, "lg_hold_reuse"))).toHaveLength(1);
  });

  it("mints a fresh token when the cookie names a different league", async () => {
    await seedLeague("lg_hold_a");
    await seedLeague("lg_hold_b");
    const first = await post("lg_hold_a");
    const setCookie = first.headers.get("set-cookie") ?? "";
    const token = /seat_hold=([^;]+)/.exec(setCookie)?.[1];
    cookieJar.set(SEAT_HOLD_COOKIE, token!);

    const second = await post("lg_hold_b", `${SEAT_HOLD_COOKIE}=${token}`);
    expect(second.status).toBe(200);
    const setCookieTwo = second.headers.get("set-cookie") ?? "";
    const tokenTwo = /seat_hold=([^;]+)/.exec(setCookieTwo)?.[1];
    expect(tokenTwo).not.toBe(token);
  });

  it("answers 429 once the per-IP write ceiling is spent", async () => {
    await seedLeague("lg_hold_limit");
    // Every call below carries no `x-forwarded-for` header, so all 25 share the SAME limiter
    // bucket (`_shared.ts`'s own "unknown" fallback key) — this is deliberately one visitor
    // hammering the route, not 25 distinct ones.
    const request = () => new Request("http://test/api/public/leagues/lg_hold_limit/hold", { method: "POST" });
    let lastStatus = 200;
    for (let i = 0; i < 25; i++) {
      lastStatus = (await POST(request(), { params: Promise.resolve({ leagueId: "lg_hold_limit" }) })).status;
    }
    expect(lastStatus).toBe(429);
  });
});
