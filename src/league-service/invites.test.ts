import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import { leagueInvites, teams, users } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { LEAGUE_CONFIG } from "@/league";
import { createLeague } from "./creation";
import { acceptInvite, createInvite } from "./invites";

const db = createTestDb();
let nowIso = "2026-08-17T12:00:00.000Z";
const clock = { now: () => nowIso };
let nextId = 0;
const newId = () => `id_${++nextId}`;
const writeDeps = () => ({ db, clock, newId });
/** Fixed randomness makes the minted code reproducible. */
const inviteDeps = () => ({ db, clock, random: () => 0.5 });

/**
 * A `Db` whose `transaction(...)` rejects with the given error but whose reads still hit the
 * real database — the only way to reach `acceptInvite`'s catch block on purpose. The unique
 * index is a backstop against a race no test can schedule reliably, so the branch is proved
 * by handing it the error the driver would raise, not by trying to win a coin flip.
 */
function dbWhoseTransactionThrows(error: unknown): Db {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "transaction") return () => Promise.reject(error);
      return Reflect.get(target, prop, receiver);
    },
  }) as Db;
}

/** The shape `postgres-js` raises through Drizzle: the driver fields sit one level under `.cause`. */
const uniqueViolation = (constraint: string) =>
  Object.assign(new Error("duplicate key value violates unique constraint"), {
    cause: { code: "23505", constraint_name: constraint },
  });

async function league(teamCount = 4) {
  await db.insert(users).values(
    Array.from({ length: 6 }, (_, i) => ({ id: `u${i + 1}`, email: `u${i + 1}@test.local`, displayName: `Manager ${i + 1}` })),
  );
  const created = await createLeague(writeDeps(), {
    name: "Sunday Money", format: "snake", teamCount, scoringPreset: "ppr", auctionBudget: null,
    rosterSlots: STANDARD_ROSTER_SLOTS, commissionerUserId: "u1", teamName: "Commish",
  });
  if (!created.ok) throw new Error(created.reason);
  return created;
}

beforeEach(async () => {
  await truncateAll(db);
  nowIso = "2026-08-17T12:00:00.000Z";
  nextId = 0;
});

afterAll(async () => {
  await truncateAll(db);
});

describe("createInvite", () => {
  it("mints a code from the configured alphabet, with an expiry and a use cap", async () => {
    const created = await league();
    const invite = await createInvite(inviteDeps(), { leagueId: created.leagueId, createdByUserId: "u1", maxUses: 5 });
    expect(invite.ok).toBe(true);
    if (!invite.ok) return;
    expect(invite.code).toHaveLength(LEAGUE_CONFIG.invite.codeLength);
    expect([...invite.code].every((ch) => LEAGUE_CONFIG.invite.alphabet.includes(ch))).toBe(true);
    expect(invite.maxUses).toBe(5);
    expect(invite.expiresAt).toBe("2026-08-31T12:00:00.000Z");
  });

  it("defaults the use cap to the configured maximum", async () => {
    const created = await league();
    const invite = await createInvite(inviteDeps(), { leagueId: created.leagueId, createdByUserId: "u1" });
    if (!invite.ok) throw new Error(invite.reason);
    expect(invite.maxUses).toBe(LEAGUE_CONFIG.invite.maxUses);
  });

  it("retries past a code collision rather than failing", async () => {
    const created = await league();
    const first = await createInvite(inviteDeps(), { leagueId: created.leagueId, createdByUserId: "u1" });
    if (!first.ok) throw new Error(first.reason);
    // The same fixed randomness would mint the same code; the retry loop must find another.
    let call = 0;
    const second = await createInvite(
      { db, clock, random: () => (call++ < LEAGUE_CONFIG.invite.codeLength ? 0.5 : 0.9) },
      { leagueId: created.leagueId, createdByUserId: "u1" },
    );
    if (!second.ok) throw new Error(second.reason);
    expect(second.code).not.toBe(first.code);
    expect(await db.select().from(leagueInvites)).toHaveLength(2);
  });

  it("gives up in plain language when every attempt collides", async () => {
    const created = await league();
    const first = await createInvite(inviteDeps(), { leagueId: created.leagueId, createdByUserId: "u1" });
    if (!first.ok) throw new Error(first.reason);
    // Fixed randomness mints the one code that already exists, every attempt.
    expect(await createInvite(inviteDeps(), { leagueId: created.leagueId, createdByUserId: "u1" })).toEqual({
      ok: false, reason: "We couldn't create an invite just now. Please try again.",
    });
    expect(await db.select().from(leagueInvites)).toHaveLength(1);
  });
});

describe("acceptInvite", () => {
  it("creates a team for the caller and counts the use", async () => {
    const created = await league();
    const invite = await createInvite(inviteDeps(), { leagueId: created.leagueId, createdByUserId: "u1" });
    if (!invite.ok) throw new Error(invite.reason);

    const joined = await acceptInvite(writeDeps(), { code: invite.code, userId: "u2", teamName: "Iron Owls" });
    expect(joined).toMatchObject({ ok: true, leagueId: created.leagueId, alreadyMember: false });
    expect(await db.select().from(teams).where(eq(teams.leagueId, created.leagueId))).toHaveLength(2);
    const [row] = await db.select().from(leagueInvites).where(eq(leagueInvites.code, invite.code));
    expect(row!.uses).toBe(1);
  });

  it("is idempotent for somebody who already has a team, and spends no use", async () => {
    const created = await league();
    const invite = await createInvite(inviteDeps(), { leagueId: created.leagueId, createdByUserId: "u1" });
    if (!invite.ok) throw new Error(invite.reason);
    expect(await acceptInvite(writeDeps(), { code: invite.code, userId: "u1" })).toMatchObject({
      ok: true, teamId: created.teamId, alreadyMember: true,
    });
    const [row] = await db.select().from(leagueInvites).where(eq(leagueInvites.code, invite.code));
    expect(row!.uses).toBe(0);
  });

  it("is idempotent for a joiner who accepts the same link twice, and spends exactly one use", async () => {
    const created = await league();
    const invite = await createInvite(inviteDeps(), { leagueId: created.leagueId, createdByUserId: "u1" });
    if (!invite.ok) throw new Error(invite.reason);

    const first = await acceptInvite(writeDeps(), { code: invite.code, userId: "u2" });
    if (!first.ok) throw new Error(first.reason);
    const second = await acceptInvite(writeDeps(), { code: invite.code, userId: "u2" });
    expect(second).toEqual({ ok: true, leagueId: created.leagueId, teamId: first.teamId, alreadyMember: true });

    expect(await db.select().from(teams).where(eq(teams.leagueId, created.leagueId))).toHaveLength(2);
    const [row] = await db.select().from(leagueInvites).where(eq(leagueInvites.code, invite.code));
    expect(row!.uses).toBe(1);
  });

  it("refuses an unknown, expired or exhausted code with a reason a person can act on", async () => {
    const created = await league();
    expect(await acceptInvite(writeDeps(), { code: "NOSUCH12", userId: "u2" })).toEqual({
      ok: false, status: 404, reason: "That invite link isn't valid. Ask your commissioner for a new one.",
    });

    const expiring = await createInvite(inviteDeps(), { leagueId: created.leagueId, createdByUserId: "u1" });
    if (!expiring.ok) throw new Error(expiring.reason);
    nowIso = "2026-09-30T12:00:00.000Z";
    expect(await acceptInvite(writeDeps(), { code: expiring.code, userId: "u2" })).toEqual({
      ok: false, status: 410, reason: "That invite link has expired. Ask your commissioner for a new one.",
    });

    nowIso = "2026-08-17T12:00:00.000Z";
    const once = await createInvite(
      { db, clock, random: () => 0.9 },
      { leagueId: created.leagueId, createdByUserId: "u1", maxUses: 1 },
    );
    if (!once.ok) throw new Error(once.reason);
    await acceptInvite(writeDeps(), { code: once.code, userId: "u2" });
    expect(await acceptInvite(writeDeps(), { code: once.code, userId: "u3" })).toEqual({
      ok: false, status: 410, reason: "That invite link has already been used up. Ask your commissioner for a new one.",
    });
  });

  it("never lets a league go over its team count, even when two accepts race", async () => {
    const created = await league(2); // commissioner + exactly one free seat
    const invite = await createInvite(inviteDeps(), { leagueId: created.leagueId, createdByUserId: "u1" });
    if (!invite.ok) throw new Error(invite.reason);

    const outcomes = await Promise.all([
      acceptInvite(writeDeps(), { code: invite.code, userId: "u2" }),
      acceptInvite(writeDeps(), { code: invite.code, userId: "u3" }),
    ]);
    expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
    expect(outcomes.find((r) => !r.ok)).toEqual({ ok: false, status: 409, reason: "That league is already full." });
    expect(await db.select().from(teams).where(eq(teams.leagueId, created.leagueId))).toHaveLength(2);
  });

  /**
   * The reason the lock is taken on the LEAGUE row rather than the invite row. Two different
   * codes for the same league share no invite row to serialize on, so locking the invite
   * would let both readers see the same last free seat and both insert.
   */
  it("never lets a league go over its team count when two accepts race on DIFFERENT codes", async () => {
    const created = await league(2); // commissioner + exactly one free seat
    const one = await createInvite({ db, clock, random: () => 0.5 }, { leagueId: created.leagueId, createdByUserId: "u1" });
    const two = await createInvite({ db, clock, random: () => 0.9 }, { leagueId: created.leagueId, createdByUserId: "u1" });
    if (!one.ok) throw new Error(one.reason);
    if (!two.ok) throw new Error(two.reason);
    expect(one.code).not.toBe(two.code);

    const outcomes = await Promise.all([
      acceptInvite(writeDeps(), { code: one.code, userId: "u2" }),
      acceptInvite(writeDeps(), { code: two.code, userId: "u3" }),
    ]);
    expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
    expect(outcomes.find((r) => !r.ok)).toEqual({ ok: false, status: 409, reason: "That league is already full." });
    expect(await db.select().from(teams).where(eq(teams.leagueId, created.leagueId))).toHaveLength(2);

    // Only the winning code spent a use; the one that found the league full spent nothing.
    const rows = await db.select().from(leagueInvites);
    expect(rows.map((row) => row.uses).sort()).toEqual([0, 1]);
  });

  it("names the new team after the joiner when they don't pick one", async () => {
    const created = await league();
    const invite = await createInvite(inviteDeps(), { leagueId: created.leagueId, createdByUserId: "u1" });
    if (!invite.ok) throw new Error(invite.reason);
    const joined = await acceptInvite(writeDeps(), { code: invite.code, userId: "u2" });
    if (!joined.ok) throw new Error(joined.reason);
    const [row] = await db.select().from(teams).where(eq(teams.id, joined.teamId));
    expect(row!.name).toBe("Manager 2");
  });

  it("treats the unique-index backstop firing as 'already a member', not an error", async () => {
    const created = await league();
    const invite = await createInvite(inviteDeps(), { leagueId: created.leagueId, createdByUserId: "u1" });
    if (!invite.ok) throw new Error(invite.reason);
    const joined = await acceptInvite(writeDeps(), { code: invite.code, userId: "u2" });
    if (!joined.ok) throw new Error(joined.reason);

    const raced = await acceptInvite(
      { db: dbWhoseTransactionThrows(uniqueViolation("teams_league_user_idx")), clock, newId },
      { code: invite.code, userId: "u2" },
    );
    expect(raced).toEqual({ ok: true, leagueId: created.leagueId, teamId: joined.teamId, alreadyMember: true });
  });

  it("answers a plain-language 500 for an unexpected failure, and logs the real detail", async () => {
    const created = await league();
    const invite = await createInvite(inviteDeps(), { leagueId: created.leagueId, createdByUserId: "u1" });
    if (!invite.ok) throw new Error(invite.reason);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await acceptInvite(
        { db: dbWhoseTransactionThrows(new Error("connection reset by peer")), clock, newId },
        { code: invite.code, userId: "u2" },
      );
      expect(result).toEqual({ ok: false, status: 500, reason: "We couldn't join that league just now. Please try again." });
      expect(JSON.stringify(result)).not.toContain("connection reset");
      expect(consoleSpy).toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
