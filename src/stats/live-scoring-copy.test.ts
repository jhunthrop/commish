import { afterEach, describe, expect, it } from "vitest";
import { liveScoringCopy } from "./live-scoring-copy";
import { STATS_CONFIG } from "./config";
import { UnknownStatsProviderError } from "./registry";

afterEach(() => {
  delete process.env[STATS_CONFIG.envVars.provider];
});

describe("liveScoringCopy", () => {
  it("names the mock stat set, not live games, when nothing is configured", () => {
    expect(liveScoringCopy()).toBe("Scores come from this preview's 2026 stat set, not from live games.");
  });

  it("says scores update live when the configured provider is tank01", () => {
    process.env[STATS_CONFIG.envVars.provider] = "tank01";
    expect(liveScoringCopy()).toBe("Scores update from live game data while games are being played.");
  });

  it("takes an explicit provider name over the environment", () => {
    expect(liveScoringCopy("tank01")).toBe("Scores update from live game data while games are being played.");
  });

  it("fails fast, by name, on a provider that does not exist", () => {
    expect(() => liveScoringCopy("sportsdataio")).toThrow(UnknownStatsProviderError);
  });
});
