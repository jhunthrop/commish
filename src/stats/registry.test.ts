import { afterEach, describe, expect, it } from "vitest";
import { createStatsProvider, UnknownStatsProviderError } from "./registry";
import { STATS_CONFIG } from "./config";

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
});
