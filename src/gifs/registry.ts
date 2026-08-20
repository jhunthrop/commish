import { envOr, envOrUndefined } from "@/lib/env";
import { GIF_CONFIG, isGifProviderName, type GifProviderName } from "./config";
import { GIPHY_CONFIG } from "./giphy/config";
import { createGiphyGifProvider } from "./giphy/giphy-gif-provider";
import type { GifProvider } from "./provider";

/**
 * A configured provider name that no implementation answers to. Mirrors
 * `UnknownStatsProviderError` (`src/stats/registry.ts`) for the same reason: the one thing that
 * must never happen here is a silent fallback to `"none"` for a deployment that meant to
 * configure a real one.
 */
export class UnknownGifProviderError extends Error {
  readonly provider: string;
  constructor(provider: string) {
    super(`Unknown GIF provider "${provider}". Set ${GIF_CONFIG.envVars.provider} to one of: ${GIF_CONFIG.providers.join(", ")}.`);
    this.name = "UnknownGifProviderError";
    this.provider = provider;
  }
}

/**
 * `GIF_PROVIDER=none` (the default) returns null, and null means the picker is never rendered and
 * the search route 404s. That is the degrade path: chat stays exactly what it is today, text and
 * emoji, with no broken search box and no empty result grid explaining itself.
 *
 * An unrecognized provider name FAILS FAST with a clear typed error rather than falling back to
 * none, matching `src/stats/registry.ts`: a typo in a deploy's env is a misconfiguration to be
 * shouted about, not a feature to silently lose.
 */
export function createGifProvider(name: string = envOr(GIF_CONFIG.envVars.provider, GIF_CONFIG.defaultProvider)): GifProvider | null {
  if (!isGifProviderName(name)) throw new UnknownGifProviderError(name);
  return build(name);
}

function build(name: GifProviderName): GifProvider | null {
  switch (name) {
    case "none":
      return null;
    case "giphy": {
      const apiKey = envOrUndefined(GIPHY_CONFIG.envVars.apiKey);
      if (apiKey === undefined) {
        throw new Error(
          `${GIF_CONFIG.envVars.provider}=giphy needs ${GIPHY_CONFIG.envVars.apiKey}. Get a key from developers.giphy.com and put it in .env.local.`,
        );
      }
      return createGiphyGifProvider({ apiKey });
    }
  }
}
