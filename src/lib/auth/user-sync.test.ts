import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { users } from "@/db/schema";
import { syncUserFromWorkOS, displayNameFrom } from "./user-sync";

const db = createTestDb();
const T0 = "2026-08-17T12:00:00.000Z";
const T1 = "2026-08-18T12:00:00.000Z";

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("displayNameFrom", () => {
  it("prefers first + last name", () => {
    expect(displayNameFrom({ firstName: "Jane", lastName: "Doe", email: "jane@example.com" })).toBe("Jane Doe");
  });
  it("falls back to first name alone", () => {
    expect(displayNameFrom({ firstName: "Jane", lastName: null, email: "jane@example.com" })).toBe("Jane");
  });
  it("falls back to the email local part when there is no name", () => {
    expect(displayNameFrom({ firstName: null, lastName: null, email: "jane.doe@example.com" })).toBe("jane.doe");
  });
});

describe("syncUserFromWorkOS", () => {
  const workosUser = {
    id: "user_01HXYZ",
    email: "jane@example.com",
    firstName: "Jane",
    lastName: "Doe",
    profilePictureUrl: "https://img.example/jane.png",
  };

  it("creates the local profile row on first sign-in, keyed by the WorkOS id", async () => {
    await syncUserFromWorkOS({ db, clock: { now: () => T0 } }, workosUser);
    const [row] = await db.select().from(users).where(eq(users.id, "user_01HXYZ"));
    expect(row?.email).toBe("jane@example.com");
    expect(row?.displayName).toBe("Jane Doe");
    expect(row?.avatarUrl).toBe("https://img.example/jane.png");
    expect(row?.experienceTier).toBe("beginner");
    expect(row?.createdAt.toISOString()).toBe(T0);
  });

  it("is idempotent — a second sign-in updates lastSeenAt/email but preserves createdAt and app-owned fields", async () => {
    await syncUserFromWorkOS({ db, clock: { now: () => T0 } }, workosUser);
    await db.update(users).set({ experienceTier: "experienced", displayName: "The Commish" }).where(eq(users.id, "user_01HXYZ"));

    await syncUserFromWorkOS({ db, clock: { now: () => T1 } }, { ...workosUser, email: "jane.new@example.com" });

    const [row] = await db.select().from(users).where(eq(users.id, "user_01HXYZ"));
    expect(row?.email).toBe("jane.new@example.com");
    expect(row?.lastSeenAt.toISOString()).toBe(T1);
    expect(row?.createdAt.toISOString()).toBe(T0);
    // App-owned fields are not clobbered by an identity-provider sync.
    expect(row?.experienceTier).toBe("experienced");
    expect(row?.displayName).toBe("The Commish");
  });

  it("returns the local profile", async () => {
    const profile = await syncUserFromWorkOS({ db, clock: { now: () => T0 } }, workosUser);
    expect(profile.id).toBe("user_01HXYZ");
    expect(profile.displayName).toBe("Jane Doe");
  });
});
