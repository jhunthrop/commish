import { getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, expect } from "vitest";
import { invalidateAllTtlMemosForTests } from "@research-ts/lib/cache/ttl-memo";
import { envOr } from "@research-ts/lib/env";
import { createDb, type Db } from "@research-ts/db/client";
import { DB_POOL_CONFIG } from "@research-ts/db/config";
import { unwrapCauseChain } from "./errors";
import * as schema from "./schema";

export const TEST_DATABASE_URL = envOr("TEST_DATABASE_URL", "postgres://commish:commish@localhost:5433/commish_test");

/**
 * Connects to the dedicated test database (docker-compose `postgres-test`, one of the four lanes
 * `src/db/test-lanes.ts` names — lane 1, `commish_test`, unless a Vitest worker's own
 * `VITEST_POOL_ID` sent this process to another).
 * Every table is truncated between tests so each test starts from a clean state.
 *
 * Test-only module (it imports `vitest`): registers its own `afterAll` to close the
 * connection pool it opens, so callers don't each need to remember to. A small pool plus a
 * short idle timeout (`DB_POOL_CONFIG.test*`) keeps ~40 test files' worth of simultaneous
 * pools from starving the shared test Postgres of connections.
 */
export function createTestDb(): Db {
  const db = createDb(TEST_DATABASE_URL, {
    max: DB_POOL_CONFIG.testMaxConnections,
    idleTimeoutSeconds: DB_POOL_CONFIG.testIdleTimeoutSeconds,
  });
  afterAll(async () => {
    await db.$client.end();
  });
  return db;
}

/**
 * Every research table, read off the schema module rather than listed, so a table added to
 * `./schema` is truncated without anyone remembering to name it here. CASCADE also clears the
 * league app's rows that reference `players` while both halves share one database.
 */
const RESEARCH_TABLE_NAMES: readonly string[] = Object.values(schema as Record<string, unknown>).flatMap((value) =>
  is(value, PgTable) ? [getTableName(value)] : [],
);

/** Empties every research table between tests, and drops the in-process reference memos that would
 *  otherwise outlive the rows they were computed from. */
export async function truncateAll(db: Db): Promise<void> {
  await db.execute(sql.raw(`TRUNCATE TABLE ${RESEARCH_TABLE_NAMES.join(", ")} RESTART IDENTITY CASCADE`));
  invalidateAllTtlMemosForTests();
}

/**
 * `db.execute` throws drizzle-orm's `DrizzleQueryError`, whose own `.message` is just the SQL
 * text it was trying to run — the driver's real error (a trigger's `RAISE EXCEPTION` text, or
 * the violated constraint's name) sits one level down on `.cause`. `unwrapCauseChain`
 * (`src/db/errors.ts`) is the one place that walk is written; this joins every `.message` found
 * along it, so a test can assert against what postgres actually said, not drizzle's wrapper.
 *
 * Shared test support, extracted from `audit-append-only.test.ts` the day a second table gained
 * database-enforced immutability (`schema-invariants.test.ts`, Phase 4 Task 2) — the walk is one
 * thing to keep correct, not one per append-only table.
 */
export function causeChainMessage(error: unknown): string {
  const messages = unwrapCauseChain(error)
    .filter((link): link is Error => link instanceof Error)
    .map((link) => link.message);
  return messages.length > 0 ? messages.join(": ") : String(error);
}

/** `.rejects.toThrow(pattern)` only ever looks at the top `.message` — see `causeChainMessage`. */
export async function expectRejectionMatching(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  await expect(promise).rejects.toSatisfy((error: unknown) => pattern.test(causeChainMessage(error)));
}

/**
 * Runs `fn` against a `Db` that records the SQL text of EVERY statement it sends — statements
 * inside `db.transaction(...)` included — and returns them in execution order.
 *
 * The free-season proof (Phase 4, Task 8; reused by Task 9's dissolution): a free league's join
 * and release must run without a single `money_*` table read or write, asserted as
 * `statements.filter((s) => /money_/.test(s))` being empty rather than trusted from a code read.
 *
 * Uses drizzle's own `logger` seam, NOT `countingDb`'s `$client.unsafe` proxy, deliberately:
 * postgres-js scopes a transaction's statements to the connection `sql.begin(...)` reserved, so
 * a proxy over the BASE client never sees them — while the logger is part of the drizzle session
 * config and rides into every nested transaction session untouched.
 */
export async function recordStatements(base: Db, fn: (db: Db) => Promise<unknown>): Promise<readonly string[]> {
  const statements: string[] = [];
  const logged = drizzle(base.$client, {
    logger: {
      logQuery: (query: string) => {
        statements.push(query);
      },
    },
  });
  await fn(logged);
  return statements;
}

export interface CountingDb {
  /** A full `Db` — also assignable to `ReadonlyDb` for a caller (like `affectedTeams`) that
   *  only needs the read half. */
  readonly db: Db;
  /** How many queries have actually gone over the wire since this was built. */
  readonly selectCount: () => number;
  /** How many of those queries' own SQL text matched `pattern` — for a caller proving not just
   *  "a bounded number of queries total" but "this ONE table was read exactly once", the sharper
   *  claim an N+1 regression on a single join can hide behind a merely-bounded total count. */
  readonly queriesMatching: (pattern: RegExp) => number;
}

/**
 * A `Db` that counts actual round trips to Postgres, not calls to the `.select(...)` query
 * builder — some read paths build a SECOND `db.select(...)` internally (e.g. a correlated
 * subquery) that is embedded into the outer query's SQL text and never separately awaited, so
 * counting `.select(...)` invocations would over-count. Counting at `$client.unsafe`, the one
 * place postgres-js actually sends a query over the wire, counts what a query-count exit
 * criterion means by "queries".
 *
 * Shared by every service whose docblock commits to a bounded query count regardless of how
 * many leagues/teams a caller has — `affectedTeams` (`@/stats-pipeline/affected.ts`,
 * `affected.test.ts`) established the idiom; `crossLeagueHome`
 * (`@/league-service/home.ts`, `home.test.ts`) reuses it rather than re-inventing it.
 */
export function countingDb(base: Db): CountingDb {
  let executions = 0;
  const queryTexts: string[] = [];
  const countedClient = new Proxy(base.$client, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (prop === "unsafe" && typeof value === "function") {
        return (...args: unknown[]) => {
          executions += 1;
          if (typeof args[0] === "string") queryTexts.push(args[0]);
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return value;
    },
  });
  const countedDb = drizzle(countedClient);
  return {
    db: countedDb,
    selectCount: () => executions,
    queriesMatching: (pattern: RegExp) => queryTexts.filter((text) => pattern.test(text)).length,
  };
}
