import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { DB_POOL_CONFIG } from "./config";
import { assertDeploymentDatabase } from "./deployment";

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url.length === 0) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and run `docker compose up -d`.");
  }
  // A Preview deployment must never boot against the production database (finding 5).
  assertDeploymentDatabase(process.env);
  return url;
}

export type Db = ReturnType<typeof createDb>;

/** The transaction handle Drizzle hands a `db.transaction` callback. */
export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * A connection a function may only READ through. `Db` and `DbTx` are both structurally
 * assignable to it, so a caller passes `getDb()` verbatim and nothing at the boundary changes
 * — but inside, `.insert(`, `.update(`, `.delete(` and `.transaction(` are type errors.
 *
 * Used where read-only is a CONSTRAINT rather than a habit: the AI advisor is advisory-only by
 * law (strategy doc §4.2), and this is what makes `tsc` the thing enforcing it instead of a
 * grep over the directory.
 *
 * `selectDistinctOn` joined `select` when the projection engine's point-in-time reader needed it
 * (`observationsAsOf`, `src/projections/store.ts`): it is exactly as read-only as `select` — a
 * `SELECT DISTINCT ON` — and leaving it out would have forced that reader to take a full `Db` and
 * give up the guarantee for a query that never writes. `advisory-only.test.ts` pins that no WRITE
 * verb has crept in, which is the property that actually matters.
 */
export type ReadonlyDb = Pick<Db, "select" | "selectDistinctOn">;

export interface DbOptions {
  /** Pool size. Defaults to `DB_POOL_CONFIG.defaultMaxConnections`. */
  readonly max?: number;
  /** Seconds an idle connection may sit before the pool closes it. Unset = no timeout. */
  readonly idleTimeoutSeconds?: number;
  /** Seconds to wait for a connection to establish. Unset = the driver's default. */
  readonly connectTimeoutSeconds?: number;
  /** Seconds a connection may live before the pool recycles it. Unset = the driver's default. */
  readonly maxLifetimeSeconds?: number;
}

/** The pool a Vercel function instance opens — see `DB_POOL_CONFIG.vercel`. */
export function vercelPoolOptions(): DbOptions {
  const { maxConnections, idleTimeoutSeconds, connectTimeoutSeconds, maxLifetimeSeconds } = DB_POOL_CONFIG.vercel;
  return { max: maxConnections, idleTimeoutSeconds, connectTimeoutSeconds, maxLifetimeSeconds };
}

export function createDb(connectionString: string = requireDatabaseUrl(), options: DbOptions = {}) {
  const client = postgres(connectionString, {
    max: options.max ?? DB_POOL_CONFIG.defaultMaxConnections,
    idle_timeout: options.idleTimeoutSeconds,
    connect_timeout: options.connectTimeoutSeconds,
    max_lifetime: options.maxLifetimeSeconds,
    /**
     * UNCONDITIONAL, whether this connection string points at Postgres or at PgBouncer.
     *
     * postgres-js names and caches prepared statements per backend connection by default.
     * PgBouncer in transaction pooling mode hands a client a different backend between
     * transactions, so a named statement prepared on one is missing on the next and the query
     * fails with "prepared statement does not exist" under load and not in development, which
     * is the worst possible time to discover it.
     *
     * It is set for the DIRECT connection too, deliberately: one behavior everywhere means a
     * bug cannot hide behind a mode difference between dev and production. The cost is that
     * each statement uses the unnamed prepared statement instead of a cached named one, which
     * is not an extra round trip in the extended protocol.
     */
    prepare: false,
  });
  // NO SCHEMA ON THE CLIENT (the prep site carve-out, 2026-10-12). Nothing in this codebase uses
  // Drizzle's relational `db.query` API, only the core builder, which takes its tables from each
  // query. A client typed over one half of the schema would be a different type from one typed
  // over the other, so the research core and the league app share this one untyped-schema `Db`.
  return drizzle(client);
}

/**
 * The singleton lives on `globalThis`, NOT in a module-level `let`: in `next dev`, every
 * recompile creates a fresh module instance, so a module-level singleton resets per rebuild
 * and each reset mints another pool while the old one's connections linger. A day of hot
 * reloads exhausted Postgres ("sorry, too many clients already"). `globalThis` survives
 * recompiles; in production the module loads once and this is equivalent to the plain let.
 */
const globalDb = globalThis as { __commishDb?: Db };

/** Process-wide default connection. Tests should use createDb(TEST_DATABASE_URL) instead.
 *  On Vercel (the platform's own marker, set on every build and function) the pool is the small,
 *  short-lived serverless one; everywhere else the long-lived formula applies. */
export function getDb(): Db {
  globalDb.__commishDb ??= createDb(undefined, process.env.VERCEL === undefined ? {} : vercelPoolOptions());
  return globalDb.__commishDb;
}
