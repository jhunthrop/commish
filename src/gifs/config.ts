/**
 * Every tunable the GIF seam has.
 *
 * `"none"` is listed as a provider name, not merely a fallback string, so the registry's switch
 * (`src/gifs/registry.ts`) is exhaustive over the same union `isGifProviderName` validates — a
 * name added here with no case in that switch is a compile error, not a silent gap. `"giphy"` is
 * listed before Task 10 implements it deliberately, mirroring `STATS_CONFIG`'s `tank01` entry:
 * the error message a misconfiguration produces should name every provider the product intends
 * to offer.
 */
export const GIF_CONFIG = {
  providers: ["none", "giphy"] as const,
  /**
   * No GIF provider by default. A real provider needs a key (`GIPHY_API_KEY`) and costs money
   * per request; a developer who has just cloned the repo gets chat exactly as it always was —
   * text and emoji, no dead button, no broken search box. A deployment that wants GIFs has to
   * say so.
   */
  defaultProvider: "none",
  envVars: {
    provider: "GIF_PROVIDER",
  },
  /** How many results `GET /api/gifs/search` asks a provider for. A picker grid, not an infinite feed. */
  searchResultLimit: 12,
} as const;

export type GifProviderName = (typeof GIF_CONFIG.providers)[number];

export function isGifProviderName(value: string): value is GifProviderName {
  return (GIF_CONFIG.providers as readonly string[]).includes(value);
}
