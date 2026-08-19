import { afterEach, describe, expect, it } from "vitest";
import { createStatsProvider, UnknownStatsProviderError } from "./registry";
import { STATS_CONFIG } from "./config";
import { TANK01_CONFIG } from "./tank01/config";

afterEach(() => {
  delete process.env[STATS_CONFIG.envVars.provider];
});

describe("createStatsProvider", () => {
  it("defaults to the mock provider when nothing is configured", async () => {
    const provider = createStatsProvider();
    expect((await provider.listPlayers()).length).toBeGreaterThan(0);
  });

  it("reads the provider name from the environment", async () => {
    process.env[STATS_CONFIG.envVars.provider] = "mock";
    const provider = createStatsProvider();
    expect((await provider.listPlayers()).length).toBeGreaterThan(0);
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

  it("builds tank01 with an explicit season when TANK01_SEASON is set", () => {
    process.env[TANK01_CONFIG.envVars.apiKey] = "test-key";
    process.env[TANK01_CONFIG.envVars.season] = "2025";
    expect(() => createStatsProvider("tank01")).not.toThrow();
    delete process.env[TANK01_CONFIG.envVars.apiKey];
    delete process.env[TANK01_CONFIG.envVars.season];
  });
});
