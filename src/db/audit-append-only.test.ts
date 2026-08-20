import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "./test-db";
import { unwrapCauseChain } from "./errors";
import { GENESIS_HASH } from "@/integrity/chain";

const db = createTestDb();

/**
 * `db.execute` throws drizzle-orm's `DrizzleQueryError`, whose own `.message` is just the SQL
 * text it was trying to run — the driver's real error (the trigger's `RAISE EXCEPTION` text, or
 * the violated constraint's name) sits one level down on `.cause`. `unwrapCauseChain`
 * (`src/db/errors.ts`) is the one place that walk is written; this joins every `.message` found
 * along it, so a test can assert against what postgres actually said, not drizzle's wrapper.
 */
function causeChainMessage(error: unknown): string {
  const messages = unwrapCauseChain(error)
    .filter((link): link is Error => link instanceof Error)
    .map((link) => link.message);
  return messages.length > 0 ? messages.join(": ") : String(error);
}

/** `.rejects.toThrow(pattern)` only ever looks at the top `.message` — see `causeChainMessage`. */
async function expectRejectionMatching(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  await expect(promise).rejects.toSatisfy((error: unknown) => pattern.test(causeChainMessage(error)));
}

async function seedOneEvent(): Promise<void> {
  await db.execute(sql`
    INSERT INTO audit_events
      (event_id, chain_scope, sequence, event_type, actor_id, actor_type, league_id, payload, occurred_at, previous_event_hash, event_hash, hash_version)
    VALUES
      ('evt_1', 'platform', 1, 'session_started', 'user_alice', 'user', NULL, '{"via":"callback"}'::jsonb,
       '2026-08-20T17:00:00.000Z', ${GENESIS_HASH}, 'deadbeef', 1)
  `);
}

describe("audit_events is append-only at the database", () => {
  beforeEach(async () => {
    await truncateAll(db);
    await seedOneEvent();
  });

  it("refuses an UPDATE issued as raw SQL, outside any application code", async () => {
    await expectRejectionMatching(db.execute(sql`UPDATE audit_events SET payload = '{"via":"tamper"}'::jsonb`), /append-only/);
    const [row] = await db.execute<{ payload: { via: string } }>(sql`SELECT payload FROM audit_events`);
    expect(row?.payload.via).toBe("callback");
  });

  it("refuses a DELETE issued as raw SQL", async () => {
    await expectRejectionMatching(db.execute(sql`DELETE FROM audit_events`), /append-only/);
    const [row] = await db.execute<{ count: string }>(sql`SELECT count(*) AS count FROM audit_events`);
    expect(row?.count).toBe("1");
  });

  it("refuses an UPDATE that changes nothing, because a no-op edit is still an edit", async () => {
    await expectRejectionMatching(db.execute(sql`UPDATE audit_events SET payload = payload`), /append-only/);
  });

  it("still allows the append itself", async () => {
    await db.execute(sql`
      INSERT INTO audit_events
        (event_id, chain_scope, sequence, event_type, actor_id, actor_type, league_id, payload, occurred_at, previous_event_hash, event_hash, hash_version)
      VALUES ('evt_2', 'platform', 2, 'profile_updated', 'user_alice', 'user', NULL, '{}'::jsonb,
              '2026-08-20T17:01:00.000Z', 'deadbeef', 'cafebabe', 1)
    `);
    const [row] = await db.execute<{ count: string }>(sql`SELECT count(*) AS count FROM audit_events`);
    expect(row?.count).toBe("2");
  });

  it("refuses a second row at the same (scope, sequence), the draft_actions backstop", async () => {
    // The anchor row lock (Task 3) is the mechanism; this unique index is the backstop that
    // turns a bug in that lock into a rejected append rather than a forked chain.
    await expectRejectionMatching(
      db.execute(sql`
        INSERT INTO audit_events
          (event_id, chain_scope, sequence, event_type, actor_id, actor_type, league_id, payload, occurred_at, previous_event_hash, event_hash, hash_version)
        VALUES ('evt_x', 'platform', 1, 'profile_updated', 'user_bob', 'user', NULL, '{}'::jsonb,
                '2026-08-20T17:02:00.000Z', ${GENESIS_HASH}, 'f00d', 1)
      `),
      /audit_events_scope_sequence_idx/,
    );
  });

  it("lets the rollup row be updated, because a rollup is not the record", async () => {
    await db.execute(sql`INSERT INTO audit_chains (scope, head_sequence, head_hash) VALUES ('platform', 1, 'deadbeef')`);
    await db.execute(sql`UPDATE audit_chains SET head_sequence = 2, head_hash = 'cafebabe' WHERE scope = 'platform'`);
    const [row] = await db.execute<{ head_sequence: number }>(sql`SELECT head_sequence FROM audit_chains WHERE scope = 'platform'`);
    expect(row?.head_sequence).toBe(2);
  });
});

/**
 * The checkpoint's own guard (migration `0021`). Not the same rule as `audit_events`': this table
 * is verification's own state and the verifier legitimately advances it on every clean walk, so
 * the guard is FORWARD-ONLY rather than append-only.
 *
 * It matters because the checkpoint is the third account the verifier reconciles. An adversary who
 * erases the tail of `audit_events` and rewinds `audit_chains` to match leaves the rows and the
 * anchor agreeing with each other; the frozen checkpoint is the only record left that says how
 * many events were verified before. A detector that can be deleted is not a detector, and one that
 * can be rewound is worse than none, because it looks like agreement.
 */
describe("audit_chain_checkpoints only ever moves forward", () => {
  beforeEach(async () => {
    await truncateAll(db);
    await db.execute(sql`INSERT INTO audit_chains (scope, head_sequence, head_hash) VALUES ('platform', 5, 'cafebabe')`);
    await db.execute(sql`
      INSERT INTO audit_chain_checkpoints (scope, verified_through_sequence, verified_through_hash)
      VALUES ('platform', 5, 'cafebabe')
    `);
  });

  it("refuses a DELETE, because a detector an adversary can remove is not one", async () => {
    await expectRejectionMatching(db.execute(sql`DELETE FROM audit_chain_checkpoints`), /is a detector, not scratch space/);
    const [row] = await db.execute<{ count: string }>(sql`SELECT count(*) AS count FROM audit_chain_checkpoints`);
    expect(row?.count).toBe("1");
  });

  it("refuses an UPDATE that rewinds the frozen sequence, which is how the cross-check would be neutralized", async () => {
    await expectRejectionMatching(
      db.execute(sql`UPDATE audit_chain_checkpoints SET verified_through_sequence = 1 WHERE scope = 'platform'`),
      /only moves forward: 1 is behind the frozen 5/,
    );
  });

  it("refuses an UPDATE that moves a checkpoint onto a different chain", async () => {
    await db.execute(sql`INSERT INTO audit_chains (scope, head_sequence, head_hash) VALUES ('league_1', 0, 'deadbeef')`);
    await expectRejectionMatching(
      db.execute(sql`UPDATE audit_chain_checkpoints SET scope = 'league_1' WHERE scope = 'platform'`),
      /may not be moved/,
    );
  });

  it("permits the forward freeze the verifier itself makes, and the standing-still re-freeze", async () => {
    await db.execute(sql`UPDATE audit_chain_checkpoints SET verified_through_sequence = 5, verified_at = now() WHERE scope = 'platform'`);
    await db.execute(sql`UPDATE audit_chain_checkpoints SET verified_through_sequence = 9, verified_through_hash = 'f00d' WHERE scope = 'platform'`);
    const [row] = await db.execute<{ verified_through_sequence: number }>(
      sql`SELECT verified_through_sequence FROM audit_chain_checkpoints WHERE scope = 'platform'`,
    );
    expect(row?.verified_through_sequence).toBe(9);
  });
});
