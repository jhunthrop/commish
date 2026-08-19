import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import { syncUserFromWorkOS } from "@/lib/auth/user-sync";
import { readProfile, updateProfile } from "./profile";

const db = createTestDb();
const fixedClock = { now: () => "2026-08-19T12:00:00.000Z" };

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
