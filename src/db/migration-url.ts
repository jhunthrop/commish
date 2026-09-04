/**
 * Which connection string `drizzle-kit migrate` should use.
 *
 * Migrations take DDL locks and run multi-statement transactions, so they go over a DIRECT
 * connection, never a transaction-pooling proxy. Neon's Vercel integration publishes both: the
 * pooled `DATABASE_URL` the app serves requests through (a `-pooler` host, PgBouncer in
 * transaction mode) and `DATABASE_URL_UNPOOLED` for exactly this kind of work. Locally the
 * docker-compose stack ships only `DATABASE_URL`, and `npm run db:migrate` already overrides it
 * to the direct 5432 port for the same reason.
 *
 * Reads a plain record rather than `process.env` so the rule is testable without mutating the
 * environment. An empty string counts as unset, the rule `src/lib/env.ts` documents for every
 * optional variable this repo reads.
 */
export type MigrationEnv = Readonly<Record<string, string | undefined>>;

function present(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

export function migrationDatabaseUrl(env: MigrationEnv): string {
  if (present(env.DATABASE_URL_UNPOOLED)) return env.DATABASE_URL_UNPOOLED;
  if (present(env.DATABASE_URL)) return env.DATABASE_URL;
  throw new Error(
    "Neither DATABASE_URL_UNPOOLED nor DATABASE_URL is set. Copy .env.example to .env.local and run `docker compose up -d`.",
  );
}
