import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { drafts, leagues, seatHolds, teams, users } from "@/db/schema";
import { SEAT_HOLD, SEAT_HOLD_REFUSALS } from "@/matchmaking/seat-hold";
import { joinPublicLeague, returnFromSignIn } from "./join";
import { claimSeatHold, liveHoldsFor } from "./seat-hold";

const db = createTestDb();
const NOW = "2026-09-01T12:00:00.000Z";

function plusMinutes(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}

async function seedLeague(id: string, teamCount = 12): Promise<void> {
  await db.insert(leagues).values({ id, name: id, format: "snake", teamCount, commissionerUserId: null, isPublicMatchmade: true, houseRung: "open_12" });
  await db.insert(drafts).values({ id: `${id}_draft`, leagueId: id, format: "snake", status: "scheduled", kickoffAt: new Date("2026-09-10T17:00:00.000Z"), startTrigger: "scheduled" });
}

/** Seats `count` managers in `leagueId`, filling it partway (or all the way). */
async function fillLeague(leagueId: string, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    const userId = `${leagueId}_seat_${i}`;
    await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: `Seat ${i}` }).onConflictDoNothing();
    await db.insert(teams).values({ id: `${leagueId}_t${i}`, leagueId, userId, name: `Team ${i}` });
  }
}

async function seedUser(userId: string): Promise<void> {
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: userId }).onConflictDoNothing();
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("claimSeatHold", () => {
  it("holds a seat for a visitor who is not signed in yet, keyed by a token and nothing else", async () => {
    await seedLeague("lg_claim");
    const held = await claimSeatHold(db, { leagueId: "lg_claim", token: "hold_abc", now: NOW });
    expect(held).toMatchObject({ ok: true, expiresAt: plusMinutes(NOW, SEAT_HOLD.minutes) });

    const [row] = await db.select().from(seatHolds).where(eq(seatHolds.token, "hold_abc"));
    expect(row).toMatchObject({ leagueId: "lg_claim", consumedAt: null });
  });

  it("counts a live hold against capacity, so the twelfth and thirteenth visitor cannot both be told yes", async () => {
    await seedLeague("lg_capacity", 12);
    await fillLeague("lg_capacity", 11);
    expect(await claimSeatHold(db, { leagueId: "lg_capacity", token: "hold_a", now: NOW })).toMatchObject({ ok: true });
    expect(await claimSeatHold(db, { leagueId: "lg_capacity", token: "hold_b", now: NOW })).toEqual({
      ok: false,
      reason: SEAT_HOLD_REFUSALS.noSeat,
    });
  });

  it("refuses a private league — the same fact publicJoinPrecondition checks before a real join", async () => {
    await db.insert(leagues).values({ id: "lg_private_hold", name: "lg_private_hold", format: "snake", teamCount: 12, commissionerUserId: null, houseRung: "open_12", isPublicMatchmade: false });
    await db.insert(drafts).values({ id: "lg_private_hold_draft", leagueId: "lg_private_hold", format: "snake", status: "scheduled", kickoffAt: new Date("2026-09-10T17:00:00.000Z"), startTrigger: "scheduled" });
    expect(await claimSeatHold(db, { leagueId: "lg_private_hold", token: "hold_private", now: NOW })).toEqual({
      ok: false,
      reason: SEAT_HOLD_REFUSALS.noSeat,
    });
  });

  it("refuses a league whose draft has already started — a hold on it could never be redeemed", async () => {
    await seedLeague("lg_started_hold");
    await db.update(drafts).set({ status: "in_progress" }).where(eq(drafts.leagueId, "lg_started_hold"));
    expect(await claimSeatHold(db, { leagueId: "lg_started_hold", token: "hold_started", now: NOW })).toEqual({
      ok: false,
      reason: SEAT_HOLD_REFUSALS.noSeat,
    });
  });

  it("stops counting a hold the moment it expires, with no job to run and nothing to clean up", async () => {
    await seedLeague("lg_expiry");
    await claimSeatHold(db, { leagueId: "lg_expiry", token: "hold_a", now: NOW });
    expect(await liveHoldsFor(db, "lg_expiry", NOW)).toBe(1);
    expect(await liveHoldsFor(db, "lg_expiry", plusMinutes(NOW, SEAT_HOLD.minutes + 1))).toBe(0);
  });

  it("writes nothing at all on every refusal path", async () => {
    await seedLeague("lg_refusal_full", 1);
    await fillLeague("lg_refusal_full", 1);
    await seedLeague("lg_refusal_spent");
    await claimSeatHold(db, { leagueId: "lg_refusal_spent", token: "hold_spent", now: NOW });
    await seedUser("u_spender");
    await joinPublicLeague({ db, newId: () => "team_spender", clock: { now: () => NOW } }, { leagueId: "lg_refusal_spent", userId: "u_spender", holdToken: "hold_spent" });

    const before = await db.select().from(seatHolds);

    // A full league refuses a new hold outright.
    expect(await claimSeatHold(db, { leagueId: "lg_refusal_full", token: "hold_never", now: NOW })).toEqual({
      ok: false,
      reason: SEAT_HOLD_REFUSALS.noSeat,
    });
    // A token that already seated somebody cannot be redeemed a second time, and the attempt
    // writes nothing new to `seat_holds` (the row it touches is already exactly what it was).
    await seedUser("u_second");
    expect(
      await joinPublicLeague({ db, newId: () => "team_second", clock: { now: () => NOW } }, { leagueId: "lg_refusal_spent", userId: "u_second", holdToken: "hold_spent" }),
    ).toMatchObject({ ok: false, reason: SEAT_HOLD_REFUSALS.spent });
    // A garbage token that was never claimed at all is silently treated as no hold, never a write
    // — the league here is genuinely full of real members, so the refusal is the ordinary one.
    await seedLeague("lg_refusal_garbage");
    await fillLeague("lg_refusal_garbage", 12);
    await seedUser("u_garbage");
    expect(
      await joinPublicLeague({ db, newId: () => "team_garbage", clock: { now: () => NOW } }, { leagueId: "lg_refusal_garbage", userId: "u_garbage", holdToken: "hold_never_claimed" }),
    ).toMatchObject({ ok: false, status: 409 });

    expect(await db.select().from(seatHolds)).toEqual(before);
  });
});

describe("the race: a live hold beats a signed-in stranger to the last seat", () => {
  it("gives the seat to the holder and refuses the racer, and says so in words the racer can act on", async () => {
    await seedLeague("lg_race", 12);
    await fillLeague("lg_race", 11);
    await claimSeatHold(db, { leagueId: "lg_race", token: "hold_a", now: NOW });
    await seedUser("u_bob");
    await seedUser("u_alice");

    const loser = await joinPublicLeague({ db, newId: () => "team_bob", clock: { now: () => NOW } }, { leagueId: "lg_race", userId: "u_bob", holdToken: null });
    expect(loser).toMatchObject({ ok: false, status: 409, reason: SEAT_HOLD_REFUSALS.taken });

    const winner = await joinPublicLeague({ db, newId: () => "team_alice", clock: { now: () => NOW } }, { leagueId: "lg_race", userId: "u_alice", holdToken: "hold_a" });
    expect(winner).toMatchObject({ ok: true });
  });

  it("consumes the hold on the join, so one token cannot seat two people", async () => {
    await seedLeague("lg_consume", 12);
    await seedUser("u_alice2");
    await seedUser("u_carol");
    await claimSeatHold(db, { leagueId: "lg_consume", token: "hold_a", now: NOW });
    await joinPublicLeague({ db, newId: () => "team_alice2", clock: { now: () => NOW } }, { leagueId: "lg_consume", userId: "u_alice2", holdToken: "hold_a" });

    const second = await joinPublicLeague({ db, newId: () => "team_carol", clock: { now: () => NOW } }, { leagueId: "lg_consume", userId: "u_carol", holdToken: "hold_a" });
    expect(second).toMatchObject({ ok: false, status: 409, reason: SEAT_HOLD_REFUSALS.spent });
  });
});

// "The return": the moment nobody designed until F4 (Task 6 Step 4's fourth screen).
describe("returnFromSignIn — the return (Task 6 Step 4, F4)", () => {
  it("seats the visitor who comes back from sign in still holding a live token", async () => {
    await seedLeague("lg_return_live");
    await seedUser("u_alice3");
    await claimSeatHold(db, { leagueId: "lg_return_live", token: "hold_a", now: NOW });

    const result = await returnFromSignIn(db, { leagueId: "lg_return_live", userId: "u_alice3", holdToken: "hold_a", now: NOW });
    expect(result).toMatchObject({ ok: true, seated: true, justSeated: true, expiredHold: false });
  });

  it("still seats somebody whose hold expired while a seat is open, and says the hold ran out", async () => {
    await seedLeague("lg_return_expired");
    await seedUser("u_alice4");
    await claimSeatHold(db, { leagueId: "lg_return_expired", token: "hold_a", now: NOW });
    const late = plusMinutes(NOW, SEAT_HOLD.minutes + 2);

    const result = await returnFromSignIn(db, { leagueId: "lg_return_expired", userId: "u_alice4", holdToken: "hold_a", now: late });
    expect(result).toMatchObject({ ok: true, seated: true, justSeated: false, expiredHold: true });
  });

  it("shows the race loser the taken panel rather than a refusal code", async () => {
    await seedLeague("lg_return_taken", 12);
    await fillLeague("lg_return_taken", 12);
    await seedUser("u_alice5");

    expect(await returnFromSignIn(db, { leagueId: "lg_return_taken", userId: "u_alice5", holdToken: "hold_a", now: NOW })).toEqual({
      ok: false,
      reason: SEAT_HOLD_REFUSALS.taken,
    });
  });

  // A visitor who arrives with a session and NO cookie at all is treated on the same predicate
  // as an expired hold: what decides is whether the room has room, never whether a receipt exists.
  it("seats a visitor with no hold cookie at all, exactly as it would seat any ordinary walk in", async () => {
    await seedLeague("lg_return_no_cookie");
    await seedUser("u_alice6");

    const result = await returnFromSignIn(db, { leagueId: "lg_return_no_cookie", userId: "u_alice6", holdToken: null, now: NOW });
    expect(result).toMatchObject({ ok: true, seated: true, justSeated: false, expiredHold: false });
  });
});
