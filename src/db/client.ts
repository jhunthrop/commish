import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
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

export function createDb(connectionString: string = requireDatabaseUrl()) {
  const client = postgres(connectionString, { max: 10 });
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
