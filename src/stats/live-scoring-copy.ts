import { envOr } from "@research/lib/env";
import { STATS_CONFIG, isStatsProviderName, type StatsProviderName } from "./config";
import { UnknownStatsProviderError } from "./registry";

/**
 * One sentence per provider, said once on the matchups page footer. Provider-driven rather than
 * hardcoded because whether the sentence is true depends on which provider is running: "there's
 * no live scoring yet" stopped being true the moment a feed existed, and saying so unconditionally
 * would be a lie in the product's own voice for any deployment configured for `tank01`.
 */
const LIVE_SCORING_COPY: Readonly<Record<StatsProviderName, string>> = {
  mock: "Scores come from a preview 2026 stat set, not from live games.",
  tank01: "Scores update from live game data while games are being played.",
};

/**
 * The active provider's own sentence. Reads the SAME env var `createStatsProvider`
 * (`./registry.ts`) does, through the same `envOr` helper, but never builds a provider — the
 * copy doesn't need a live connection or an API key, just the configured name, so a `tank01`
 * deployment missing its key can still render this line.
 */
export function liveScoringCopy(name: string = envOr(STATS_CONFIG.envVars.provider, STATS_CONFIG.defaultProvider)): string {
  if (!isStatsProviderName(name)) throw new UnknownStatsProviderError(name);
  return LIVE_SCORING_COPY[name];
}
