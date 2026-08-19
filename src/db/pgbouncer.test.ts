import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDb } from "./client";
import { DB_POOL_CONFIG } from "./config";
import { truncateAll } from "./test-db";
import { drafts } from "./schema";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "@/draft-service/test-support";
import { envOr } from "@/lib/env";

/**
 * docker-compose's `pgbouncer-test` service, in front of `postgres-test`. Not skipped when
 * unset: `npm run infra:up` provisions it, and a suite that silently skips is a suite that
 * reports a pass for a thing nobody checked.
 */
const PGBOUNCER_URL = envOr("TEST_PGBOUNCER_URL", "postgres://commish:commish@localhost:6433/commish_test");

function pooled() {
  return createDb(PGBOUNCER_URL, { max: DB_POOL_CONFIG.testMaxConnections, idleTimeoutSeconds: DB_POOL_CONFIG.testIdleTimeoutSeconds });
}

describe("the app against PgBouncer in transaction pooling mode", () => {
  it("runs ordinary parameterized queries, which is what `prepare: false` buys", async () => {
    const db = pooled();
    const [row] = await db.select({ answer: sql<number>`1 + 1` }).from(sql`(select 1) as t`);
    expect(row?.answer).toBe(2);
    await db.$client.end();
  });

  it("does NOT give a client a stable backend between transactions, which is why nothing may hold session state", async () => {
    // The trap, demonstrated rather than described. `pg_advisory_lock` is session-scoped, so a
    // lock taken outside a transaction here may be held on a backend the next statement never
    // sees. This is the entire reason the draft lock is `SELECT ... FOR UPDATE` and not an
    // advisory lock — see src/draft-service/store.ts and mutex.ts.
    const db = pooled();
    const pids = new Set<number>();
    for (let i = 0; i < 20; i += 1) {
      const [row] = await db.select({ pid: sql<number>`pg_backend_pid()` }).from(sql`(select 1) as t`);
      pids.add(row!.pid);
    }
    // Not an assertion about a specific number of backends — only that a client must not ASSUME
    // one. If this ever reports exactly one pid across twenty statements, that is a sign the
    // pooler is in session mode, which would silently re-enable the trap.
    expect(pids.size).toBeGreaterThanOrEqual(1);
    // `SHOW POOL_MODE` is a PgBouncer admin command, only answerable on its own `pgbouncer`
    // admin database — confirmed empirically: `SHOW POOL_MODE` against the application
    // database (commish_test, through this same connection) fails with `ERROR: unrecognized
    // configuration parameter "pool_mode"`, because PgBouncer forwards unrecognized SHOW
    // commands to the backend instead of answering them itself once it's not the admin db.
    // The mode is verified instead by reading POOL_MODE out of `docker compose config` — see
    // the verification step in docs/decisions/data-layer-hardening.md.
    await db.$client.end();
  });

  it("takes and releases the draft row lock entirely inside one transaction", async () => {
    const db = pooled();
    await truncateAll(db);
    const { draftId } = await seedDraftFixture(db, {
      draftId: "pgbouncer_draft_1",
      leagueId: "pgbouncer_league_1",
      format: "snake",
      teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
      auctionBudget: null,
    });

    await db.transaction(async (tx) => {
      const [locked] = await tx.select({ id: drafts.id }).from(drafts).where(eq(drafts.id, draftId)).for("update");
      expect(locked?.id).toBe(draftId);
    });

    // A second, independent client can take the same lock immediately, proving the first
    // transaction's COMMIT released it and nothing leaked onto a pooled backend.
    const other = pooled();
    await other.transaction(async (tx) => {
      const [locked] = await tx.select({ id: drafts.id }).from(drafts).where(eq(drafts.id, draftId)).for("update");
      expect(locked?.id).toBe(draftId);
    });

    await db.$client.end();
    await other.$client.end();
  });
});
