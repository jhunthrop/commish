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
  });
  return drizzle(client, { schema });
}

let singleton: Db | undefined;

/** Process-wide default connection. Tests should use createDb(TEST_DATABASE_URL) instead. */
export function getDb(): Db {
  if (singleton === undefined) {
    singleton = createDb();
  }
  return singleton;
}
