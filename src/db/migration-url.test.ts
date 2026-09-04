import { describe, expect, it } from "vitest";
import { migrationDatabaseUrl } from "./migration-url";

describe("migrationDatabaseUrl", () => {
  it("prefers the direct (unpooled) URL when the host provides one", () => {
    expect(
      migrationDatabaseUrl({
        DATABASE_URL: "postgres://u:p@ep-pooler.neon.tech/db",
        DATABASE_URL_UNPOOLED: "postgres://u:p@ep-direct.neon.tech/db",
      }),
    ).toBe("postgres://u:p@ep-direct.neon.tech/db");
  });

  it("falls back to DATABASE_URL when there is no unpooled URL", () => {
    expect(migrationDatabaseUrl({ DATABASE_URL: "postgres://commish:commish@localhost:6432/commish" })).toBe(
      "postgres://commish:commish@localhost:6432/commish",
    );
  });

  it("treats an empty unpooled value as absent, the same rule as envOr", () => {
    expect(migrationDatabaseUrl({ DATABASE_URL: "postgres://a", DATABASE_URL_UNPOOLED: "" })).toBe("postgres://a");
  });

  it("fails fast, naming both variables, when neither is set", () => {
    expect(() => migrationDatabaseUrl({})).toThrow(/DATABASE_URL_UNPOOLED.*DATABASE_URL/);
    expect(() => migrationDatabaseUrl({ DATABASE_URL: "" })).toThrow(/DATABASE_URL/);
  });
});
