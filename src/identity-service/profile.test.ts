import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { Db } from "@/db/client";
import { auditEvents, userPreferences, users } from "@/db/schema";
import { createAuditLogger } from "@/integrity-service/audit-logger";
import { syncUserFromWorkOS } from "@/lib/auth/user-sync";
import { readPreferences, updatePreferences } from "./preferences";
import { readProfile, updateProfile } from "./profile";

const db = createTestDb();
const fixedClock = { now: () => "2026-08-19T12:00:00.000Z" };

let counter = 0;
const logger = createAuditLogger({ newId: () => `evt_${(counter += 1)}` });

/** Module-private: the minimal `users` row every case here starts from. */
async function seedUser(
  db: Db,
  overrides: { readonly id: string; readonly displayName?: string; readonly avatarUrl?: string | null },
): Promise<void> {
  await db.insert(users).values({
    id: overrides.id,
    email: `${overrides.id}@example.com`,
    displayName: overrides.displayName ?? overrides.id,
    avatarUrl: overrides.avatarUrl ?? null,
  });
}

beforeEach(async () => {
  await truncateAll(db);
  counter = 0;
});

afterAll(async () => {
  await truncateAll(db);
});

describe("updateProfile / readProfile", () => {
  it("writes a display name, a tier and a preset, and reads them back", async () => {
    await seedUser(db, { id: "u1", displayName: "u1@example.com" });
    const saved = await updateProfile(db, {
      userId: "u1", displayName: "Ada Lovelace", experienceTier: "experienced", avatarPreset: "shield",
    });
    expect(saved).toEqual({
      displayName: "Ada Lovelace", experienceTier: "experienced", avatarPreset: "shield", avatar: "preset:shield",
    });
    expect(await readProfile(db, "u1")).toEqual(saved);
  });

  it("never lets a profile write set an arbitrary avatar value", async () => {
    // The write path takes a PRESET KEY, not a URL. There is no code path from a request body to
    // an <img src>, which is a stronger guarantee than validating one.
    await seedUser(db, { id: "u1" });
    // @ts-expect-error — the input type does not admit a URL, and this line is the proof.
    await expect(updateProfile(db, { userId: "u1", displayName: "A", experienceTier: "beginner", avatarPreset: "https://evil.example/x.png" }))
      .rejects.toThrow();
  });

  it("leaves the WorkOS-supplied picture in place until a preset is chosen", async () => {
    await seedUser(db, { id: "u1", avatarUrl: "https://workoscdn.com/u/abc.png" });
    const saved = await updateProfile(db, { userId: "u1", displayName: "Ada", experienceTier: "beginner", avatarPreset: null });
    expect(saved.avatar).toBe("https://workoscdn.com/u/abc.png");
  });

  // H4, the real resurrection vector: two tabs, both loaded before either saved. Tab A renames
  // the user; tab B — which still holds the OLD name in its React state — saves an avatar. Under
  // the old full-row PATCH, tab B's body carried the stale `displayName` and `experienceTier` and
  // put both back. The sparse body carries neither, so tab A's rename survives.
  it("an avatar-only save from a stale tab leaves a concurrently-changed display name intact", async () => {
    await seedUser(db, { id: "u1", displayName: "Ada Lovelace" });

    // Both tabs load. (Their shared starting point: the row seeded above.)
    // Tab A saves a rename and a tier change.
    await updateProfile(db, { userId: "u1", displayName: "Ada Byron", experienceTier: "experienced" });

    // Tab B, still holding "Ada Lovelace"/"beginner" in its own state, saves ONLY its avatar —
    // which is exactly what `ProfileForm`'s `dirtyFields` now puts on the wire.
    const afterStaleSave = await updateProfile(db, { userId: "u1", avatarPreset: "shield" });

    expect(afterStaleSave).toEqual({
      displayName: "Ada Byron",
      experienceTier: "experienced",
      avatarPreset: "shield",
      avatar: "preset:shield",
    });
    expect(await readProfile(db, "u1")).toEqual(afterStaleSave);
  });

  it("changes nothing and reads the row back when the caller names no writable field", async () => {
    await seedUser(db, { id: "u1", displayName: "Ada Lovelace" });
    const unchanged = await updateProfile(db, { userId: "u1", avatarPreset: null });
    expect(unchanged).toEqual({ displayName: "Ada Lovelace", experienceTier: "beginner", avatarPreset: null, avatar: null });
  });

  // H3: `helpLevel` was seeded once from `experienceTier` and never re-derived, and no
  // production path ever PATCHed it, so every account (all of which sync as `beginner`) sat on
  // `guided` forever. The tier is the coarse control, the profile's explicit "How much help" the
  // fine one, and last write wins. This drives the whole sequence in order.
  it("re-derives helpLevel when the tier changes, and an explicit choice sticks until the next tier change", async () => {
    await seedUser(db, { id: "u1" }); // beginner by column default
    expect((await readPreferences(db, { id: "u1", experienceTier: "beginner" })).helpLevel).toBe("guided");

    // 1. The explicit control wins over the seeded default.
    await updatePreferences(db, { userId: "u1", helpLevel: "standard" }, fixedClock);
    expect((await readPreferences(db, { id: "u1", experienceTier: "beginner" })).helpLevel).toBe("standard");

    // 2. Saving the profile WITHOUT touching the tier leaves that explicit choice alone —
    //    the sparse PATCH carries no `experienceTier`, so there is nothing to re-derive from.
    await updateProfile(db, { userId: "u1", displayName: "Ada Lovelace" }, fixedClock);
    expect((await readPreferences(db, { id: "u1", experienceTier: "beginner" })).helpLevel).toBe("standard");

    // 3. Changing the tier re-derives it: "experienced" defaults to standard, already the value.
    //    Going back to "beginner" is the visible half — guided returns.
    await updateProfile(db, { userId: "u1", experienceTier: "experienced" }, fixedClock);
    expect((await readPreferences(db, { id: "u1", experienceTier: "experienced" })).helpLevel).toBe("standard");
    await updateProfile(db, { userId: "u1", experienceTier: "beginner" }, fixedClock);
    expect((await readPreferences(db, { id: "u1", experienceTier: "beginner" })).helpLevel).toBe("guided");

    // 4. And the explicit control still wins after that.
    await updatePreferences(db, { userId: "u1", helpLevel: "standard" }, fixedClock);
    expect((await readPreferences(db, { id: "u1", experienceTier: "beginner" })).helpLevel).toBe("standard");
  });

  it("re-derives helpLevel for a user who has never had a preferences row", async () => {
    await seedUser(db, { id: "u1" });
    await updateProfile(db, { userId: "u1", experienceTier: "experienced" }, fixedClock);
    const [row] = await db.select().from(userPreferences).where(eq(userPreferences.userId, "u1"));
    expect(row?.helpLevel).toBe("standard");
  });

  it("reads null rather than throwing for a user row that does not exist", async () => {
    expect(await readProfile(db, "nobody")).toBeNull();
  });

  it("fails loudly rather than silently succeeding when the user row does not exist", async () => {
    // Both shapes of the write: the one that reaches an UPDATE, and the no-op one that only
    // reads the row back. Neither may report success for a profile nobody has.
    await expect(updateProfile(db, { userId: "nobody", displayName: "Ada" }, fixedClock)).rejects.toThrow(/No user row for id nobody/);
    await expect(updateProfile(db, { userId: "nobody", avatarPreset: null }, fixedClock)).rejects.toThrow(/No user row for id nobody/);
  });

  it("records what changed, and never the old or new display name's contents beyond the field list", async () => {
    await seedUser(db, { id: "u1", displayName: "Ada Lovelace" });
    await updateProfile(db, { userId: "u1", displayName: "Ada B." }, fixedClock, { audit: logger });

    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "profile_updated"));
    expect(event).toMatchObject({ chainScope: "platform", leagueId: null, actorId: "u1", actorType: "user" });
    expect(event!.payload).toEqual({ fields: ["displayName"] });
  });

  it("records every field a multi-field PATCH actually touched, in canonical order", async () => {
    await seedUser(db, { id: "u1" });
    await updateProfile(db, { userId: "u1", displayName: "Ada", experienceTier: "experienced", avatarPreset: "shield" }, fixedClock, { audit: logger });

    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "profile_updated"));
    expect(event!.payload).toEqual({ fields: ["displayName", "experienceTier", "avatarPreset"] });
  });

  it("records nothing for a PATCH that changes nothing", async () => {
    await seedUser(db, { id: "u1" });
    await updateProfile(db, { userId: "u1", avatarPreset: null }, fixedClock, { audit: logger });
    expect(await db.select().from(auditEvents)).toHaveLength(0);
  });

  it("rolls back the profile write when the audit append fails — ruling 4, the opposite of publishing", async () => {
    await seedUser(db, { id: "u1", displayName: "Ada Lovelace" });
    const brokenAudit = { ...logger, record: async () => { throw new Error("audit append failed"); } };
    await expect(updateProfile(db, { userId: "u1", displayName: "Ada B." }, fixedClock, { audit: brokenAudit })).rejects.toThrow("audit append failed");
    expect(await readProfile(db, "u1")).toMatchObject({ displayName: "Ada Lovelace" });
  });

  it("a later WorkOS sign-in does not clobber what the user chose", async () => {
    // user-sync.ts has always CLAIMED this. Nothing could test it before, because nothing could
    // edit. Now something can, so the claim gets an assertion.
    await seedUser(db, { id: "u1" });
    await updateProfile(db, { userId: "u1", displayName: "Ada Lovelace", experienceTier: "experienced", avatarPreset: "flame" });
    await syncUserFromWorkOS({ db, clock: fixedClock }, {
      id: "u1", email: "ada@example.com", firstName: "A", lastName: "L", profilePictureUrl: "https://workoscdn.com/new.png",
    });
    expect(await readProfile(db, "u1")).toMatchObject({ displayName: "Ada Lovelace", experienceTier: "experienced", avatar: "preset:flame" });
  });
});
