import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { DB_POOL_CONFIG } from "./config";
import * as schema from "./schema";

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url.length === 0) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and run `docker compose up -d`.");
  }
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
 */
export type ReadonlyDb = Pick<Db, "select">;

export interface DbOptions {
  /** Pool size. Defaults to `DB_POOL_CONFIG.defaultMaxConnections`. */
  readonly max?: number;
  /** Seconds an idle connection may sit before the pool closes it. Unset = no timeout. */
  readonly idleTimeoutSeconds?: number;
}

export function createDb(connectionString: string = requireDatabaseUrl(), options: DbOptions = {}) {
  const client = postgres(connectionString, {
    max: options.max ?? DB_POOL_CONFIG.defaultMaxConnections,
    idle_timeout: options.idleTimeoutSeconds,
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
  return drizzle(client, { schema });
}

/**
 * The singleton lives on `globalThis`, NOT in a module-level `let`: in `next dev`, every
 * recompile creates a fresh module instance, so a module-level singleton resets per rebuild
 * and each reset mints another pool while the old one's connections linger. A day of hot
 * reloads exhausted Postgres ("sorry, too many clients already"). `globalThis` survives
 * recompiles; in production the module loads once and this is equivalent to the plain let.
 */
const globalDb = globalThis as { __commishDb?: Db };

/** Process-wide default connection. Tests should use createDb(TEST_DATABASE_URL) instead. */
export function getDb(): Db {
  globalDb.__commishDb ??= createDb();
  return globalDb.__commishDb;
}
