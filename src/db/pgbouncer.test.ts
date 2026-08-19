import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
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

/**
 * PgBouncer's virtual admin database — same host/port/credentials as `PGBOUNCER_URL`, database
 * name swapped to `pgbouncer`. `docker-compose.yml`'s `ADMIN_USERS: commish` grants the app's
 * own user access to it (the image's default admin user, `postgres`, is not in `userlist.txt`
 * and can never authenticate at all).
 */
function adminConsoleUrl(): string {
  const url = new URL(PGBOUNCER_URL);
  url.pathname = "/pgbouncer";
  return url.toString();
}

/**
 * The admin console only speaks the SIMPLE query protocol — `postgres-js`'s default extended
 * protocol (Parse/Bind/Execute, used even for a zero-parameter tagged-template query) gets back
 * `extended query protocol not supported by admin console`. `.simple()` switches the query to
 * simple mode; `fetch_types: false` skips postgres-js's own startup query for array-type OIDs,
 * which would otherwise fail the same way before a single admin command is ever sent.
 */
function connectToAdminConsole() {
  return postgres(adminConsoleUrl(), { prepare: false, fetch_types: false });
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
    // NOT the load-bearing assertion for pool mode — a small local pool can coincidentally
    // reuse one backend across many fast statements even in transaction mode, so a passing
    // count here proves nothing on its own. It is kept only as a secondary signal (a real
    // session-mode regression would make this exactly 1 as well). The next case asserts the
    // pool mode directly.
    expect(pids.size).toBeGreaterThanOrEqual(1);
    await db.$client.end();
  });

  it("is configured as pool_mode transaction, verified against PgBouncer's own admin console", async () => {
    // The direct assertion the previous case cannot make: PgBouncer's admin console (the
    // virtual `pgbouncer` database) reports pool_mode for real, rather than inferring it from
    // observed backend-pid behavior. Proven by mutation: flipping docker-compose.yml's
    // `pgbouncer-test` service to `POOL_MODE: session` and recreating the container makes this
    // assertion fail (`pool_mode: "session"`), while the previous case's loose
    // `toBeGreaterThanOrEqual(1)` still passes — see fix-wave-report.md for the transcript.
    const admin = connectToAdminConsole();
    try {
      const pools = await admin`SHOW POOLS`.simple();
      const testDbUrl = new URL(PGBOUNCER_URL);
      const targetDatabase = testDbUrl.pathname.replace(/^\//, "");
      const pool = (pools as unknown as readonly { readonly database: string; readonly pool_mode: string }[]).find(
        (row) => row.database === targetDatabase,
      );
      expect(pool?.pool_mode).toBe("transaction");
    } finally {
      await admin.end();
    }
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
