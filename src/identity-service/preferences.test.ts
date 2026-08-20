import { describe, it, expect, beforeEach, afterAll } from "vitest";
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

  it("throws rather than silently seeding the wrong default when no row exists yet", async () => {
    await seedUser(db, "u1");
    await expect(updatePreferences(db, { userId: "u1", helpLevel: "standard" }, fixedClock)).rejects.toThrow();
  });
});
