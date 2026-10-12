import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditChainCheckpoints, auditChains, auditEvents } from "@/db/schema";
import { countingDb, createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import type { AuditEventInput } from "@/domain/audit";
import { computeEventHash } from "@/integrity/chain";
import { createAuditLogger } from "./audit-logger";
import { deleteAuditCheckpoint, deleteAuditEvent, deleteAuditEventsFrom, tamperWithAuditEvent } from "./test-support";
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
    await deleteAuditEvent(db, "evt_3");

    expect(await verifyChainIntegrity(db, "league_1")).toMatchObject({
      valid: false, reason: "checkpoint_mismatch", firstBrokenSequence: 3, firstBrokenEventId: "sequence 3 (missing)",
    });
  });

  it("degrades safely to a full walk when the checkpoint row itself is gone, and mints a fresh one", async () => {
    // Losing the checkpoint is not a break in the chain, it is amnesia about how far verification
    // got. `verifyChainIntegrity` already treats "no checkpoint row" as "never verified" (the
    // `checkpoint === undefined` branch), so this walks from genesis exactly like the very first
    // run and writes a brand new row. Since migration 0021 the delete itself takes table
    // ownership (`deleteAuditCheckpoint`) — see the tamper suite below for why that matters.
    await seed(3);
    await verifyChainIntegrity(db, "league_1");
    await deleteAuditCheckpoint(db, "league_1");

    const hash = vi.fn(computeEventHash);
    const result = await verifyChainIntegrity(db, "league_1", { hash });
    expect(result).toEqual({ valid: true, scope: "league_1", verifiedThrough: 3, hashed: 3 });
    expect(hash).toHaveBeenCalledTimes(3); // resumed from nothing, not from the deleted checkpoint's stale position

    const [checkpoint] = await db.select().from(auditChainCheckpoints).where(eq(auditChainCheckpoints.scope, "league_1"));
    expect(checkpoint?.verifiedThroughSequence).toBe(3);
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
    // 7 events at batchSize 3 is 3 page reads (events 1-3, 4-6, then 7 — that last page is
    // SHORTER than batchSize, which ends the walk immediately with no trailing empty-page fetch)
    // plus the checkpoint's one upsert write: 4 queries. `verifyFullChainIntegrity` never reads
    // an existing checkpoint (it always walks from genesis), so there is no checkpoint READ to
    // count here, only the write. The bound below is left generous rather than pinned to exactly
    // 4, so a harmless future change in query shape doesn't turn this into a brittle assertion —
    // what it must never do is scale with the number of EVENTS, which loading the whole chain
    // in one shot would.
    expect(selectCount() - before).toBeLessThanOrEqual(7);
  });

  it("catches a deleted row as a sequence gap", async () => {
    await seed(3);
    await deleteAuditEvent(db, "evt_2");
    expect(await verifyFullChainIntegrity(db, "league_1")).toMatchObject({ reason: "sequence_gap", firstBrokenSequence: 3 });
  });
});

/**
 * THE DELETION SUITE. Every scenario here was proven UNDETECTED by the final whole-branch review
 * against this same test Postgres: the verifier walked rows, the rows that remained linked
 * perfectly to each other, and nothing ever asked the chain how many rows there were supposed to
 * be. `--full`, the command the README recommends and the closing evidence cited, reported `ok`
 * on a chain with zero rows left in it.
 *
 * Every one of them is an accusation now, and each test states which of the three accounts
 * (walked rows, `audit_chains`, `audit_chain_checkpoints`) is the one that catches it.
 */
describe("deletion, the class a walk over surviving rows cannot see by itself", () => {
  /** The anchor as an adversary would leave it after erasing the tail: rewound to match. */
  async function rewindAnchorTo(scope: string, sequence: number): Promise<void> {
    const [row] = await db.select().from(auditEvents).where(eq(auditEvents.sequence, sequence));
    await db.update(auditChains).set({ headSequence: sequence, headHash: row!.eventHash }).where(eq(auditChains.scope, scope));
  }

  it("catches an un-checkpointed tail deletion, because the anchor still swears to the count", async () => {
    // Review case A, first half: sequences 4 and 5 erased, anchor untouched. The surviving 1..3
    // are a flawless linked run; only `audit_chains` remembers there were five.
    await seed(5);
    const [erasedHead] = await db.select().from(auditEvents).where(eq(auditEvents.eventId, "evt_5"));
    const [survivingHead] = await db.select().from(auditEvents).where(eq(auditEvents.eventId, "evt_3"));
    await deleteAuditEventsFrom(db, "league_1", 4);

    // Both numbers in the accusation, because "the anchor is ahead by two" and "the anchor is
    // behind by two" are different incidents and an operator has to be able to tell them apart.
    const accusation = `audit_chains claims 5 event(s) ending ${erasedHead!.eventHash}; the walk found 3 ending ${survivingHead!.eventHash}`;
    for (const result of [await verifyFullChainIntegrity(db, "league_1"), await verifyChainIntegrity(db, "league_1")]) {
      expect(result).toEqual({
        valid: false, scope: "league_1", firstBrokenEventId: accusation, firstBrokenSequence: 4, reason: "anchor_mismatch",
      });
    }
  });

  it("catches an un-checkpointed tail deletion WITH the anchor rewound to match, through the frozen checkpoint", async () => {
    // Review case A in full: the adversary covers their tracks by rewinding `audit_chains` to the
    // surviving tail, so the rows and the anchor agree with each other. The checkpoint frozen by
    // an earlier honest run is the third account, and it says five.
    await seed(5);
    await verifyChainIntegrity(db, "league_1"); // freezes the checkpoint at 5
    await deleteAuditEventsFrom(db, "league_1", 4);
    await rewindAnchorTo("league_1", 3);

    // The full walk is the one that used to be blind here: it deliberately ignores the checkpoint
    // as a starting point, so before this fix it walked 1..3, agreed with the rewound anchor and
    // reported ok. It now cross-checks the frozen checkpoint against the anchor.
    expect(await verifyFullChainIntegrity(db, "league_1")).toEqual({
      valid: false,
      scope: "league_1",
      firstBrokenEventId: "audit_chain_checkpoints froze 5 verified event(s); audit_chains now claims only 3",
      firstBrokenSequence: 4,
      reason: "anchor_mismatch",
    });
    // The incremental walk catches the same tamper one row earlier, at its own boundary check.
    expect(await verifyChainIntegrity(db, "league_1")).toMatchObject({ valid: false, reason: "checkpoint_mismatch", firstBrokenSequence: 5 });
  });

  it("catches the deletion of an ENTIRE chain, which --full used to bless", async () => {
    // Review case B: seed 5, verify, delete every row. `verifyFullChainIntegrity` returned
    // `{ valid: true, verifiedThrough: 0, hashed: 0 }` — the strongest check the product has,
    // reporting ok on a chain with nothing in it.
    await seed(5);
    await verifyChainIntegrity(db, "league_1");
    await deleteAuditEventsFrom(db, "league_1", 1);

    expect(await verifyFullChainIntegrity(db, "league_1")).toMatchObject({
      valid: false, scope: "league_1", reason: "anchor_mismatch", firstBrokenSequence: 1,
    });
    expect(await verifyChainIntegrity(db, "league_1")).toMatchObject({ valid: false, reason: "checkpoint_mismatch" });
  });

  it("catches the deletion of an entire chain WITH its checkpoint, where every check used to report green", async () => {
    // Review case C, and the worst of the three: with the checkpoint gone too, BOTH walks
    // returned `{ valid: true, verifiedThrough: 0 }`. It is also the path Task 4 had ledgered as
    // a good property ("checkpoint-row deletion degrades to a full walk") — degrading to the full
    // walk was how the detector got removed. The anchor is what answers now.
    await seed(5);
    await verifyChainIntegrity(db, "league_1");
    await deleteAuditEventsFrom(db, "league_1", 1);
    await deleteAuditCheckpoint(db, "league_1");

    for (const result of [await verifyFullChainIntegrity(db, "league_1"), await verifyChainIntegrity(db, "league_1")]) {
      expect(result).toMatchObject({ valid: false, scope: "league_1", reason: "anchor_mismatch", firstBrokenSequence: 1 });
    }
  });

  it("catches an anchor whose head hash was rewritten, without a single row being touched", async () => {
    // The anchor and the walk agree on the COUNT and disagree on the hash: the divergence is that
    // one row, not the row after it. A re-hash-from-a-point attack ends with this edit.
    await seed(3);
    await db.update(auditChains).set({ headHash: "0".repeat(64) }).where(eq(auditChains.scope, "league_1"));

    expect(await verifyFullChainIntegrity(db, "league_1")).toMatchObject({
      valid: false, reason: "anchor_mismatch", firstBrokenSequence: 3,
    });
  });

  it("refuses to advance the checkpoint on an anchor mismatch, so the accusation survives the next run", async () => {
    await seed(5);
    await verifyChainIntegrity(db, "league_1");
    await deleteAuditEventsFrom(db, "league_1", 4);

    await verifyFullChainIntegrity(db, "league_1");
    const [checkpoint] = await db.select().from(auditChainCheckpoints).where(eq(auditChainCheckpoints.scope, "league_1"));
    expect(checkpoint?.verifiedThroughSequence).toBe(5);
  });

  it("still reads an untouched chain as valid, so the reconciliation accuses nothing that is fine", async () => {
    // The other direction of the same claim: three honest runs in a row, each re-freezing the
    // checkpoint at the anchor's own head, never once tripping the cross-check.
    await seed(4);
    expect(await verifyChainIntegrity(db, "league_1")).toMatchObject({ valid: true, verifiedThrough: 4 });
    expect(await verifyFullChainIntegrity(db, "league_1")).toMatchObject({ valid: true, verifiedThrough: 4 });
    expect(await verifyChainIntegrity(db, "league_1")).toMatchObject({ valid: true, verifiedThrough: 4 });
  });
});

describe("the checkpoint the verifier freezes is one the database itself protects (migration 0021)", () => {
  it("re-freezes cleanly whether the chain moved on or stood still, which is every write the verifier makes", async () => {
    // The forward-only trigger is asserted directly in `src/db/audit-append-only.test.ts`; what
    // this pins is that the verifier's own freeze pattern never trips it — a standing-still
    // re-verify writes the same sequence back, and that has to keep working.
    await seed(2);
    await verifyChainIntegrity(db, "league_1");
    await verifyChainIntegrity(db, "league_1");
    await seed(1);
    expect(await verifyChainIntegrity(db, "league_1")).toMatchObject({ valid: true, verifiedThrough: 3 });
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
    let announceHeld: () => void = () => {};
    const anchorHeld = new Promise<void>((resolve) => (announceHeld = resolve));
    const held = other.transaction(async (tx) => {
      await logger.record(tx, input(4));
      // The holder says when it holds, rather than the test guessing with a sleep: `record` has
      // returned, so `lockAnchor`'s SELECT ... FOR UPDATE holds that row for the rest of this
      // transaction. A `setTimeout` here could let the walk run before the lock existed, which is
      // the test passing against no contention at all.
      announceHeld();
      await gate;
    });

    await anchorHeld;
    const verifying = createTestDb();
    await verifying.execute(sql`SET statement_timeout = '2s'`);
    const result = await verifyChainIntegrity(verifying, "league_1");
    expect(result).toMatchObject({ valid: true, verifiedThrough: 3 });

    release();
    await held;
  });
});

describe("ruling 8: detecting a tamper is itself auditable, even on the chain that caught it", () => {
  it("still records a system_action on a corrupt platform chain, without masking the break it is reporting", async () => {
    await db.transaction((tx) => logger.record(tx, { ...input(1), leagueId: null, eventType: "session_started", payload: {} }));
    await tamperWithAuditEvent(db, "evt_1", { payload: { tampered: true } });

    const before = await verifyChainIntegrity(db, "platform");
    expect(before).toMatchObject({
      valid: false, scope: "platform", firstBrokenEventId: "evt_1", firstBrokenSequence: 1, reason: "hash_mismatch",
    });

    // scripts/verify-audit-chain.ts's recordDetection appends exactly this shape to the SAME
    // (still-corrupt) scope on a failure. AuditLogger only cares about the anchor row's live
    // head — untouched by the tamper — so the append is not blocked by, and does not retroactively
    // paper over, the break it is reporting: a fresh verify still finds the same original break.
    const recorded = await db.transaction((tx) =>
      logger.record(tx, {
        ...input(2), leagueId: null, eventType: "system_action",
        payload: { action: "chain_verification_failed", scopes: ["platform"] },
      }),
    );
    expect(recorded).toMatchObject({ chainScope: "platform", sequence: 2 });

    const after = await verifyChainIntegrity(db, "platform");
    expect(after).toMatchObject({
      valid: false, scope: "platform", firstBrokenEventId: "evt_1", firstBrokenSequence: 1, reason: "hash_mismatch",
    });
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
