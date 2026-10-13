import { describe, it, expect, beforeEach, afterAll } from "vitest";
import type { Db } from "@research-ts/db/client";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { leagues, teams, users } from "@/db/schema";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { copyViolations } from "@/integrity/copy-rules";
import { ENFORCEMENT_REFUSALS, enforcementAppliesTo, tierJoinPrecondition, type PublicLeagueEnforcementPolicy } from "./enforcement";

const db = createTestDb();

const PUBLIC_BEGINNER: PublicLeagueEnforcementPolicy = { isPublicMatchmade: true, experienceTier: "beginner" };
const PUBLIC_EXPERIENCED: PublicLeagueEnforcementPolicy = { isPublicMatchmade: true, experienceTier: "experienced" };
const PRIVATE_BEGINNER: PublicLeagueEnforcementPolicy = { isPublicMatchmade: false, experienceTier: "beginner" };

/** Gives `userId` `count` OTHER completed leagues — matches `browse.test.ts`'s own helper shape. */
async function giveCompletedSeasons(userId: string, count: number): Promise<void> {
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: userId }).onConflictDoNothing();
  for (let i = 0; i < count; i++) {
    const leagueId = `${userId}_history_${i}`;
    await db.insert(leagues).values({
      id: leagueId,
      name: leagueId,
      format: "snake",
      teamCount: 1,
      commissionerUserId: userId,
      seasonCompletedAt: new Date("2025-01-01T00:00:00.000Z"),
    });
    await db.insert(teams).values({ id: `${leagueId}_team`, leagueId, userId, name: "Team" });
  }
}

/** Flips the deploy-wide switch for the duration of one test, then restores it — the same
 *  "settable at deploy" axis `enforcementAppliesTo`'s own docblock describes, exercised rather
 *  than only typed. Not `Object.freeze`d at runtime, so a cast is enough to flip it; every test
 *  that uses this restores the original value in a `finally`, so no other test in this file (or
 *  any file sharing this module singleton) ever observes the flip. */
async function withEnforcement<T>(enabled: boolean, fn: () => Promise<T>): Promise<T> {
  const config = INTEGRITY_CONFIG.participation as { enforceTierSegregation: boolean };
  const original = config.enforceTierSegregation;
  config.enforceTierSegregation = enabled;
  try {
    return await fn();
  } finally {
    config.enforceTierSegregation = original;
  }
}

/** A `ReadonlyDb` that throws the moment anything queries it — proves a short-circuit happened
 *  before any I/O, not merely that the read happened to find nothing. */
const explodingDb = { select: () => { throw new Error("must not be called"); } } as unknown as Db;

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("enforcementAppliesTo", () => {
  it("is true for a public league while segregation is enforced (the default)", () => {
    expect(INTEGRITY_CONFIG.participation.enforceTierSegregation).toBe(true);
    expect(enforcementAppliesTo({ isPublicMatchmade: true })).toBe(true);
  });

  it("is false for a private league, whatever the switch says — the per-league axis is is_public_matchmade", () => {
    expect(enforcementAppliesTo({ isPublicMatchmade: false })).toBe(false);
  });

  it("is false for a public league the moment the deploy-wide switch is off", async () => {
    await withEnforcement(false, async () => {
      expect(enforcementAppliesTo({ isPublicMatchmade: true })).toBe(false);
    });
  });
});

describe("tierJoinPrecondition", () => {
  it("is false for a private league without ever reading the account's history", async () => {
    await expect(tierJoinPrecondition(explodingDb, PRIVATE_BEGINNER, "u_anyone")).resolves.toBe(false);
  });

  it("is false for an experienced-tier public league without ever reading the account's history", async () => {
    await expect(tierJoinPrecondition(explodingDb, PUBLIC_EXPERIENCED, "u_anyone")).resolves.toBe(false);
  });

  it("is false while segregation itself is off, without ever reading the account's history", async () => {
    await withEnforcement(false, async () => {
      await expect(tierJoinPrecondition(explodingDb, PUBLIC_BEGINNER, "u_anyone")).resolves.toBe(false);
    });
  });

  it("is false for a newcomer against a beginner-tier public league", async () => {
    await db.insert(users).values({ id: "u_newcomer", email: "u_newcomer@test.local", displayName: "Newcomer" });
    await expect(tierJoinPrecondition(db, PUBLIC_BEGINNER, "u_newcomer")).resolves.toBe(false);
  });

  it("is true for a veteran against a beginner-tier public league", async () => {
    await giveCompletedSeasons("u_vet", INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
    await expect(tierJoinPrecondition(db, PUBLIC_BEGINNER, "u_vet")).resolves.toBe(true);
  });

  it("is false for a veteran one season short of the cutoff", async () => {
    await giveCompletedSeasons("u_almost_vet", INTEGRITY_CONFIG.participation.veteranSeasonCutoff - 1);
    await expect(tierJoinPrecondition(db, PUBLIC_BEGINNER, "u_almost_vet")).resolves.toBe(false);
  });
});

describe("ENFORCEMENT_REFUSALS", () => {
  it("gives the join door and the creation door two different sentences", () => {
    expect(ENFORCEMENT_REFUSALS.join).not.toBe(ENFORCEMENT_REFUSALS.create);
  });

  it("breaks none of the house copy rules — no dash, nothing accusatory, no passive construction", () => {
    expect(copyViolations(ENFORCEMENT_REFUSALS.join)).toEqual([]);
    expect(copyViolations(ENFORCEMENT_REFUSALS.create)).toEqual([]);
  });
});
