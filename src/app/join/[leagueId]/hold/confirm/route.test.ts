import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { and, eq } from "drizzle-orm";

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

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));

import { createTestDb } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import { drafts, leagues, teams, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { ENFORCEMENT_REFUSALS } from "@/league-service/enforcement";
import { SEAT_HOLD_COOKIE, SEAT_HOLD_REFUSALS } from "@/matchmaking/seat-hold";
import { claimSeatHold } from "@/league-service/seat-hold";
import type { SeatConfirmBody } from "../contract";
import { POST } from "./route";

const db = createTestDb();

const signedInAs = (id: string | null) =>
  vi.mocked(getCurrentUser).mockResolvedValue(
    id === null
      ? null
      : { id, email: `${id}@test.local`, displayName: id, experienceTier: "beginner", avatarUrl: null, createdAt: "2026-09-01T00:00:00.000Z", isAdmin: false },
  );

function post(leagueId: string) {
  const request = new Request(`http://test/join/${leagueId}/hold/confirm`, { method: "POST" });
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
    await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: `Seat ${i}` }).onConflictDoNothing();
    await db.insert(teams).values({ id: `${id}_t${i}`, leagueId: id, userId, name: `Team ${i}` });
  }
}

async function seedUser(userId: string): Promise<void> {
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: userId }).onConflictDoNothing();
}

/** Gives `userId` `count` completed OTHER leagues, matching `join.test.ts`'s own helper. */
async function giveCompletedSeasons(userId: string, count: number): Promise<void> {
  await seedUser(userId);
  for (let i = 0; i < count; i++) {
    const leagueId = `${userId}_history_${i}`;
    await db.insert(leagues).values({
      id: leagueId, name: leagueId, format: "snake", teamCount: 1, commissionerUserId: userId, seasonCompletedAt: new Date("2025-01-01T00:00:00.000Z"),
    });
    await db.insert(teams).values({ id: `${leagueId}_team`, leagueId, userId, name: "Team" });
  }
}

async function teamRowsFor(leagueId: string, userId: string) {
  return db.select({ id: teams.id }).from(teams).where(and(eq(teams.leagueId, leagueId), eq(teams.userId, userId)));
}

beforeEach(async () => {
  await truncateAll(db);
  cookieJar.clear();
  vi.mocked(getCurrentUser).mockReset();
});

afterAll(async () => {
  await truncateAll(db);
});

/**
 * A1's own writer (2026-08-27 flow analysis, finding 1): everything the hold page's signed-in
 * render used to do at RENDER time now happens here, behind an explicit POST. `returnFromSignIn`
 * itself is untouched — this suite proves the ROUTE's own wiring (auth, the hold cookie, the
 * outcome-to-`SeatConfirmBody` mapping), not `returnFromSignIn`'s own three outcomes, which
 * `src/league-service/seat-hold.test.ts` already covers exhaustively.
 */
describe("POST /join/[leagueId]/hold/confirm", () => {
  it("answers 401 JSON when nobody is signed in, and writes nothing", async () => {
    await seedLeague("lg1");
    signedInAs(null);
    const response = await post("lg1");
    expect(response.status).toBe(401);
    expect((await db.select({ id: teams.id }).from(teams)).length).toBe(0);
  });

  it("seats a fresh member with no hold cookie at all, exactly like an ordinary walk-in", async () => {
    await seedLeague("lg2");
    await seedUser("u1");
    signedInAs("u1");

    const response = await post("lg2");
    const body = (await response.json()) as { readonly ok: true; readonly data: SeatConfirmBody };
    expect(body).toEqual({ ok: true, data: { outcome: "seated", leagueId: "lg2", holdExpired: false, reason: null } });

    const rows = await teamRowsFor("lg2", "u1");
    expect(rows).toHaveLength(1);
  });

  it("is idempotent for a caller who already has a seat — a second confirm writes no second row", async () => {
    await seedLeague("lg3");
    await seedUser("u1");
    signedInAs("u1");

    await post("lg3");
    const second = await post("lg3");
    const body = (await second.json()) as { readonly ok: true; readonly data: SeatConfirmBody };
    expect(body.data.outcome).toBe("seated");

    const rows = await teamRowsFor("lg3", "u1");
    expect(rows).toHaveLength(1);
  });

  it("redeems a live hold token from the cookie and reports it as consumed, not expired", async () => {
    await seedLeague("lg4");
    await seedUser("u1");
    // Claimed at the REAL now, for the same reason the expired case below seeds a far-past one:
    // the route reads the real `Date` for its own `now`, so a hold is live here only if it was
    // claimed against the same clock. This line used to pass a hardcoded "2026-09-01T12:00:00Z",
    // which was inside `SEAT_HOLD.minutes` of the wall clock on the day it was written and has
    // been outside it every day since — the test asserted "live" while seeding a hold that had
    // expired days earlier, so it reported `holdExpired: true` and failed on a calendar rather
    // than on a change to the route.
    await claimSeatHold(db, { leagueId: "lg4", token: "hold_a", now: new Date().toISOString() });
    cookieJar.set(SEAT_HOLD_COOKIE, "hold_a");
    signedInAs("u1");

    const response = await post("lg4");
    const body = (await response.json()) as { readonly ok: true; readonly data: SeatConfirmBody };
    expect(body.data).toEqual({ outcome: "seated", leagueId: "lg4", holdExpired: false, reason: null });
  });

  // The expired-hold path (Task 6 Step 4, outcome b, Task 9 Step 2b): a hold that ran out while a
  // seat stayed open still seats the caller, and says so via `holdExpired`, unchanged from the
  // render-time write this route replaces.
  it("still seats a caller whose hold had already expired, and reports holdExpired", async () => {
    await seedLeague("lg5");
    await seedUser("u1");
    // Claimed long enough before the real wall clock that the hold's own window has certainly
    // run out by the time this request lands — the route reads the real `Date` for `now`, so the
    // fixture ages the SEEDED hold rather than faking the clock alongside real database I/O.
    await claimSeatHold(db, { leagueId: "lg5", token: "hold_b", now: "2020-01-01T00:00:00.000Z" });
    cookieJar.set(SEAT_HOLD_COOKIE, "hold_b");
    signedInAs("u1");

    const response = await post("lg5");
    const body = (await response.json()) as { readonly ok: true; readonly data: SeatConfirmBody };
    expect(body.data).toEqual({ outcome: "seated", leagueId: "lg5", holdExpired: true, reason: null });
  });

  it("answers seat_taken for a race loser, and writes nothing", async () => {
    await seedLeague("lg6", 1, 1);
    await seedUser("u1");
    signedInAs("u1");

    const response = await post("lg6");
    const body = (await response.json()) as { readonly ok: true; readonly data: SeatConfirmBody };
    expect(body.data).toEqual({ outcome: "seat_taken", leagueId: "lg6", holdExpired: false, reason: SEAT_HOLD_REFUSALS.taken });
    expect((await teamRowsFor("lg6", "u1")).length).toBe(0);
  });

  it("keeps the tier refusal distinct, naming the real reason", async () => {
    await seedLeague("lg7", 12, 0);
    await giveCompletedSeasons("u_vet", INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
    signedInAs("u_vet");

    const response = await post("lg7");
    const body = (await response.json()) as { readonly ok: true; readonly data: SeatConfirmBody };
    expect(body.data).toEqual({ outcome: "tier_blocked", leagueId: "lg7", holdExpired: false, reason: ENFORCEMENT_REFUSALS.join });
    expect((await teamRowsFor("lg7", "u_vet")).length).toBe(0);
  });
});
