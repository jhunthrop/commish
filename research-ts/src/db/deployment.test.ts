import { describe, expect, it } from "vitest";
import { assertDeploymentDatabase, connectionEndpoint, databaseEndpoint, shouldMigrateOnBuild } from "./deployment";

const ENDPOINT = "ep-prod-123";
const DIRECT_HOST = `${ENDPOINT}.us-east-1.aws.neon.tech`;
const POOLER_HOST = `${ENDPOINT}-pooler.us-east-1.aws.neon.tech`;
const directUrl = (host: string) => `postgres://u:p@${host}/db?sslmode=require`;

describe("shouldMigrateOnBuild", () => {
  it("migrates only on a Production deployment", () => {
    expect(shouldMigrateOnBuild({ VERCEL_ENV: "production" })).toBe(true);
    expect(shouldMigrateOnBuild({ VERCEL_ENV: "preview" })).toBe(false);
    expect(shouldMigrateOnBuild({ VERCEL_ENV: "development" })).toBe(false);
    expect(shouldMigrateOnBuild({})).toBe(false);
  });
});

describe("databaseEndpoint / connectionEndpoint", () => {
  it("reads the same endpoint id off the direct host, the pooler host and a bare id, lower-cased", () => {
    expect(databaseEndpoint(DIRECT_HOST)).toBe(ENDPOINT);
    expect(databaseEndpoint(POOLER_HOST)).toBe(ENDPOINT);
    expect(databaseEndpoint(ENDPOINT.toUpperCase())).toBe(ENDPOINT);
    expect(databaseEndpoint(`${ENDPOINT}-pooler`)).toBe(ENDPOINT);
  });

  it("reads a connection string's endpoint and never its credentials; null for a non-URL", () => {
    expect(connectionEndpoint(`postgres://u:SECRET@${POOLER_HOST}/db`)).toBe(ENDPOINT);
    expect(connectionEndpoint("not a url")).toBeNull();
  });
});

describe("assertDeploymentDatabase", () => {
  const preview = (url: string, endpoint: string = ENDPOINT) => ({ VERCEL_ENV: "preview", PRODUCTION_DATABASE_ENDPOINT: endpoint, DATABASE_URL: url });

  it("refuses a Preview whose DATABASE_URL names the production endpoint, through the pooler OR the direct host", () => {
    expect(() => assertDeploymentDatabase(preview(directUrl(POOLER_HOST)))).toThrow(/Preview deployment.*production database endpoint/);
    expect(() => assertDeploymentDatabase(preview(directUrl(DIRECT_HOST)))).toThrow(/production database endpoint/);
  });

  it("accepts the declared endpoint in any of its own spellings", () => {
    expect(() => assertDeploymentDatabase(preview(directUrl(POOLER_HOST), DIRECT_HOST))).toThrow();
    expect(() => assertDeploymentDatabase(preview(directUrl(DIRECT_HOST), POOLER_HOST))).toThrow();
    expect(() => assertDeploymentDatabase(preview(directUrl(DIRECT_HOST), `${ENDPOINT}-pooler`))).toThrow();
  });

  it("never prints the connection string in its refusal", () => {
    let message = "";
    try {
      assertDeploymentDatabase(preview(directUrl(POOLER_HOST)));
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain("u:p@");
  });

  it("lets a Preview boot against its own branch endpoint", () => {
    expect(() => assertDeploymentDatabase(preview(directUrl("ep-branch-9-pooler.us-east-1.aws.neon.tech")))).not.toThrow();
  });

  it("lets the explicit override through, and only the exact value", () => {
    const env = preview(directUrl(POOLER_HOST));
    expect(() => assertDeploymentDatabase({ ...env, ALLOW_PRODUCTION_DATABASE_ON_PREVIEW: "1" })).not.toThrow();
    expect(() => assertDeploymentDatabase({ ...env, ALLOW_PRODUCTION_DATABASE_ON_PREVIEW: "true" })).toThrow();
  });

  it("is silent on Production, locally, and when the production endpoint is not declared", () => {
    const url = directUrl(POOLER_HOST);
    expect(() => assertDeploymentDatabase({ VERCEL_ENV: "production", PRODUCTION_DATABASE_ENDPOINT: ENDPOINT, DATABASE_URL: url })).not.toThrow();
    expect(() => assertDeploymentDatabase({ DATABASE_URL: url })).not.toThrow();
    expect(() => assertDeploymentDatabase({ VERCEL_ENV: "preview", DATABASE_URL: url })).not.toThrow();
    expect(() => assertDeploymentDatabase({ VERCEL_ENV: "preview", PRODUCTION_DATABASE_ENDPOINT: "", DATABASE_URL: url })).not.toThrow();
  });
});
