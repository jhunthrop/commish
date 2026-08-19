import { envOr, envOrUndefined, parsePositiveInteger } from "@/lib/env";
import { STATS_CONFIG, isStatsProviderName, type StatsProviderName } from "./config";
import { createMockStatsProvider } from "./mock/mock-stats-provider";
import type { StatsProvider } from "./provider";
import { createTank01StatsProvider } from "./tank01/tank01-stats-provider";
import { TANK01_CONFIG } from "./tank01/config";

/**
 * A configured provider name that no implementation answers to.
 *
 * Its own class, not a bare `Error`, because the one thing that must never happen here is a
 * silent fallback: a deployment configured for a live feed that quietly serves the fixed 2026
 * mock season would look completely healthy and would be completely wrong.
 */
export class UnknownStatsProviderError extends Error {
  readonly provider: string;
  constructor(provider: string) {
    super(
      `Unknown stats provider "${provider}". Set ${STATS_CONFIG.envVars.provider} to one of: ${STATS_CONFIG.providers.join(", ")}.`,
    );
    this.name = "UnknownStatsProviderError";
    this.provider = provider;
  }
}

/**
 * The ONE place a provider name becomes an implementation.
 *
 * `envOr`, not `process.env[...] ?? default`: `.env.example` may ship `STATS_PROVIDER=` as an
 * intentionally-empty line, and dotenv reads that as `""`, which `??` would happily accept as a
 * provider named empty string. See `src/lib/env.ts`.
 */
export function createStatsProvider(name: string = envOr(STATS_CONFIG.envVars.provider, STATS_CONFIG.defaultProvider)): StatsProvider {
  if (!isStatsProviderName(name)) throw new UnknownStatsProviderError(name);
  return build(name);
}

function build(name: StatsProviderName): StatsProvider {
  switch (name) {
    case "mock": {
      const liveWeek = envOrUndefined(STATS_CONFIG.envVars.mockLiveWeek);
      return createMockStatsProvider(undefined, {
        liveWeek: liveWeek === undefined ? undefined : parsePositiveInteger(STATS_CONFIG.envVars.mockLiveWeek, liveWeek),
      });
    }
    case "tank01": {
      const apiKey = envOrUndefined(TANK01_CONFIG.envVars.apiKey);
      if (apiKey === undefined) {
        throw new Error(
          `${STATS_CONFIG.envVars.provider}=tank01 needs ${TANK01_CONFIG.envVars.apiKey}. Get a key from RapidAPI's Tank01 NFL API and put it in .env.local.`,
        );
      }
      const season = envOrUndefined(TANK01_CONFIG.envVars.season);
      return createTank01StatsProvider({
        apiKey,
        season: season === undefined ? undefined : parsePositiveInteger(TANK01_CONFIG.envVars.season, season),
      });
    }
  }
}
