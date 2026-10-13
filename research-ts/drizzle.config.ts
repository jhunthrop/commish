import { defineConfig } from "drizzle-kit";
import { migrationDatabaseUrl } from "./src/db/migration-url";

// The research tables' own migrations (spec §2.5): generated from this package's schema alone, for
// a database that starts from them. Until cutover the shared database is still migrated by the
// league app's history (`../drizzle`), which already carries every table here, so this history is
// for a fresh database and is never applied on top of the league app's.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: migrationDatabaseUrl(process.env) },
});
