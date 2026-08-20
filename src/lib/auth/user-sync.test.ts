import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { auditEvents, users } from "@/db/schema";
import { createAuditLogger } from "@/integrity-service/audit-logger";
import { syncUserFromWorkOS, displayNameFrom } from "./user-sync";

const db = createTestDb();
const T0 = "2026-08-17T12:00:00.000Z";
const T1 = "2026-08-18T12:00:00.000Z";

let counter = 0;
const logger = createAuditLogger({ newId: () => `evt_${(counter += 1)}` });

beforeEach(async () => {
  await truncateAll(db);
  counter = 0;
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

  /**
   * LOW-5, made load-bearing. Every OTHER door a display name comes through is a person typing
   * into a form, where `isPrintableDisplayName` refuses and they fix it. This one is a sign-in:
   * the value arrives from WorkOS with the session, the person may not know a bidi override is in
   * their provider profile, and refusing would refuse them the product. So it strips — and these
   * assertions redden if the strip is removed, on BOTH branches, rather than describing it.
   */
  it("strips characters a reader cannot see out of a provider-supplied name, on every branch", () => {
    const rtl = String.fromCharCode(0x202e);
    const zeroWidth = String.fromCharCode(0x200b);
    expect(displayNameFrom({ firstName: `${rtl}Jane`, lastName: `Doe${zeroWidth}`, email: "jane@example.com" })).toBe("Jane Doe");
    expect(displayNameFrom({ firstName: null, lastName: null, email: `${rtl}jane.doe@example.com` })).toBe("jane.doe");
  });

  it("writes the STRIPPED name to users.display_name on a real sign-in", async () => {
    // The end-to-end half: not just that the helper strips, but that the stripped value is what
    // lands in the column every other surface reads a name from.
    await syncUserFromWorkOS(
      { db, clock: { now: () => T0 }, via: "callback", audit: logger },
      { id: "user_hostile", email: "hostile@example.com", firstName: `${String.fromCharCode(0x202e)}Jane`, lastName: "Doe" },
    );
    const [row] = await db.select().from(users).where(eq(users.id, "user_hostile"));
    expect(row?.displayName).toBe("Jane Doe");
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
    await syncUserFromWorkOS({ db, clock: { now: () => T0 }, via: "callback" }, workosUser);
    const [row] = await db.select().from(users).where(eq(users.id, "user_01HXYZ"));
    expect(row?.email).toBe("jane@example.com");
    expect(row?.displayName).toBe("Jane Doe");
    expect(row?.avatarUrl).toBe("https://img.example/jane.png");
    expect(row?.experienceTier).toBe("beginner");
    expect(row?.createdAt.toISOString()).toBe(T0);
  });

  it("is idempotent — a second sign-in updates lastSeenAt/email but preserves createdAt and app-owned fields", async () => {
    await syncUserFromWorkOS({ db, clock: { now: () => T0 }, via: "callback" }, workosUser);
    await db.update(users).set({ experienceTier: "experienced", displayName: "The Commish" }).where(eq(users.id, "user_01HXYZ"));

    await syncUserFromWorkOS({ db, clock: { now: () => T1 }, via: "callback" }, { ...workosUser, email: "jane.new@example.com" });

    const [row] = await db.select().from(users).where(eq(users.id, "user_01HXYZ"));
    expect(row?.email).toBe("jane.new@example.com");
    expect(row?.lastSeenAt.toISOString()).toBe(T1);
    expect(row?.createdAt.toISOString()).toBe(T0);
    // App-owned fields are not clobbered by an identity-provider sync.
    expect(row?.experienceTier).toBe("experienced");
    expect(row?.displayName).toBe("The Commish");
  });

  it("returns the local profile", async () => {
    const profile = await syncUserFromWorkOS({ db, clock: { now: () => T0 }, via: "callback" }, workosUser);
    expect(profile.id).toBe("user_01HXYZ");
    expect(profile.displayName).toBe("Jane Doe");
  });

  it("records a session_started on the platform chain for every sign-in", async () => {
    await syncUserFromWorkOS({ db, clock: { now: () => T0 }, via: "callback", audit: logger }, workosUser);
    await syncUserFromWorkOS({ db, clock: { now: () => T1 }, via: "callback", audit: logger }, workosUser);

    const rows = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "session_started")).orderBy(auditEvents.sequence);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ chainScope: "platform", leagueId: null, actorId: "user_01HXYZ", actorType: "user" });
    expect(rows[0]!.payload).toEqual({ via: "callback", firstSignIn: true });
    expect(rows[1]!.payload).toEqual({ via: "callback", firstSignIn: false });
  });

  it("carries no IP and no device signal, deliberately", async () => {
    // Ruling 20. All four existing IP reads key on X-Forwarded-For, which their own docblock
    // calls caller-controlled and rotatable — a multi-account flag keyed on a forgeable header
    // lets an attacker manufacture suspicion against someone else's account, strictly worse than
    // a bypassed rate limiter. Plan B adds the signals, with the IP weight at zero.
    await syncUserFromWorkOS({ db, clock: { now: () => T0 }, via: "callback", audit: logger }, workosUser);
    const [row] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "session_started"));
    expect(Object.keys(row!.payload).sort()).toEqual(["firstSignIn", "via"]);
  });

  it("loses the audit event when the upsert's own transaction rolls back", async () => {
    // The same-transaction contract at a real call site: the upsert and its audit event share
    // one transaction, so a failure inside the audit append (an unhashable payload) fails the
    // upsert too, rather than leaving a sign-in recorded nowhere.
    await expect(
      syncUserFromWorkOS(
        { db, clock: { now: () => T0 }, via: "callback", audit: { ...logger, record: async () => { throw new Error("audit append failed"); } } },
        workosUser,
      ),
    ).rejects.toThrow("audit append failed");
    expect(await db.select().from(users)).toHaveLength(0);
  });
});

describe("session_started.via names the door it actually came through (MEDIUM-5)", () => {
  const workosUser = { id: "user_01HXYZ", email: "jane@example.com", firstName: "Jane", lastName: "Doe" };

  it("records the backfill path as a backfill, not as a callback it was not", async () => {
    // `getCurrentUser` calls this for a valid session whose local row is missing. It used to
    // write the literal `"callback"`, which is a false statement in an append-only record that
    // nothing may ever repair.
    await syncUserFromWorkOS({ db, clock: { now: () => T0 }, via: "session_backfill", audit: logger }, workosUser);
    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "session_started"));
    expect(event!.payload).toMatchObject({ via: "session_backfill", firstSignIn: true });
  });

  it("still records the callback path as the callback", async () => {
    await syncUserFromWorkOS({ db, clock: { now: () => T0 }, via: "callback", audit: logger }, workosUser);
    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "session_started"));
    expect(event!.payload).toMatchObject({ via: "callback" });
  });
});
