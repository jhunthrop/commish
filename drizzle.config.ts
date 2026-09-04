import { defineConfig } from "drizzle-kit";
import { migrationDatabaseUrl } from "./src/db/migration-url";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: migrationDatabaseUrl(process.env) },
});
