import { describe, expect, it } from "vitest";
import { TANK01_CONFIG } from "@research-ts/stats/tank01/config";
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
    for (const entry of manifest.entries) {
      // `not.toThrow()` alone proves only that the named file parses as JSON — a fixture
      // truncated to `{}`/`null`, two entries pointing at the same file, or a manifest entry
      // whose `path`/`query` no longer matches what the client actually requests would all
      // survive that. Every entry's declared request shape and every fixture's real shape are
      // checked here instead.
      expect(entry.file).toMatch(/\.json$/);
      expect(entry.path).toMatch(/^\//);
      expect(() => readFixture(entry.file)).not.toThrow();
    }
    // No two entries may declare the same file — that would silently make one entry's
    // trimmedNote/provenance claims describe data the other actually serves.
    expect(new Set(manifest.entries.map((entry) => entry.file)).size).toBe(manifest.entries.length);
  });

  it("reads teams.json as the full 32-team league, not an empty or partial corpus", () => {
    const teams = readFixture("teams.json") as readonly { readonly teamAbv: string }[];
    expect(teams).toHaveLength(32);
    expect(teams.map((team) => team.teamAbv)).toContain("SF");
  });

  it("reads player-list.json with a known, specific player present", () => {
    const players = readFixture("player-list.json") as readonly { readonly playerID: string; readonly longName: string }[];
    const derek = players.find((player) => player.playerID === "10001");
    expect(derek?.longName).toBe("Derek Sanders");
  });
});
