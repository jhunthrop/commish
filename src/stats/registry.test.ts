import { afterEach, describe, expect, it } from "vitest";
import { createStatsProvider, UnknownStatsProviderError } from "./registry";
import { STATS_CONFIG } from "./config";
import { TANK01_CONFIG } from "@research/stats/tank01/config";

afterEach(() => {
  delete process.env[STATS_CONFIG.envVars.provider];
});

describe("createStatsProvider", () => {
  it("defaults to the mock provider when nothing is configured", async () => {
    const provider = createStatsProvider();
    expect((await provider.listPlayers()).length).toBeGreaterThan(0);
  });

  it("reads the provider name from the environment", async () => {
    // STATS_PROVIDER=mock is indistinguishable from doing nothing at all — the mock is also the
    // default. Selecting tank01 through the SAME env var, and observing it actually attempt a
    // request the mock provider never would, proves the env var is what chose it.
    process.env[STATS_CONFIG.envVars.provider] = "tank01";
    process.env[TANK01_CONFIG.envVars.apiKey] = "test-key";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("env-selected tank01 provider attempted a real request");
    }) as typeof globalThis.fetch;
    try {
      const provider = createStatsProvider();
      await expect(provider.listPlayers()).rejects.toThrow("env-selected tank01 provider attempted a real request");
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env[TANK01_CONFIG.envVars.apiKey];
    }
  });

  it("treats an empty environment value as unset, not as a provider named ''", () => {
    process.env[STATS_CONFIG.envVars.provider] = "";
    expect(() => createStatsProvider()).not.toThrow();
  });

  it("fails fast, by name, on a provider that does not exist", () => {
    expect(() => createStatsProvider("sportsdataio")).toThrow(UnknownStatsProviderError);
    expect(() => createStatsProvider("sportsdataio")).toThrow(
      'Unknown stats provider "sportsdataio". Set STATS_PROVIDER to one of: mock, tank01.',
    );
  });

  it("never silently falls back to mock data for an unknown name", () => {
    // The failure mode this guards is the worst one available here: a deployment that thinks it
    // is serving a live feed and is quietly serving a fixed 2026 fake season instead.
    process.env[STATS_CONFIG.envVars.provider] = "definitely-not-a-provider";
    expect(() => createStatsProvider()).toThrow(UnknownStatsProviderError);
  });

  it("refuses tank01 without a key, and says which variable to set", () => {
    delete process.env[TANK01_CONFIG.envVars.apiKey];
    expect(() => createStatsProvider("tank01")).toThrow(TANK01_CONFIG.envVars.apiKey);
  });

  it("builds tank01 when a key is present, without making any request", () => {
    process.env[TANK01_CONFIG.envVars.apiKey] = "test-key";
    expect(() => createStatsProvider("tank01")).not.toThrow();
    delete process.env[TANK01_CONFIG.envVars.apiKey];
  });

  it("builds tank01 with an explicit season when TANK01_SEASON is set, and sends the parsed value on the wire", async () => {
    process.env[TANK01_CONFIG.envVars.apiKey] = "test-key";
    process.env[TANK01_CONFIG.envVars.season] = "2025";
    const requestedUrls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => {
      requestedUrls.push(typeof input === "string" ? input : input.toString());
      return new Response(JSON.stringify({ statusCode: 200, body: [] }), { status: 200 });
    }) as typeof globalThis.fetch;
    try {
      const provider = createStatsProvider("tank01");
      await provider.getWeeklyStatLines(1);
      expect(requestedUrls.some((url) => url.includes("season=2025"))).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env[TANK01_CONFIG.envVars.apiKey];
      delete process.env[TANK01_CONFIG.envVars.season];
    }
  });

  it("fails fast on a TANK01_SEASON that is not a positive integer, naming the variable", () => {
    process.env[TANK01_CONFIG.envVars.apiKey] = "test-key";
    process.env[TANK01_CONFIG.envVars.season] = "banana";
    expect(() => createStatsProvider("tank01")).toThrow(TANK01_CONFIG.envVars.season);
    delete process.env[TANK01_CONFIG.envVars.apiKey];
    delete process.env[TANK01_CONFIG.envVars.season];
  });

  it("builds the mock provider with no live week by default, matching Plan A's shipped behavior", async () => {
    const provider = createStatsProvider("mock");
    const games = await provider.listGames(1);
    expect(games.every((game) => game.status === "final")).toBe(true);
  });

  it("builds the mock provider with the configured live week when MOCK_STATS_LIVE_WEEK is set", async () => {
    process.env[STATS_CONFIG.envVars.mockLiveWeek] = "2";
    try {
      const provider = createStatsProvider("mock");
      const liveGames = await provider.listGames(2);
      expect(liveGames.every((game) => game.status === "in_progress")).toBe(true);
      const finalGames = await provider.listGames(1);
      expect(finalGames.every((game) => game.status === "final")).toBe(true);
    } finally {
      delete process.env[STATS_CONFIG.envVars.mockLiveWeek];
    }
  });

  it("fails fast on a MOCK_STATS_LIVE_WEEK that is not a positive integer, naming the variable", () => {
    process.env[STATS_CONFIG.envVars.mockLiveWeek] = "banana";
    try {
      expect(() => createStatsProvider("mock")).toThrow(STATS_CONFIG.envVars.mockLiveWeek);
    } finally {
      delete process.env[STATS_CONFIG.envVars.mockLiveWeek];
    }
  });
});
