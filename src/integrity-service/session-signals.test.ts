import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditEvents, sessionSignals, users } from "@/db/schema";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import type { AuditEventType } from "@/domain/audit";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { syncUserFromWorkOS } from "@/lib/auth/user-sync";
import { createAuditLogger } from "./audit-logger";
import { hashClientIp, recordSessionSignals, signalsForUsers } from "./session-signals";

const db = createTestDb();
const T = "2026-08-20T18:00:00.000Z";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const SALT = "test-salt-value";

let eventCounter = 0;
const logger = createAuditLogger({ newId: () => `evt_${(eventCounter += 1)}` });

async function seedUser(id: string): Promise<void> {
  await db.insert(users).values({ id, email: `${id}@test.local`, displayName: id });
}

async function auditEventsOn(scope: string, eventType: AuditEventType) {
  return db.select().from(auditEvents).where(and(eq(auditEvents.chainScope, scope), eq(auditEvents.eventType, eventType)));
}

beforeEach(async () => {
  await truncateAll(db);
  eventCounter = 0;
});

afterAll(async () => {
  await truncateAll(db);
});

describe("hashClientIp", () => {
  it("hashes the same address to the same value, because correlation needs equality and nothing more", () => {
    expect(hashClientIp("203.0.113.7", SALT)).toBe(hashClientIp("203.0.113.7", SALT));
    expect(hashClientIp("203.0.113.8", SALT)).not.toBe(hashClientIp("203.0.113.7", SALT));
  });

  it("is a 64-character hex sha256 digest", () => {
    expect(hashClientIp("203.0.113.7", SALT)).toHaveLength(64);
    expect(hashClientIp("203.0.113.7", SALT)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a different salt produces a different hash for the same address", () => {
    expect(hashClientIp("203.0.113.7", "salt-a")).not.toBe(hashClientIp("203.0.113.7", "salt-b"));
  });
});

describe("recordSessionSignals", () => {
  beforeEach(async () => {
    await seedUser("u_a");
    process.env.SESSION_SIGNAL_SALT = SALT;
  });

  it("stores a hash of the address and never the address", async () => {
    await db.transaction((tx) =>
      recordSessionSignals(tx, { userId: "u_a", userAgent: UA, acceptLanguage: "en-US", clientIp: "203.0.113.7", occurredAt: T }),
    );
    const [row] = await db.select().from(sessionSignals);
    expect(row!.ipHash).toHaveLength(64);
    expect(JSON.stringify(row)).not.toContain("203.0.113.7");
    expect(row!.ipHash).toBe(hashClientIp("203.0.113.7", SALT));
  });

  it("stamps every row with where the address came from", async () => {
    // The release gate, made mechanical. Rows written before Fly's proxy overwrites
    // X-Forwarded-For are attacker-influenced; rows written after are not. Storing which is
    // which means flipping the weight is a filter this code already applies, not a memo
    // somebody has to remember to act on.
    await db.transaction((tx) =>
      recordSessionSignals(tx, { userId: "u_a", userAgent: UA, acceptLanguage: "en-US", clientIp: "203.0.113.7", occurredAt: T }),
    );
    const [row] = await db.select().from(sessionSignals);
    expect(row!.ipSource).toBe("xff_unverified");
  });

  it("stores a NULL ipHash for a missing address — a signal you did not observe is not an error", async () => {
    await db.transaction((tx) => recordSessionSignals(tx, { userId: "u_a", userAgent: UA, acceptLanguage: "en-US", clientIp: null, occurredAt: T }));
    const [row] = await db.select().from(sessionSignals);
    expect(row!.ipHash).toBeNull();
    // ipSource is still stamped — it is a property of what THIS code would trust, not of
    // whether it happened to observe an address this time.
    expect(row!.ipSource).toBe("xff_unverified");
  });

  it("stores a NULL ipHash for an empty address, the same as a missing one", async () => {
    await db.transaction((tx) => recordSessionSignals(tx, { userId: "u_a", userAgent: UA, acceptLanguage: "en-US", clientIp: "", occurredAt: T }));
    const [row] = await db.select().from(sessionSignals);
    expect(row!.ipHash).toBeNull();
  });

  it("stores NULL userAgent/acceptLanguage when neither was observed", async () => {
    await db.transaction((tx) => recordSessionSignals(tx, { userId: "u_a", userAgent: null, acceptLanguage: null, clientIp: null, occurredAt: T }));
    const [row] = await db.select().from(sessionSignals);
    expect(row!.userAgent).toBeNull();
    expect(row!.acceptLanguage).toBeNull();
  });

  it("truncates a User-Agent past the configured cap before storage", async () => {
    const cap = INTEGRITY_CONFIG.multiAccount.signals.maxUserAgentLength;
    const overlong = "x".repeat(cap + 50);
    await db.transaction((tx) => recordSessionSignals(tx, { userId: "u_a", userAgent: overlong, acceptLanguage: null, clientIp: null, occurredAt: T }));
    const [row] = await db.select().from(sessionSignals);
    expect(row!.userAgent).toHaveLength(cap);
    expect(row!.userAgent).toBe("x".repeat(cap));
  });

  it("truncates Accept-Language past the configured cap before storage", async () => {
    const cap = INTEGRITY_CONFIG.multiAccount.signals.maxAcceptLanguageLength;
    const overlong = "en-US,".repeat(cap);
    await db.transaction((tx) => recordSessionSignals(tx, { userId: "u_a", userAgent: null, acceptLanguage: overlong, clientIp: null, occurredAt: T }));
    const [row] = await db.select().from(sessionSignals);
    expect(row!.acceptLanguage).toHaveLength(cap);
  });

  it("leaves a User-Agent under the cap untouched", async () => {
    await db.transaction((tx) => recordSessionSignals(tx, { userId: "u_a", userAgent: UA, acceptLanguage: null, clientIp: null, occurredAt: T }));
    const [row] = await db.select().from(sessionSignals);
    expect(row!.userAgent).toBe(UA);
  });

  it("uses the caller's newId when one is supplied", async () => {
    const signal = await db.transaction((tx) =>
      recordSessionSignals(tx, { userId: "u_a", userAgent: null, acceptLanguage: null, clientIp: null, occurredAt: T }, { newId: () => "sig_fixed" }),
    );
    expect(signal.id).toBe("sig_fixed");
    const [row] = await db.select().from(sessionSignals);
    expect(row!.id).toBe("sig_fixed");
  });

  describe("SESSION_SIGNAL_SALT", () => {
    const original = process.env.SESSION_SIGNAL_SALT;

    afterEach(() => {
      process.env.SESSION_SIGNAL_SALT = original;
    });

    it("fails fast when unset and an address needs hashing", async () => {
      delete process.env.SESSION_SIGNAL_SALT;
      await expect(
        db.transaction((tx) => recordSessionSignals(tx, { userId: "u_a", userAgent: null, acceptLanguage: null, clientIp: "203.0.113.7", occurredAt: T })),
      ).rejects.toThrow("SESSION_SIGNAL_SALT is not set");
    });

    it("never demands a salt for a sign-in with no address to hash", async () => {
      delete process.env.SESSION_SIGNAL_SALT;
      await expect(
        db.transaction((tx) => recordSessionSignals(tx, { userId: "u_a", userAgent: null, acceptLanguage: null, clientIp: null, occurredAt: T })),
      ).resolves.toBeDefined();
    });
  });
});

describe("signalsForUsers", () => {
  it("returns [] for empty input without querying", async () => {
    expect(await signalsForUsers(db, [])).toEqual([]);
  });

  it("returns only the named users' signals, most recent first", async () => {
    await seedUser("u_a");
    await seedUser("u_b");
    process.env.SESSION_SIGNAL_SALT = SALT;
    await db.transaction((tx) =>
      recordSessionSignals(tx, { userId: "u_a", userAgent: null, acceptLanguage: null, clientIp: null, occurredAt: "2026-08-20T10:00:00.000Z" }, { newId: () => "sig_1" }),
    );
    await db.transaction((tx) =>
      recordSessionSignals(tx, { userId: "u_a", userAgent: null, acceptLanguage: null, clientIp: null, occurredAt: "2026-08-20T12:00:00.000Z" }, { newId: () => "sig_2" }),
    );
    await db.transaction((tx) =>
      recordSessionSignals(tx, { userId: "u_b", userAgent: null, acceptLanguage: null, clientIp: null, occurredAt: "2026-08-20T11:00:00.000Z" }, { newId: () => "sig_other" }),
    );

    const rows = await signalsForUsers(db, ["u_a"]);
    expect(rows.map((r) => r.id)).toEqual(["sig_2", "sig_1"]);
    expect(rows.every((r) => r.userId === "u_a")).toBe(true);
  });
});

describe("integration through syncUserFromWorkOS", () => {
  const workosUser = { id: "u_a", email: "a@test.local", firstName: "A", lastName: "User" };

  beforeEach(() => {
    process.env.SESSION_SIGNAL_SALT = SALT;
  });

  it("goes with the user row and the audit event, or none of them go", async () => {
    const throwingLogger = { ...logger, record: async () => { throw new Error("audit append failed"); } };
    await expect(
      syncUserFromWorkOS({ db, clock: { now: () => T }, via: "callback", audit: throwingLogger }, workosUser),
    ).rejects.toThrow("audit append failed");
    expect(await db.select().from(sessionSignals)).toEqual([]);
  });

  it("deletes a member's signals when the member is deleted, which audit_events cannot do", async () => {
    await syncUserFromWorkOS(
      { db, clock: { now: () => T }, via: "callback", audit: logger, signals: { userAgent: UA, acceptLanguage: "en-US", clientIp: "203.0.113.7" } },
      workosUser,
    );
    expect(await db.select().from(sessionSignals)).toHaveLength(1);

    await db.delete(users).where(eq(users.id, "u_a"));

    expect(await db.select().from(sessionSignals)).toEqual([]);
    // ...while the session_started audit event stays, correctly: what happened is not personal
    // data about a device, and ruling 7 is why the two live in different tables.
    expect(await auditEventsOn("platform", "session_started")).toHaveLength(1);
  });

  it("records the real headers a callback observed, truncated and hashed", async () => {
    await syncUserFromWorkOS(
      { db, clock: { now: () => T }, via: "callback", audit: logger, signals: { userAgent: UA, acceptLanguage: "en-US", clientIp: "203.0.113.7" } },
      workosUser,
    );
    const [row] = await db.select().from(sessionSignals);
    expect(row).toMatchObject({ userId: "u_a", userAgent: UA, acceptLanguage: "en-US", ipHash: hashClientIp("203.0.113.7", SALT), ipSource: "xff_unverified" });
  });

  it("records an all-null signal for a caller with no headers to give (the session_backfill door)", async () => {
    await syncUserFromWorkOS({ db, clock: { now: () => T }, via: "session_backfill", audit: logger }, workosUser);
    const [row] = await db.select().from(sessionSignals);
    expect(row).toMatchObject({ userId: "u_a", userAgent: null, acceptLanguage: null, ipHash: null, ipSource: "xff_unverified" });
  });
});
