import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { auditEvents, users } from "@/db/schema";
import { createTestDb, truncateAll } from "@/db/test-db";
import { createAuditLogger } from "@/integrity-service/audit-logger";
import { clearSelfExclusion, setSelfExclusion } from "./exclusion";

const db = createTestDb();
const NOW = "2026-09-01T00:00:00.000Z";
const at = (iso: string) => ({ now: () => iso });

let eventCounter = 0;
const logger = createAuditLogger({ newId: () => `evt_${(eventCounter += 1)}` });

async function seedUser(id: string): Promise<void> {
  await db.insert(users).values({ id, email: `${id}@test.local`, displayName: id });
}

async function selfExclusionEvents(): Promise<readonly { readonly eventType: string; readonly actorId: string | null; readonly payload: unknown }[]> {
  return db
    .select({ eventType: auditEvents.eventType, actorId: auditEvents.actorId, payload: auditEvents.payload })
    .from(auditEvents)
    .where(eq(auditEvents.chainScope, "platform"));
}

beforeEach(async () => {
  await truncateAll(db);
  eventCounter = 0;
});

afterAll(async () => {
  await truncateAll(db);
});

describe("setSelfExclusion", () => {
  it("stamps self_excluded_at with the injected clock, and audits self_exclusion_set", async () => {
    await seedUser("u1");
    const result = await setSelfExclusion(db, "u1", at(NOW), logger);
    expect(result).toBe(NOW);
    const [row] = await db.select({ selfExcludedAt: users.selfExcludedAt }).from(users).where(eq(users.id, "u1"));
    expect(row?.selfExcludedAt?.toISOString()).toBe(NOW);

    const events = await selfExclusionEvents();
    expect(events).toEqual([{ eventType: "self_exclusion_set", actorId: "u1", payload: {} }]);
  });

  it("is idempotent: a repeat call answers the ORIGINAL stamp and audits nothing the second time", async () => {
    await seedUser("u1");
    const first = await setSelfExclusion(db, "u1", at(NOW), logger);
    const second = await setSelfExclusion(db, "u1", at("2026-09-02T00:00:00.000Z"), logger);
    expect(second).toBe(first);
    const [row] = await db.select({ selfExcludedAt: users.selfExcludedAt }).from(users).where(eq(users.id, "u1"));
    expect(row?.selfExcludedAt?.toISOString()).toBe(NOW);

    // grantAdmin's own "no event for a no-op" precedent: exactly one self_exclusion_set, from the
    // first call — the idempotent repeat stays audit-free.
    expect(await selfExclusionEvents()).toHaveLength(1);
  });

  it("throws for a userId with no row", async () => {
    await expect(setSelfExclusion(db, "u_never_seen", at(NOW), logger)).rejects.toThrow('setSelfExclusion: no user row for "u_never_seen".');
    expect(await selfExclusionEvents()).toEqual([]);
  });

  it("defaults clock and audit when not supplied, so a caller need not thread either through", async () => {
    await seedUser("u1");
    const result = await setSelfExclusion(db, "u1");
    expect(result).toMatch(/\S/);
  });
});

describe("clearSelfExclusion", () => {
  it("clears the stamp, and audits self_exclusion_cleared on the platform chain — replacing the old admin_action shape", async () => {
    await seedUser("u_op");
    await seedUser("u1");
    await setSelfExclusion(db, "u1", at(NOW), logger);

    const result = await clearSelfExclusion(db, { userId: "u1", operatorUserId: "u_op", clock: at("2026-09-05T00:00:00.000Z"), audit: logger });
    expect(result).toEqual({ ok: true });

    const [row] = await db.select({ selfExcludedAt: users.selfExcludedAt }).from(users).where(eq(users.id, "u1"));
    expect(row?.selfExcludedAt).toBeNull();

    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "self_exclusion_cleared"));
    expect(event).toMatchObject({ chainScope: "platform", leagueId: null, actorId: "u_op", actorType: "user" });
    expect(event!.payload).toEqual({ subjectUserId: "u1" });

    // No admin_action row anywhere — the replacement is clean, not an addition alongside the old shape.
    expect(await db.select().from(auditEvents).where(eq(auditEvents.eventType, "admin_action"))).toEqual([]);
  });

  it("refuses, honestly, a member who is not excluded — no audit event, nothing changed", async () => {
    await seedUser("u_op");
    await seedUser("u1");

    const result = await clearSelfExclusion(db, { userId: "u1", operatorUserId: "u_op", clock: at(NOW), audit: logger });
    expect(result).toEqual({ ok: false, reason: '"u1" is not a user, or is not excluded.' });

    const events = await db.select().from(auditEvents);
    expect(events).toHaveLength(0);
  });

  it("refuses, the same way, a userId that does not exist at all", async () => {
    await seedUser("u_op");
    const result = await clearSelfExclusion(db, { userId: "u_never_seen", operatorUserId: "u_op", clock: at(NOW), audit: logger });
    expect(result).toEqual({ ok: false, reason: '"u_never_seen" is not a user, or is not excluded.' });
  });

  it("defaults clock and audit when not supplied, so a caller need not thread either through", async () => {
    await seedUser("u_op");
    await seedUser("u1");
    await setSelfExclusion(db, "u1", at(NOW), logger);

    const result = await clearSelfExclusion(db, { userId: "u1", operatorUserId: "u_op" });
    expect(result).toEqual({ ok: true });
  });
});
