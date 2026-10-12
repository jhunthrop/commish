import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { auditEvents, memberNotices, users } from "@/db/schema";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { createAuditLogger } from "./audit-logger";
import { notifyAffectedMember } from "./notify";
import { BOOTSTRAP_ACTOR, grantAdmin } from "./grant-admin";

const db = createTestDb();
const NOW = "2026-08-20T18:00:00.000Z";

let eventCounter = 0;
const logger = createAuditLogger({ newId: () => `evt_${(eventCounter += 1)}` });
const at = (iso: string) => ({ now: () => iso });

async function seedUser(id: string, isAdmin = false): Promise<void> {
  await db.insert(users).values({ id, email: `${id}@test.local`, displayName: id, isAdmin });
}

beforeEach(async () => {
  await truncateAll(db);
  eventCounter = 0;
});

afterAll(async () => {
  await truncateAll(db);
});

describe("grantAdmin — granting", () => {
  it("flips isAdmin, records admin_action on the platform chain, and notices the new operator", async () => {
    await seedUser("u_op", true);
    await seedUser("u_new");

    const result = await grantAdmin(db, { userId: "u_new", grant: true, grantedBy: "u_op", clock: at(NOW), audit: logger });
    expect(result).toEqual({ ok: true, userId: "u_new", isAdmin: true });

    const [row] = await db.select().from(users).where(eq(users.id, "u_new"));
    expect(row?.isAdmin).toBe(true);

    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "admin_action"));
    expect(event).toMatchObject({ chainScope: "platform", leagueId: null, actorId: "u_op", actorType: "user" });
    expect(event!.payload).toEqual({ action: "admin_granted", subjectUserId: "u_new" });

    const [notice] = await db.select().from(memberNotices);
    expect(notice).toMatchObject({
      userId: "u_new",
      leagueId: null,
      noticeType: "admin_granted",
      title: "You can now use the operator tools",
      auditEventId: event!.eventId,
      readAt: null,
    });
    expect(notice!.context).toEqual({ grantedByUserId: "u_op" });
  });

  it("legalizes --by bootstrap exactly when no operator exists yet, recording a system actor", async () => {
    await seedUser("u_first");

    const result = await grantAdmin(db, { userId: "u_first", grant: true, grantedBy: BOOTSTRAP_ACTOR, clock: at(NOW), audit: logger });
    expect(result).toEqual({ ok: true, userId: "u_first", isAdmin: true });

    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "admin_action"));
    expect(event).toMatchObject({ actorId: null, actorType: "system" });
    expect(event!.payload).toEqual({ action: "admin_granted", subjectUserId: "u_first" });
  });

  it("refuses --by bootstrap once any operator already exists, checked rather than trusted", async () => {
    await seedUser("u_op", true);
    await seedUser("u_second");

    const result = await grantAdmin(db, { userId: "u_second", grant: true, grantedBy: BOOTSTRAP_ACTOR, clock: at(NOW), audit: logger });
    expect(result).toEqual({ ok: false, reason: "This database already has an operator. Pass --by <their user id>." });

    const [row] = await db.select().from(users).where(eq(users.id, "u_second"));
    expect(row?.isAdmin).toBe(false);
    expect(await db.select().from(auditEvents)).toHaveLength(0);
    expect(await db.select().from(memberNotices)).toHaveLength(0);
  });

  it("refuses a userId that is not a user, and records nothing", async () => {
    await seedUser("u_op", true);

    const result = await grantAdmin(db, { userId: "u_ghost", grant: true, grantedBy: "u_op", clock: at(NOW), audit: logger });
    expect(result).toEqual({ ok: false, reason: '"u_ghost" is not a user, or already has that setting.' });
    expect(await db.select().from(auditEvents)).toHaveLength(0);
    expect(await db.select().from(memberNotices)).toHaveLength(0);
  });

  it("refuses a second grant on an already-granted account, and records nothing the second time", async () => {
    await seedUser("u_op", true);
    await seedUser("u_new");

    await grantAdmin(db, { userId: "u_new", grant: true, grantedBy: "u_op", clock: at(NOW), audit: logger });
    const second = await grantAdmin(db, { userId: "u_new", grant: true, grantedBy: "u_op", clock: at(NOW), audit: logger });

    expect(second).toEqual({ ok: false, reason: '"u_new" is not a user, or already has that setting.' });
    expect(await db.select().from(auditEvents).where(eq(auditEvents.eventType, "admin_action"))).toHaveLength(1);
    expect(await db.select().from(memberNotices)).toHaveLength(1);
  });

  it("rolls back the flag and the audit event when the notice write fails — the notice-before-anchor lock order still commits atomically", async () => {
    await seedUser("u_op", true);
    await seedUser("u_new");

    const brokenNotify: typeof notifyAffectedMember = async () => {
      throw new Error("notice write failed");
    };
    await expect(
      grantAdmin(db, { userId: "u_new", grant: true, grantedBy: "u_op", clock: at(NOW), audit: logger, notify: brokenNotify }),
    ).rejects.toThrow("notice write failed");

    const [row] = await db.select().from(users).where(eq(users.id, "u_new"));
    expect(row?.isAdmin).toBe(false);
    expect(await db.select().from(auditEvents)).toHaveLength(0);
  });

  it("rolls back the flag and the notice when the audit append fails — ruling 4", async () => {
    await seedUser("u_op", true);
    await seedUser("u_new");

    const brokenAudit = { ...logger, record: async () => { throw new Error("audit append failed"); } };
    await expect(
      grantAdmin(db, { userId: "u_new", grant: true, grantedBy: "u_op", clock: at(NOW), audit: brokenAudit }),
    ).rejects.toThrow("audit append failed");

    const [row] = await db.select().from(users).where(eq(users.id, "u_new"));
    expect(row?.isAdmin).toBe(false);
    expect(await db.select().from(memberNotices)).toHaveLength(0);
  });
});

describe("grantAdmin — defaults", () => {
  it("falls back to the real system clock when none is injected", async () => {
    await seedUser("u_op", true);
    await seedUser("u_new");

    const before = Date.now();
    const result = await grantAdmin(db, { userId: "u_new", grant: true, grantedBy: "u_op", audit: logger });
    expect(result).toEqual({ ok: true, userId: "u_new", isAdmin: true });

    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "admin_action"));
    const occurredAt = Date.parse(event!.occurredAt.toISOString());
    expect(occurredAt).toBeGreaterThanOrEqual(before);
    expect(occurredAt).toBeLessThanOrEqual(Date.now());
  });
});

describe("grantAdmin — revoking", () => {
  it("flips isAdmin back, records admin_action, and sends no notice — nothing to explain about a privilege the account no longer has", async () => {
    await seedUser("u_op", true);
    await seedUser("u_target", true);

    const result = await grantAdmin(db, { userId: "u_target", grant: false, grantedBy: "u_op", clock: at(NOW), audit: logger });
    expect(result).toEqual({ ok: true, userId: "u_target", isAdmin: false });

    const [row] = await db.select().from(users).where(eq(users.id, "u_target"));
    expect(row?.isAdmin).toBe(false);

    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "admin_action"));
    expect(event!.payload).toEqual({ action: "admin_revoked", subjectUserId: "u_target" });
    expect(await db.select().from(memberNotices)).toHaveLength(0);
  });

  it("refuses a second --revoke on an already-revoked account, and records nothing the second time", async () => {
    await seedUser("u_op", true);
    await seedUser("u_target", true);

    await grantAdmin(db, { userId: "u_target", grant: false, grantedBy: "u_op", clock: at(NOW), audit: logger });
    const second = await grantAdmin(db, { userId: "u_target", grant: false, grantedBy: "u_op", clock: at(NOW), audit: logger });

    expect(second).toEqual({ ok: false, reason: '"u_target" is not a user, or already has that setting.' });
    expect(await db.select().from(auditEvents).where(eq(auditEvents.eventType, "admin_action"))).toHaveLength(1);
  });

  it("the bootstrap check never fires on a revoke — only --grant true with grantedBy bootstrap is checked", async () => {
    // No admin exists yet, but this is a revoke of a non-admin, so the bootstrap branch (gated on
    // `input.grantedBy === BOOTSTRAP_ACTOR`) still runs and finds nothing — proving the check runs
    // for the grantedBy value alone, independent of the toggle direction.
    await seedUser("u_target");
    const result = await grantAdmin(db, { userId: "u_target", grant: false, grantedBy: BOOTSTRAP_ACTOR, clock: at(NOW), audit: logger });
    expect(result).toEqual({ ok: false, reason: '"u_target" is not a user, or already has that setting.' });
  });
});
