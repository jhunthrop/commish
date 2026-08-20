import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { Db } from "@/db/client";
import { users, userPreferences } from "@/db/schema";
import { eq } from "drizzle-orm";
import { readPreferences, updatePreferences } from "./preferences";

const db = createTestDb();
const fixedClock = { now: () => "2026-08-19T12:00:00.000Z" };

async function seedUser(db: Db, id: string): Promise<void> {
  await db.insert(users).values({ id, email: `${id}@example.com`, displayName: id });
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("readPreferences", () => {
  it("seeds guided help for a beginner on first read", async () => {
    await seedUser(db, "u1");
    const prefs = await readPreferences(db, { id: "u1", experienceTier: "beginner" });
    expect(prefs).toEqual({ helpLevel: "guided", draftTourDismissedAt: null });
  });

  it("seeds standard help for an experienced manager on first read", async () => {
    await seedUser(db, "u1");
    const prefs = await readPreferences(db, { id: "u1", experienceTier: "experienced" });
    expect(prefs.helpLevel).toBe("standard");
  });

  it("is idempotent: a second read never re-seeds or clobbers a changed row", async () => {
    await seedUser(db, "u1");
    await readPreferences(db, { id: "u1", experienceTier: "beginner" });
    await updatePreferences(db, { userId: "u1", helpLevel: "standard" });
    const prefs = await readPreferences(db, { id: "u1", experienceTier: "beginner" });
    expect(prefs.helpLevel).toBe("standard");

    const rows = await db.select().from(userPreferences).where(eq(userPreferences.userId, "u1"));
    expect(rows).toHaveLength(1);
  });

  it("issues NO write on a second read — the steady state is read-only", async () => {
    // `GET /api/home` calls this, and `HomeBoard` polls that route every 30 seconds, so an
    // unconditional seed meant every open tab took a RowExclusiveLock on `user_preferences`
    // twice a minute forever, for a row that already existed.
    await seedUser(db, "u1");
    await readPreferences(db, { id: "u1", experienceTier: "beginner" });

    const insert = vi.spyOn(db, "insert");
    try {
      const prefs = await readPreferences(db, { id: "u1", experienceTier: "beginner" });
      expect(prefs.helpLevel).toBe("guided");
      expect(insert).not.toHaveBeenCalled();
    } finally {
      insert.mockRestore();
    }
  });

  it("still writes on the FIRST read, which is what makes the case above meaningful", async () => {
    await seedUser(db, "u1");
    const insert = vi.spyOn(db, "insert");
    try {
      await readPreferences(db, { id: "u1", experienceTier: "beginner" });
      expect(insert).toHaveBeenCalledTimes(1);
    } finally {
      insert.mockRestore();
    }
  });

  it("does not double-insert when two first reads race for the same user", async () => {
    await seedUser(db, "u1");
    await Promise.all([
      readPreferences(db, { id: "u1", experienceTier: "beginner" }),
      readPreferences(db, { id: "u1", experienceTier: "beginner" }),
    ]);
    const rows = await db.select().from(userPreferences).where(eq(userPreferences.userId, "u1"));
    expect(rows).toHaveLength(1);
  });
});

describe("updatePreferences", () => {
  it("writes the help level and leaves the tour dismissal alone", async () => {
    await seedUser(db, "u1");
    await readPreferences(db, { id: "u1", experienceTier: "beginner" });
    const prefs = await updatePreferences(db, { userId: "u1", helpLevel: "standard" }, fixedClock);
    expect(prefs).toEqual({ helpLevel: "standard", draftTourDismissedAt: null });
  });

  it("stamps draftTourDismissedAt from the injected clock and leaves helpLevel alone", async () => {
    await seedUser(db, "u1");
    await readPreferences(db, { id: "u1", experienceTier: "experienced" });
    const prefs = await updatePreferences(db, { userId: "u1", dismissDraftTour: true }, fixedClock);
    expect(prefs).toEqual({ helpLevel: "standard", draftTourDismissedAt: "2026-08-19T12:00:00.000Z" });
  });

  it("seeds the row from the user's own tier and applies the write, when no row exists yet", async () => {
    // A bare PATCH from a user who has never opened anything that calls `readPreferences`
    // first must still succeed — this is the seed-then-update path, not a 500.
    await seedUser(db, "u1"); // beginner by column default
    const prefs = await updatePreferences(db, { userId: "u1", dismissDraftTour: true }, fixedClock);
    expect(prefs).toEqual({ helpLevel: "guided", draftTourDismissedAt: "2026-08-19T12:00:00.000Z" });

    const rows = await db.select().from(userPreferences).where(eq(userPreferences.userId, "u1"));
    expect(rows).toHaveLength(1);
  });

  it("seeds standard help for an experienced manager who writes before ever reading", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@example.com", displayName: "u1", experienceTier: "experienced" });
    const prefs = await updatePreferences(db, { userId: "u1", dismissDraftTour: true }, fixedClock);
    expect(prefs.helpLevel).toBe("standard");
  });

  it("throws rather than silently proceeding when the user row itself doesn't exist", async () => {
    await expect(updatePreferences(db, { userId: "nobody", helpLevel: "standard" }, fixedClock)).rejects.toThrow();
  });
});

/**
 * The two "after seeding" guards. Real Postgres cannot reach either: `seedIfMissing` is
 * `INSERT ... ON CONFLICT DO NOTHING` against a foreign key, so it either leaves a row behind or
 * raises. The guards exist so a future refactor that breaks that invariant fails LOUDLY instead
 * of returning a preference state assembled from nothing, and a guard nothing exercises is a
 * guard nobody knows still works. A stub `Db` is the only way to put the code in the state it
 * defends against.
 */
describe("readPreferences / updatePreferences — the impossible-state guards", () => {
  const noRows = { from: () => ({ where: async () => [] }) };
  const seedNoop = { values: () => ({ onConflictDoNothing: async () => undefined }) };

  it("refuses to invent a preference state when the seeded row is somehow not there on read", async () => {
    const stub = { select: () => noRows, insert: () => seedNoop } as unknown as Db;
    await expect(readPreferences(stub, { id: "u1", experienceTier: "beginner" })).rejects.toThrow(
      "No preferences row for user u1 after seeding.",
    );
  });

  it("refuses to invent a preference state when the write updates nothing", async () => {
    const tx = {
      select: () => ({ from: () => ({ where: async () => [{ experienceTier: "beginner" }] }) }),
      insert: () => seedNoop,
      update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
    };
    const stub = { transaction: (run: (t: unknown) => Promise<unknown>) => run(tx) } as unknown as Db;
    await expect(updatePreferences(stub, { userId: "u1", helpLevel: "standard" }, fixedClock)).rejects.toThrow(
      "No preferences row for user u1 after seeding.",
    );
  });
});
