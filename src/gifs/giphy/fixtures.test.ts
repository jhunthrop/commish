import { describe, expect, it } from "vitest";
import { GIPHY_CONFIG } from "./config";
import { createFixtureFetch, readFixture, readManifest } from "./fixtures";

/**
 * `createFixtureFetch` is what stands in for `globalThis.fetch` in every Giphy test, and
 * `createGiphyClient` always calls it with a plain string URL (`doFetch(url.toString())`) — so
 * the provider's own test suite never exercises `createFixtureFetch`'s tolerance for the other
 * two `RequestInfo` shapes `fetch` itself accepts, or its own not-found path. Those are asserted
 * directly here instead, mirroring `src/stats/tank01/fixtures.test.ts`.
 */
describe("createFixtureFetch", () => {
  it("serves a fixture requested with a URL instance", async () => {
    const fetchFixtures = createFixtureFetch();
    const url = new URL(GIPHY_CONFIG.baseUrl);
    url.searchParams.set("q", "touchdown");
    const response = await fetchFixtures(url);
    const envelope = (await response.json()) as { data: unknown };
    expect(envelope.data).toEqual((readFixture("search-touchdown.json") as { data: unknown }).data);
  });

  it("serves a fixture requested with a Request instance", async () => {
    const fetchFixtures = createFixtureFetch();
    const url = new URL(GIPHY_CONFIG.baseUrl);
    url.searchParams.set("q", "touchdown");
    const response = await fetchFixtures(new Request(url));
    const envelope = (await response.json()) as { data: unknown };
    expect(envelope.data).toEqual((readFixture("search-touchdown.json") as { data: unknown }).data);
  });

  it("throws by name, naming the query, for a search nothing recorded", async () => {
    const fetchFixtures = createFixtureFetch();
    const url = new URL(GIPHY_CONFIG.baseUrl);
    url.searchParams.set("q", "no-such-search");
    await expect(fetchFixtures(url)).rejects.toThrow('No Giphy fixture for the search "no-such-search"');
  });

  it("treats a request with no q param at all as an empty search, not a crash", async () => {
    // `url.searchParams.get("q")` returns null, not "", when the param is simply absent — the
    // adapter itself never omits it (client.ts always calls `.set("q", query)`), but this fetch
    // stands in for a real HTTP layer, and a real HTTP layer does not get to assume the request
    // it receives always has the param a well-behaved caller would have sent.
    const fetchFixtures = createFixtureFetch();
    const url = new URL(GIPHY_CONFIG.baseUrl);
    await expect(fetchFixtures(url)).rejects.toThrow('No Giphy fixture for the search ""');
  });
});

describe("readManifest / readFixture", () => {
  it("reads the committed manifest and each fixture it names", () => {
    const manifest = readManifest();
    expect(manifest.entries.length).toBeGreaterThan(0);
    for (const entry of manifest.entries) {
      // `not.toThrow()` alone proves only that the named file parses as JSON — a fixture
      // truncated to `{}`/`null`, or two entries pointing at the same file, would both survive
      // that. Every entry's declared shape and every fixture's real shape are checked here.
      expect(entry.file).toMatch(/\.json$/);
      expect(entry.query.length).toBeGreaterThan(0);
      expect(() => readFixture(entry.file)).not.toThrow();
    }
    // No two entries may declare the same file — that would silently make one entry's query
    // claim describe data another entry actually serves.
    expect(new Set(manifest.entries.map((entry) => entry.file)).size).toBe(manifest.entries.length);
  });

  it("reads search-touchdown.json as the full {data, pagination, meta} envelope Giphy's search returns", () => {
    const envelope = readFixture("search-touchdown.json") as { readonly data: readonly unknown[]; readonly meta: { readonly status: number } };
    expect(envelope.data.length).toBeGreaterThan(0);
    expect(envelope.meta.status).toBe(200);
  });
});
