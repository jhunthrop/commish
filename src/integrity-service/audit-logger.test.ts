import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { auditChains, auditEvents, leagues, users } from "@/db/schema";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { AuditEventInput } from "@/domain/audit";
import { GENESIS_HASH, computeEventHash } from "@/integrity/chain";
import { createAuditLogger } from "./audit-logger";

const db = createTestDb();
/** A SECOND pool, so a test can hold one transaction open and race another against it. */
const other = createTestDb();

let counter = 0;
const logger = createAuditLogger({ newId: () => `evt_${(counter += 1)}` });

const input = (over: Partial<AuditEventInput> = {}): AuditEventInput => ({
  eventType: "league_created",
  actorId: "user_alice",
  actorType: "user",
  leagueId: "league_1",
  payload: { name: "Sunday Money" },
  occurredAt: "2026-08-20T17:00:00.000Z",
  ...over,
});

beforeEach(async () => {
  await truncateAll(db);
  counter = 0;
});

describe("AuditLogger.record", () => {
  it("starts a league's chain at genesis and advances its anchor in the same transaction", async () => {
    const event = await db.transaction((tx) => logger.record(tx, input()));

    expect(event).toMatchObject({ chainScope: "league_1", sequence: 1, previousEventHash: GENESIS_HASH });
    const [anchor] = await db.select().from(auditChains).where(eq(auditChains.scope, "league_1"));
    expect(anchor).toMatchObject({ headSequence: 1, headHash: event.eventHash });
  });

  it("links the second event to the first", async () => {
    const first = await db.transaction((tx) => logger.record(tx, input()));
    const second = await db.transaction((tx) => logger.record(tx, input({ eventType: "member_joined" })));
    expect(second.previousEventHash).toBe(first.eventHash);
    expect(second.sequence).toBe(2);
  });

  it("puts a league-less event on the platform chain, and keeps the two apart", async () => {
    await db.transaction((tx) => logger.record(tx, input()));
    const session = await db.transaction((tx) =>
      logger.record(tx, input({ eventType: "session_started", leagueId: null, payload: {} })),
    );
    expect(session).toMatchObject({ chainScope: "platform", sequence: 1, previousEventHash: GENESIS_HASH });
  });

  it("re-hashes to the stored digest after a Postgres round trip, for every shape a payload can take", async () => {
    // THE test the canonical encoder exists for. If jsonb key reordering, timestamptz precision
    // or float representation ever changed the bytes, verification would start failing on rows
    // nobody edited, and this is where that is caught.
    const payload = {
      zebra: "last alphabetically, first in insertion order",
      nested: { z: [1, 2.5, -0.5, { b: false, a: null }], a: "" },
      unicode: "héllo 🏈 \" \\ \n",
      empties: { obj: {}, arr: [] },
      big: 9007199254740991,
    };
    const written = await db.transaction((tx) =>
      logger.record(tx, input({ payload, occurredAt: "2026-08-20T19:00:00.123456+02:00" })),
    );

    const [row] = await db.select().from(auditEvents).where(eq(auditEvents.eventId, written.eventId));
    expect(row).toBeDefined();
    expect(
      computeEventHash({
        eventId: row!.eventId,
        chainScope: row!.chainScope,
        sequence: row!.sequence,
        eventType: row!.eventType,
        actorId: row!.actorId,
        actorType: row!.actorType,
        leagueId: row!.leagueId,
        payload: row!.payload,
        occurredAt: row!.occurredAt.toISOString(),
        previousEventHash: row!.previousEventHash,
        hashVersion: row!.hashVersion,
      }),
    ).toBe(row!.eventHash);
  });

  it("refuses a payload it cannot hash, before anything is written", async () => {
    await expect(
      db.transaction((tx) => logger.record(tx, input({ payload: { when: new Date() } as never }))),
    ).rejects.toThrow(/cannot be hashed/);
    expect(await db.select().from(auditEvents)).toHaveLength(0);
    expect(await db.select().from(auditChains)).toHaveLength(0);
  });
});

describe("AuditLogger.recordAll", () => {
  it("writes a linked run under one anchor lock", async () => {
    const events = await db.transaction((tx) =>
      logger.recordAll(tx, [input(), input({ eventType: "member_joined" }), input({ eventType: "draft_pick" })]),
    );
    expect(events.map((e) => e.sequence)).toEqual([1, 2, 3]);
    expect(events[1]!.previousEventHash).toBe(events[0]!.eventHash);
    expect(events[2]!.previousEventHash).toBe(events[1]!.eventHash);
    const [anchor] = await db.select().from(auditChains).where(eq(auditChains.scope, "league_1"));
    expect(anchor).toMatchObject({ headSequence: 3, headHash: events[2]!.eventHash });
  });

  it("writes nothing for an empty batch, and takes no lock", async () => {
    const events = await db.transaction((tx) => logger.recordAll(tx, []));
    expect(events).toEqual([]);
    expect(await db.select().from(auditChains)).toHaveLength(0);
  });

  it("refuses a batch that spans two chains", async () => {
    // Ruling 3: one transaction appends to at most one chain, so two transactions can never
    // take two anchor locks in opposite orders. This is where that becomes unfailable.
    await expect(
      db.transaction((tx) => logger.recordAll(tx, [input(), input({ leagueId: "league_2" })])),
    ).rejects.toThrow(/one chain/);
  });
});

describe("the same-transaction contract", () => {
  it("loses the audit event when the caller's transaction rolls back", async () => {
    await db.insert(users).values({ id: "user_alice", email: "a@example.com", displayName: "Alice" });
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(leagues).values({
          id: "league_1", name: "Sunday Money", format: "snake", teamCount: 12, commissionerUserId: "user_alice",
        });
        await logger.record(tx, input());
        throw new Error("the business write failed after the audit append");
      }),
    ).rejects.toThrow(/business write failed/);

    expect(await db.select().from(leagues)).toHaveLength(0);
    expect(await db.select().from(auditEvents)).toHaveLength(0);
    expect(await db.select().from(auditChains)).toHaveLength(0);
  });

  it("fails the business write when the audit append fails, which is the opposite of publishing", async () => {
    // conventions.md: publishing is best-effort and must never fail the write. An audit event is
    // the reverse: a write nobody recorded is worse than a write that did not happen.
    await db.insert(users).values({ id: "user_alice", email: "a@example.com", displayName: "Alice" });
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(leagues).values({
          id: "league_1", name: "Sunday Money", format: "snake", teamCount: 12, commissionerUserId: "user_alice",
        });
        await logger.record(tx, input({ payload: { bad: Number.NaN } as never }));
      }),
    ).rejects.toThrow(/cannot be hashed/);
    expect(await db.select().from(leagues)).toHaveLength(0);
  });
});

describe("concurrency", () => {
  it("serializes two appends to the SAME chain into a gapless, linked run", async () => {
    // Both transactions are in flight before either commits: `held` opens, appends, and waits;
    // `racer` blocks on the anchor row until `held` commits, then reads the new head.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));

    const held = db.transaction(async (tx) => {
      const first = await logger.record(tx, input());
      await gate;
      return first;
    });
    const racer = other.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
      return logger.record(tx, input({ eventType: "member_joined" }));
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    release();
    const [first, second] = await Promise.all([held, racer]);

    expect([first.sequence, second.sequence].sort()).toEqual([1, 2]);
    const rows = await db.select().from(auditEvents).orderBy(auditEvents.sequence);
    expect(rows[1]!.previousEventHash).toBe(rows[0]!.eventHash);
  });

  it("does NOT let one league's append block another league's, which is why the chain is per league", async () => {
    // The matched pair for the ruling. Same setup as above, different scope, and a statement
    // timeout short enough that blocking would fail the test rather than slow it.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const held = db.transaction(async (tx) => {
      await logger.record(tx, input({ leagueId: "league_1" }));
      await gate;
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    const elsewhere = await other.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '2s'`);
      return logger.record(tx, input({ leagueId: "league_2" }));
    });
    expect(elsewhere).toMatchObject({ chainScope: "league_2", sequence: 1 });

    release();
    await held;
  });
});
