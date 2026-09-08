import { describe, expect, it } from "vitest";
import { assertDeploymentDatabase, databaseHost, shouldMigrateOnBuild } from "./deployment";

const PROD_HOST = "ep-prod-123-pooler.us-east-1.aws.neon.tech";
const PROD_URL = `postgres://u:p@${PROD_HOST}/db?sslmode=require`;

describe("shouldMigrateOnBuild", () => {
  it("migrates only on a Production deployment", () => {
    expect(shouldMigrateOnBuild({ VERCEL_ENV: "production" })).toBe(true);
    expect(shouldMigrateOnBuild({ VERCEL_ENV: "preview" })).toBe(false);
    expect(shouldMigrateOnBuild({ VERCEL_ENV: "development" })).toBe(false);
    expect(shouldMigrateOnBuild({})).toBe(false);
  });
});

describe("databaseHost", () => {
  it("reads the hostname, lower-cased, and never the credentials", () => {
    expect(databaseHost(`postgres://u:SECRET@${PROD_HOST.toUpperCase()}/db`)).toBe(PROD_HOST);
    expect(databaseHost("not a url")).toBeNull();
  });
});

describe("assertDeploymentDatabase", () => {
  it("refuses a Preview deployment whose DATABASE_URL points at the production host", () => {
    expect(() => assertDeploymentDatabase({ VERCEL_ENV: "preview", PRODUCTION_DATABASE_HOST: PROD_HOST, DATABASE_URL: PROD_URL })).toThrow(
      /Preview deployment.*production database host/,
    );
  });

  it("never prints the connection string in its refusal", () => {
    let message = "";
    try {
      assertDeploymentDatabase({ VERCEL_ENV: "preview", PRODUCTION_DATABASE_HOST: PROD_HOST, DATABASE_URL: PROD_URL });
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain("u:p@");
  });

  it("lets a Preview boot against its own branch host", () => {
    expect(() =>
      assertDeploymentDatabase({ VERCEL_ENV: "preview", PRODUCTION_DATABASE_HOST: PROD_HOST, DATABASE_URL: "postgres://u:p@ep-branch-9-pooler.neon.tech/db" }),
    ).not.toThrow();
  });

  it("lets the explicit override through, and only the exact value", () => {
    const env = { VERCEL_ENV: "preview", PRODUCTION_DATABASE_HOST: PROD_HOST, DATABASE_URL: PROD_URL };
    expect(() => assertDeploymentDatabase({ ...env, ALLOW_PRODUCTION_DATABASE_ON_PREVIEW: "1" })).not.toThrow();
    expect(() => assertDeploymentDatabase({ ...env, ALLOW_PRODUCTION_DATABASE_ON_PREVIEW: "true" })).toThrow();
  });

  it("is silent on Production, locally, and when the production host is not declared", () => {
    expect(() => assertDeploymentDatabase({ VERCEL_ENV: "production", PRODUCTION_DATABASE_HOST: PROD_HOST, DATABASE_URL: PROD_URL })).not.toThrow();
    expect(() => assertDeploymentDatabase({ DATABASE_URL: PROD_URL })).not.toThrow();
    expect(() => assertDeploymentDatabase({ VERCEL_ENV: "preview", DATABASE_URL: PROD_URL })).not.toThrow();
    expect(() => assertDeploymentDatabase({ VERCEL_ENV: "preview", PRODUCTION_DATABASE_HOST: "", DATABASE_URL: PROD_URL })).not.toThrow();
  });
});
