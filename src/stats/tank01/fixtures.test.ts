import { describe, expect, it } from "vitest";
import { TANK01_CONFIG } from "./config";
import { createFixtureFetch, readFixture, readManifest } from "./fixtures";

/**
 * `createFixtureFetch` is what stands in for `globalThis.fetch` in every Tank01 test, and
 * `createTank01Client` always calls it with a plain string URL — so the provider's own test
 * suite never exercises `createFixtureFetch`'s tolerance for the other two `RequestInfo` shapes
 * `fetch` itself accepts, or its own not-found path. Those are asserted directly here instead.
 */
describe("createFixtureFetch", () => {
  it("serves a fixture requested with a URL instance", async () => {
    const fetchFixtures = createFixtureFetch();
    const response = await fetchFixtures(new URL(`${TANK01_CONFIG.baseUrl}${TANK01_CONFIG.paths.teams}`));
    const envelope = (await response.json()) as { body: unknown };
    expect(envelope.body).toEqual(readFixture("teams.json"));
  });

  it("serves a fixture requested with a Request instance", async () => {
    const fetchFixtures = createFixtureFetch();
    const response = await fetchFixtures(new Request(`${TANK01_CONFIG.baseUrl}${TANK01_CONFIG.paths.teams}`));
    const envelope = (await response.json()) as { body: unknown };
    expect(envelope.body).toEqual(readFixture("teams.json"));
  });

  it("throws by name, naming the path and query, for a request nothing recorded", async () => {
    const fetchFixtures = createFixtureFetch();
    await expect(fetchFixtures(`${TANK01_CONFIG.baseUrl}/getNFLPlayerInfo?playerID=1`)).rejects.toThrow(
      "No Tank01 fixture for /getNFLPlayerInfo",
    );
  });

  it("does not match a fixture whose query is a strict subset of the request's", async () => {
    // teams.json is recorded against an empty query. A request carrying an extra param must
    // still miss, or an adapter change that appends an unexpected param would be served stale
    // data instead of failing loudly.
    const fetchFixtures = createFixtureFetch();
    await expect(fetchFixtures(`${TANK01_CONFIG.baseUrl}${TANK01_CONFIG.paths.teams}?extra=1`)).rejects.toThrow(
      "No Tank01 fixture for",
    );
  });
});

describe("readManifest / readFixture", () => {
  it("reads the committed manifest and each fixture it names", () => {
    const manifest = readManifest();
    expect(manifest.entries.length).toBeGreaterThan(0);
    for (const entry of manifest.entries) expect(() => readFixture(entry.file)).not.toThrow();
  });
});
