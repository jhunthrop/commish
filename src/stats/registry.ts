import { envOr } from "@/lib/env";
import { STATS_CONFIG, isStatsProviderName, type StatsProviderName } from "./config";
import { createMockStatsProvider } from "./mock/mock-stats-provider";
import type { StatsProvider } from "./provider";

/**
 * A configured provider name that no implementation answers to.
 *
 * Its own class, not a bare `Error`, because the one thing that must never happen here is a
 * silent fallback: a deployment configured for a live feed that quietly serves the fixed 2026
 * mock season would look completely healthy and would be completely wrong.
 */
export class UnknownStatsProviderError extends Error {
  readonly name = "UnknownStatsProviderError";
  readonly provider: string;
  constructor(provider: string) {
    super(
      `Unknown stats provider "${provider}". Set ${STATS_CONFIG.envVars.provider} to one of: ${STATS_CONFIG.providers.join(", ")}.`,
    );
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
    case "mock":
      return createMockStatsProvider();
    case "tank01":
      // Task 10 replaces this. Until then the name is reachable and the failure is explicit,
      // which is strictly better than the name not existing: `STATS_PROVIDER=tank01` says what
      // is missing rather than reading as a typo.
      throw new Error("The tank01 stats provider is not wired up yet.");
  }
}
