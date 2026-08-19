# Decision: the stats-provider seam

**Date:** 2026-08-19 · **Phase 2, Plan A** · Spec: `plans/phase-2-accounts-and-data-foundation.md` Step 6

## What this seam guarantees

`StatsProvider` (`src/stats/provider.ts`) is two methods: `listPlayers()` and
`getWeeklyStatLines(week)`. `createStatsProvider(name?)` (`src/stats/registry.ts`) is the one
place a name becomes an implementation, selected by `STATS_PROVIDER`, defaulting to `mock`, and
throwing `UnknownStatsProviderError` by name on anything else.

`describeStatsProviderContract` (`src/stats/test-support.ts`) is what "an implementation" means:
stable non-empty ids, known positions, stat lines stamped with the requested week, every stat
field finite and non-negative, no player reported twice, no stats for a player the provider does
not also list, and an empty list rather than an error for a week outside the season. Both
implementations run it. A future licensed feed runs the same suite unchanged.

## What it deliberately does not guarantee

- **It does not carry a season.** `getWeeklyStatLines(week)` takes a week and nothing else. A
  season is adapter configuration (`TANK01_CONFIG.defaultSeason`, `TANK01_SEASON`), because
  adding it to the interface would ripple into `player_stat_lines`, which is keyed
  `(player_id, week)` and has no season column. It does not need one until a phase runs more
  than one season at a time, and inventing the column now would be building for a requirement
  nobody has.
- **It does not promise determinism.** The mock is deterministic and its own test asserts that.
  A live feed is not, so the shared contract does not demand it.
- **It does not select a vendor.** Contracting a licensed stats provider (SportsDataIO,
  SportRadar, Genius Sports) is a business and legal decision, deferred to Phase 8. Tank01 is a
  development and proving feed, not a licensing decision.

## Provider ids are not portable, and that is fine

`players.id` is whatever the selected provider calls a player. The mock's ids and Tank01's ids
(which are mostly ESPN ids) do not overlap, so switching providers means re-seeding, not
migrating. That is the correct trade at this point: an id-mapping table would be real ongoing
complexity bought to avoid a `npm run seed` nobody has needed to avoid.

## Tank01, and how a key activates it

`src/stats/tank01/` is split three ways on purpose: `client.ts` does HTTP and typed failures and
no mapping, `map.ts` is pure and does mapping and no I/O, and `tank01-stats-provider.ts`
composes them. The mapper is therefore unit-testable against literal payloads, and the client is
testable against an injected `fetch`.

**No key was needed to build it.** Every test serves committed fixture bodies through
`createFixtureFetch()`, and both Tank01 suites replace `globalThis.fetch` with a thrower so a
path that fell back to it fails by name instead of making a real billable request. The fixtures
carry a `provenance` field in `fixtures/manifest.json` that reads
`authored-from-published-response-shapes` until `npm run stats:tank01:record` is run with a real
key, at which point it becomes `recorded-from-live-api` with a timestamp. **The adapter's tests
must pass unchanged across that flip.** If they do not, the authored fixtures were wrong about
the upstream shape and the recording run is what caught it. That is the whole design.

**To activate:** subscribe a RapidAPI key to the Tank01 NFL API, put it in `.env.local` as
`TANK01_API_KEY`, set `STATS_PROVIDER=tank01`, run `npm run stats:tank01:record`, review the
fixture diff, then `npm run seed`. No code change.

## The three upstream behaviors the adapter is shaped by

1. **Everything is a string.** `statusCode` on the envelope is the only number in a response.
   Every read goes through a parser that yields 0 for anything non-finite, because one `NaN`
   reaching `computeFantasyPoints` turns a team's weekly total into `NaN` and does it silently.
2. **HTTP 200 is not success.** An application-level refusal returns 200 with `body: {}` and an
   `error` key; gateway failures (401, 403, 429) return `{"message": …}` with no envelope at
   all. A status-only check maps a refusal to a quiet week rather than to a failure.
3. **`fumblesLost` is under the `Defense` group, for every player.** A quarterback who fumbles
   gets a `Defense` group containing it. Stat groups are absent rather than empty when a player
   has none, so every group read is defaulted.

## Cost

The free tier is 1,000 requests a month. `listPlayers()` costs two requests. One week of stat
lines costs one schedule request plus roughly sixteen box scores. A full 18-week backfill is
about 300 requests. `getWeeklyStatLines` fetches box scores **sequentially**, not in parallel: a
burst is the fastest way to a 429, and a rate-limit failure part way through a burst leaves you
unable to say which games you got.
