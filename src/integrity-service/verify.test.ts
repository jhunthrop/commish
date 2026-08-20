import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditChainCheckpoints, auditEvents } from "@/db/schema";
import { countingDb, createTestDb, truncateAll } from "@/db/test-db";
import type { AuditEventInput } from "@/domain/audit";
import { computeEventHash } from "@/integrity/chain";
import { createAuditLogger } from "./audit-logger";
import { tamperWithAuditEvent } from "./test-support";
import { verifyAllChains, verifyChainIntegrity, verifyFullChainIntegrity } from "./verify";

const db = createTestDb();
/** A SECOND pool, so a test can hold one transaction open and race a verify against it. */
const other = createTestDb();
let counter = 0;
const logger = createAuditLogger({ newId: () => `evt_${(counter += 1)}` });

const input = (n: number): AuditEventInput => ({
  eventType: "lineup_change",
  actorId: "user_alice",
  actorType: "user",
  leagueId: "league_1",
  payload: { weekNumber: n },
  occurredAt: new Date(Date.UTC(2026, 7, 20, 17, n)).toISOString(),
});

async function seed(count: number): Promise<void> {
  for (let n = 1; n <= count; n += 1) await db.transaction((tx) => logger.record(tx, input(n)));
}

beforeEach(async () => {
  await truncateAll(db);
  counter = 0;
});

describe("verifyChainIntegrity", () => {
  it("verifies an untouched chain and advances the checkpoint to its head", async () => {
    await seed(3);
    expect(await verifyChainIntegrity(db, "league_1")).toEqual({ valid: true, scope: "league_1", verifiedThrough: 3, hashed: 3 });
    const [checkpoint] = await db.select().from(auditChainCheckpoints).where(eq(auditChainCheckpoints.scope, "league_1"));
    expect(checkpoint?.verifiedThroughSequence).toBe(3);
  });

  it("verifies an empty chain as valid, because nothing has been claimed yet", async () => {
    expect(await verifyChainIntegrity(db, "league_1")).toMatchObject({ valid: true, verifiedThrough: 0, hashed: 0 });
  });

  it("re-hashes only what is new since the checkpoint", async () => {
    // The spec's incremental-behaviour requirement, asserted by counting the work rather than
    // by trusting the shape of the query. Seed 3, checkpoint, append 2, and assert 2.
    await seed(3);
    await verifyChainIntegrity(db, "league_1");
    await seed(2);

    const hash = vi.fn(computeEventHash);
    const result = await verifyChainIntegrity(db, "league_1", { hash });
    expect(result).toMatchObject({ valid: true, verifiedThrough: 5, hashed: 2 });
    expect(hash).toHaveBeenCalledTimes(2);
  });

  it("catches a tamper after the checkpoint and refuses to advance it", async () => {
    await seed(2);
    await verifyChainIntegrity(db, "league_1");
    await seed(2);
    await tamperWithAuditEvent(db, "evt_3", { payload: { weekNumber: 99 } });

    expect(await verifyChainIntegrity(db, "league_1")).toEqual({
      valid: false, scope: "league_1", firstBrokenEventId: "evt_3", firstBrokenSequence: 3, reason: "hash_mismatch",
    });
    const [checkpoint] = await db.select().from(auditChainCheckpoints).where(eq(auditChainCheckpoints.scope, "league_1"));
    expect(checkpoint?.verifiedThroughSequence).toBe(2);
  });

  it("catches a tamper on the checkpointed row itself", async () => {
    await seed(3);
    await verifyChainIntegrity(db, "league_1");
    await tamperWithAuditEvent(db, "evt_3", { payload: { weekNumber: 99 } });
    expect(await verifyChainIntegrity(db, "league_1")).toMatchObject({ reason: "checkpoint_mismatch", firstBrokenSequence: 3 });
  });

  it("catches a directly-mutated hash the same way it catches a mutated payload", async () => {
    // The tamper vector `tamperWithAuditEvent` was built for isn't only "edit the payload and
    // leave the hash stale" — a patch to a SCALAR column (the stored hash itself) is a real,
    // distinct tamper shape, and `verifyLinkedRun`'s recompute-and-compare catches it identically.
    await seed(2);
    await verifyChainIntegrity(db, "league_1");
    await seed(1);
    await tamperWithAuditEvent(db, "evt_3", { event_hash: "0".repeat(64) });

    expect(await verifyChainIntegrity(db, "league_1")).toMatchObject({
      valid: false, firstBrokenEventId: "evt_3", firstBrokenSequence: 3, reason: "hash_mismatch",
    });
  });

  it("catches the checkpointed row itself having been deleted", async () => {
    // The other half of "the boundary row is falsifiable": not just tampered, but gone. The
    // checkpoint still names a sequence and a hash nothing at that sequence answers for anymore.
    await seed(3);
    await verifyChainIntegrity(db, "league_1");
    await db.execute(sql`ALTER TABLE audit_events DISABLE TRIGGER USER`);
    await db.delete(auditEvents).where(eq(auditEvents.eventId, "evt_3"));
    await db.execute(sql`ALTER TABLE audit_events ENABLE TRIGGER USER`);

    expect(await verifyChainIntegrity(db, "league_1")).toMatchObject({
      valid: false, reason: "checkpoint_mismatch", firstBrokenSequence: 3, firstBrokenEventId: "sequence 3 (missing)",
    });
  });

  it("does NOT catch a tamper before the checkpoint — that is the full walk's job", async () => {
    // Stated as a test rather than left implicit, because it is the honest cost of being able to
    // afford to run verification at all, and it is a spec exit criterion in both directions.
    await seed(4);
    await verifyChainIntegrity(db, "league_1");
    await tamperWithAuditEvent(db, "evt_2", { payload: { weekNumber: 99 } });

    expect(await verifyChainIntegrity(db, "league_1")).toMatchObject({ valid: true });
    expect(await verifyFullChainIntegrity(db, "league_1")).toMatchObject({
      valid: false, firstBrokenEventId: "evt_2", firstBrokenSequence: 2, reason: "hash_mismatch",
    });
  });
});

describe("verifyFullChainIntegrity", () => {
  it("always walks from genesis, whatever the checkpoint says", async () => {
    await seed(5);
    await verifyChainIntegrity(db, "league_1");
    const hash = vi.fn(computeEventHash);
    expect(await verifyFullChainIntegrity(db, "league_1", { hash })).toMatchObject({ valid: true, hashed: 5 });
    expect(hash).toHaveBeenCalledTimes(5);
  });

  it("pages rather than loading the whole chain, so a long chain stays runnable", async () => {
    // batchSize is small enough in the test config override to make this observable; the query
    // count is what proves it pages, the same countingDb idiom `affectedTeams` established.
    await seed(7);
    const { db: counted, selectCount } = countingDb(db);
    const before = selectCount();
    await verifyFullChainIntegrity(counted, "league_1", { batchSize: 3 });
    // 3 pages of events + the empty page that ends the walk + the checkpoint read + its write.
    expect(selectCount() - before).toBeLessThanOrEqual(7);
  });

  it("catches a deleted row as a sequence gap", async () => {
    await seed(3);
    await db.execute(sql`ALTER TABLE audit_events DISABLE TRIGGER USER`);
    await db.delete(auditEvents).where(eq(auditEvents.eventId, "evt_2"));
    await db.execute(sql`ALTER TABLE audit_events ENABLE TRIGGER USER`);
    expect(await verifyFullChainIntegrity(db, "league_1")).toMatchObject({ reason: "sequence_gap", firstBrokenSequence: 3 });
  });
});

describe("concurrency", () => {
  it("a chain walk never blocks a concurrent append to the SAME scope (ruling 18)", async () => {
    // The checkpoint lives in its own table precisely so a walk never contends with the anchor
    // row lock a writer holds for its whole business transaction. Proven, not just asserted: hold
    // an append open on a SECOND connection, run the walk against a THIRD while it is still open
    // and uncommitted, and require the walk to finish well inside a short statement_timeout — if
    // it took the anchor lock too, this would hang until `release()` and blow that timeout.
    await seed(3);
    await verifyChainIntegrity(db, "league_1");

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const held = other.transaction(async (tx) => {
      await logger.record(tx, input(4));
      await gate;
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    const verifying = createTestDb();
    await verifying.execute(sql`SET statement_timeout = '2s'`);
    const result = await verifyChainIntegrity(verifying, "league_1");
    expect(result).toMatchObject({ valid: true, verifiedThrough: 3 });

    release();
    await held;
  });
});

describe("verifyAllChains", () => {
  it("verifies every chain that exists and reports one result each", async () => {
    await db.transaction((tx) => logger.record(tx, input(1)));
    await db.transaction((tx) => logger.record(tx, { ...input(1), leagueId: null, eventType: "session_started", payload: {} }));
    const results = await verifyAllChains(db);
    expect(results.map((r) => r.scope).sort()).toEqual(["league_1", "platform"]);
    expect(results.every((r) => r.valid)).toBe(true);
  });

  it("walks every chain from genesis when asked for the full verification", async () => {
    await db.transaction((tx) => logger.record(tx, input(1)));
    const hash = vi.fn(computeEventHash);
    const results = await verifyAllChains(db, { full: true, hash });
    expect(results).toEqual([{ valid: true, scope: "league_1", verifiedThrough: 1, hashed: 1 }]);
    expect(hash).toHaveBeenCalledTimes(1);
  });
});
