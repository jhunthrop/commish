/**
 * THE ONE LIST of dev/e2e fixture name prefixes (storefront review D1; flow analysis J04/D1).
 * Seeded and end-to-end-test leagues carry a name that starts with one of these — "E2E Money Dark
 * 1787678163994", "Mobile360UnbrokenOverlongIdentifierFixture" — never a name a real commissioner
 * or the house factory's own `houseLeagueName` pool would produce. Pure, no I/O, browser-safe
 * (this module lives in `@/matchmaking`, which `src/league-room/**` and `src/draft-room/**`
 * value-import directly — see `eslint.config.mjs`'s note on the browser-safe half of
 * `@/matchmaking`), so the prefix list is the ONE place either a query builder
 * (`notAFixtureLeague`, `@/league-service/browse`) or a future pure caller reads it from.
 *
 * Case-sensitive, prefix-only, on purpose: every fixture this codebase seeds spells its prefix
 * the same way every time (`e2e/global-setup.ts`, `e2e/*.spec.ts`), so a prefix match is precise
 * enough to never catch a real league's name by accident ("Free For All League" does not start
 * with "E2E " or "Mobile360") while still catching every fixture this repo currently seeds.
 * Neither prefix contains a SQL `LIKE` wildcard (`%`/`_`), so `notAFixtureLeague` can build its
 * pattern directly, with no escaping needed.
 */
export const FIXTURE_LEAGUE_NAME_PREFIXES: readonly string[] = ["E2E ", "Mobile360"];

/**
 * The pure predicate `notAFixtureLeague`'s SQL mirrors — exported so a future pure caller (a
 * component, a script) can ask the identical question without reaching for Postgres, the same
 * "one rule, two readers" discipline `matchesBrowseFilter`/`browseQuery` already hold each other
 * to (`@/matchmaking/filter`).
 */
export function isFixtureLeagueName(name: string): boolean {
  return FIXTURE_LEAGUE_NAME_PREFIXES.some((prefix) => name.startsWith(prefix));
}
