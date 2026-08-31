/**
 * THE LAW HARNESS'S FIXED CONSTANTS — one measurement window, shared by every law.
 *
 * Laws are comparable to each other only if they are all measured over the same seasons with the
 * same held-out years and the same bootstrap procedure. Letting each law pick its own window would
 * let a law's author quietly tune the window until the effect looked good, which is the exact
 * failure mode this harness exists to prevent.
 */

/**
 * ROLLING REPLICATION FOLDS — PREDICTOR seasons (outcome = predictor + 1), replacing the old
 * single held-out-pair-of-years shape. `scripts/measure-laws.ts` partitions the full window's own
 * matched pairs into one subset per fold (a pair's predictor season decides its fold, the same
 * partition-not-a-second-match property the old held-out subset had); `registry.ts`'s
 * `verdictForFullWindow` requires EVERY fold that matched at least one pair to agree in direction
 * with the full-window effect before a law can be `confirmed` — a fold that disagrees, or zero
 * folds matching any pairs at all, caps the verdict at `weak`.
 *
 * BLEND-SAFETY NOTE FOR LATER TASKS: predictor seasons at or before 2021 remain the only FITTING
 * window anywhere else in this plan (`src/projections/model/fitted.ts`'s own `FIT_SEASONS`).
 * Folds named here are evaluation-only and must never be folded back into a fitting window in
 * either direction. Fold 2021 overlaps that fitting window on purpose, not by oversight: a law
 * confirmed on 2022 and 2023 alone, with 2021 left unchecked, would still be confirmed on nothing
 * but out-of-fit evidence, which sounds safe but is not the actual bar. The bar is that a law
 * confirmed here has to also point the right way on the very seasons the model trained on — a law
 * that fails that check is telling you the model's own training data does not behave the way the
 * law claims, which is exactly the kind of contradiction this harness exists to surface, not paper
 * over by only checking the folds already known to be safe. Requiring ALL THREE folds to agree,
 * the two out-of-fit folds (2022, 2023) included, is what keeps the in-fit fold from being enough
 * on its own to confirm a law: a law confirmed only in-fit cannot confirm.
 */
export const REPLICATION_FOLDS: readonly number[] = [2021, 2022, 2023];

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
