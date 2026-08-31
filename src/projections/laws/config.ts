/**
 * THE LAW HARNESS'S FIXED CONSTANTS — one measurement window, shared by every law.
 *
 * Laws are comparable to each other only if they are all measured over the same seasons with the
 * same held-out years and the same bootstrap procedure. Letting each law pick its own window would
 * let a law's author quietly tune the window until the effect looked good, which is the exact
 * failure mode this harness exists to prevent.
 */

/** Seasons excluded from measurement — reserved for backtesting the model that laws gate. */
export const HELD_OUT_SEASONS = [2023, 2024] as const;

/**
 * The full window a law's evidence is drawn from, held-out seasons included in the range.
 *
 * `from: 2013` is the earlier of two floors nflverse itself imposes, not a choice: snap counts (what
 * `touches`/`targetShare` are built from) are unusable before 2013 — 2012 is missing its own week 1
 * and 2011 has no snap-count file at all, so a population that reached back to 2011 would be reading
 * rows nflverse never published rather than measuring anything.
 *
 * WITHIN THE WINDOW, 2019 WAS A HOLE, AND IS NOW FILLED (updated, fix round). nflverse's
 * `stats_player_week_2019.csv` release does not exist (a deterministic 404) — that upstream fact has
 * not changed — but this harness no longer treats a missing 2019 stat line as no-evidence-by-default.
 * `laws/populations.ts`'s `factsForSeason`/`actualPointsPerGame` read through
 * `nflverse/derived-stat-lines.ts`'s `statLinesAsOfForMeasurement` with `admitDerived: true`
 * (`buildPopulations`'s own call), which admits a pbp-derived stat line for exactly the seasons named
 * in `STAT_LINE_GAPS` — validated, before it ever ships, against a season nflverse DID publish
 * (`seasonPointsAgreement`'s 0.99 rank-correlation bar; see `scripts/projection-backfill.ts`). A
 * `PlayerSeasonPoint` whose season-N+1 outcome falls in 2019 is measured on the derived line now. The
 * tri-state "no evidence is not false" rule (`populations.ts`'s own docblock) still applies to a
 * player-season with genuinely no line at all — derived included — which is the only way this window
 * still comes up short of a full season's worth of matched pairs.
 *
 * A PRODUCT SURFACE NEVER SEES THIS FALLBACK. `factsForSeason`'s `admitDerived` parameter is explicit
 * precisely so the laws harness's own use of the derivation cannot leak into `preseason/source.ts`'s
 * `loadPreseason` (a live board), which passes `admitDerived: false` and reads published history
 * only, forever.
 */
export const MEASURE_SEASONS = { from: 2013, to: 2024 } as const;

/** Bootstrap resampling: how many pair-resamples, and the seed that makes runs reproducible. */
export const BOOTSTRAP = { resamples: 1000, seed: 20260831 } as const;
