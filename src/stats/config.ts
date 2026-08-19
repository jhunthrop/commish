/**
 * Every tunable the stats seam has.
 *
 * `tank01` is listed here before Task 10 implements it deliberately: the error message a
 * misconfiguration produces should name every provider the product intends to offer, and the
 * registry's own switch is what fails if one of them is not wired yet. A name in this list with
 * no implementation is a compile error, not a silent gap.
 */
export const STATS_CONFIG = {
  providers: ["mock", "tank01"] as const,
  /**
   * Mock, and not a live feed, is the default on purpose. A live feed costs money per request
   * and needs a key; a developer who has just cloned the repo should get a working season, and a
   * deployment that wants real data should have to say so.
   */
  defaultProvider: "mock",
  envVars: {
    provider: "STATS_PROVIDER",
    /** Only read when `provider` resolves to `mock`. See `MockProviderOptions.liveWeek`. */
    mockLiveWeek: "MOCK_STATS_LIVE_WEEK",
  },
} as const;

export type StatsProviderName = (typeof STATS_CONFIG.providers)[number];

export function isStatsProviderName(value: string): value is StatsProviderName {
  return (STATS_CONFIG.providers as readonly string[]).includes(value);
}
