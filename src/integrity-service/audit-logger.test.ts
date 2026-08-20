import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { DbTx } from "@/db/client";
import { auditChains, auditEvents, leagues, users } from "@/db/schema";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { AuditEventInput } from "@/domain/audit";
import { GENESIS_HASH, computeEventHash } from "@/integrity/chain";
import { createAuditLogger, getAuditLogger } from "./audit-logger";

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
  /**
   * Waits until Postgres reports somebody genuinely BLOCKED on a lock, or gives up.
   *
   * Both tests below used to gate on `setTimeout(..., 100)`, which is a hope rather than a gate:
   * on a loaded machine the racer might not have reached the lock yet, and the pair would go
   * green having exercised no contention at all. `pg_stat_activity.wait_event_type = 'Lock'` is
   * the database's own statement that the contention this test is named for actually happened.
   */
  async function waitForBlockedBackend(timeoutMs = 5_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const rows = await db.execute<{ count: string }>(
        sql`SELECT count(*) AS count FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`,
      );
      if (Number(rows[0]?.count ?? 0) > 0) return true;
      if (Date.now() > deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

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

    try {
      // The contention is ASSERTED, not assumed: without this the test could pass by luck on a
      // loaded machine, having serialized two appends that never actually met.
      expect(await waitForBlockedBackend()).toBe(true);
    } finally {
      release();
    }
    const [first, second] = await Promise.all([held, racer]);

    expect([first.sequence, second.sequence].sort()).toEqual([1, 2]);
    const rows = await db.select().from(auditEvents).orderBy(auditEvents.sequence);
    expect(rows[1]!.previousEventHash).toBe(rows[0]!.eventHash);
  });

  /**
   * The matched pair for the ruling, TIGHTENED to actually mean what its docblock claims.
   *
   * As first written, a *table-wide* `SELECT ... FOR UPDATE` with no `WHERE` did not redden it:
   * `held`'s `league_1` anchor row was created inside `held`'s own open transaction, so it was
   * invisible to `elsewhere`'s read-committed snapshot, and `FOR UPDATE` cannot lock a row it
   * cannot see. The pair caught a lock funnelled through a shared key, not a lock broadened
   * against uncommitted neighbours — which is most of what "broadened" means.
   *
   * The fix is one committed append per chain BEFORE the race. Now `league_1`'s anchor row is
   * visible to everyone, `held` locks that committed row, and any lock broader than one row
   * blocks `elsewhere` on it and blows the 2s statement timeout.
   */
  it("does NOT let one league's append block another league's, even against a committed neighbour", async () => {
    await db.transaction((tx) => logger.record(tx, input({ leagueId: "league_1" })));
    await db.transaction((tx) => logger.record(tx, input({ leagueId: "league_2" })));

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const held = db.transaction(async (tx) => {
      await logger.record(tx, input({ leagueId: "league_1" }));
      await gate;
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const elsewhere = await other.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout = '2s'`);
        return logger.record(tx, input({ leagueId: "league_2" }));
      });
      expect(elsewhere).toMatchObject({ chainScope: "league_2", sequence: 2 });
    } finally {
      // In a `finally`, because the failure path is exactly when this matters: a rejection here
      // used to leak `held` still holding the anchor lock, and one genuine 2.1s failure cascaded
      // into two unrelated 30-second timeouts elsewhere in this file. A real regression must
      // present as one clean failure, not a confusing three-test hang.
      release();
      await held;
    }
  });
});

/**
 * `lockAnchor`'s "the row vanished between insert and lock" guard. Real Postgres cannot reach
 * it: `INSERT ... ON CONFLICT DO NOTHING` either commits the row or finds it already committed,
 * so the `SELECT ... FOR UPDATE` immediately after always finds something. The guard exists so a
 * future refactor that breaks that invariant fails LOUDLY instead of returning an undefined
 * anchor, and a guard nothing exercises is a guard nobody knows still works. A stub `DbTx` is the
 * only way to put the code in the state it defends against — same shape as
 * `src/identity-service/preferences.test.ts`'s "impossible-state guards".
 */
describe("AuditLogger.record — the impossible-state guard", () => {
  it("refuses to invent a chain anchor when the row is somehow not there after insert", async () => {
    const stub = {
      insert: () => ({ values: () => ({ onConflictDoNothing: async () => undefined }) }),
      select: () => ({ from: () => ({ where: () => ({ for: async () => [] }) }) }),
    } as unknown as DbTx;
    await expect(logger.record(stub, input())).rejects.toThrow('Audit chain "league_1" vanished between insert and lock.');
  });
});

describe("getAuditLogger", () => {
  it("memoizes one process-wide logger that can actually record", async () => {
    const first = getAuditLogger();
    expect(getAuditLogger()).toBe(first);
    const event = await db.transaction((tx) => first.record(tx, input()));
    expect(event).toMatchObject({ chainScope: "league_1", sequence: 1 });
  });
});
