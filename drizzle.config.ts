import { defineConfig } from "drizzle-kit";
import { migrationDatabaseUrl } from "./research/src/db/migration-url";

// The league app's migrations, over BOTH halves of the schema while they share one database: the
// research tables (`research/src/db/schema.ts`, whose own migrations for the new database live in
// `research/drizzle`) and the league app's (`src/db/schema.ts`). Relative imports, not the path
// aliases: drizzle-kit loads this file without the tsconfig paths.
export default defineConfig({
  schema: ["./research/src/db/schema.ts", "./src/db/schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: migrationDatabaseUrl(process.env) },
});
