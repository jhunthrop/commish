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
 * BLEND-SAFETY NOTE, CORRECTED (fix round, 2026-08-31): `src/projections/model/fitted.ts`'s own
 * `FIT_SEASONS` is `[2021, 2022]`, not `2021` alone. TWO of these three folds, 2021 AND 2022, sit
 * inside the projection model's fitting window; only 2023 is genuinely out-of-fit. That makes 2023
 * this replication guard's actual teeth: a law that agrees on 2021 and 2022, both seasons the
 * model already trained on, and disagrees on 2023, the one season it never saw, is confirmed on
 * nothing the model didn't already get to fit to. Requiring ALL THREE folds to agree, 2023
 * included, is what stops the two in-fit folds from being enough on their own to confirm a law —
 * a law confirmed only in-fit cannot confirm.
 *
 * `REPLICATION_FOLDS` repeats these season numbers rather than importing `FIT_SEASONS` from
 * `model/fitted.ts` — folds are evaluation-only and must never be folded back into a fitting
 * window in either direction, and keeping the two lists textually separate is part of that. The
 * cost is that they can drift apart silently: RE-CHECK THIS NOTE, AND WHICH FOLDS IT NAMES AS
 * IN-FIT VS. OUT-OF-FIT, ANY TIME `FIT_SEASONS` CHANGES.
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

/**
 * THE DISCOVERY TRAIN WINDOW — predictor seasons the candidate generator's quantile thresholds
 * (`discovery/quantiles.ts`) and Task 7's own BH-controlled testing pass are both fitted/tested on,
 * and on nothing later. `to: 2021` rather than `REPLICATION_FOLDS`' own range is deliberate: those
 * folds are for REPLICATING an already-surviving law across seasons a model may or may not have
 * fit on, while this window is for DISCOVERING candidates in the first place, and letting discovery
 * see 2022-2024 would let a candidate's very existence be chosen by seasons its own later
 * measurement is supposed to confirm against — the discovery-time analogue of `factsForSeason`
 * never reading the outcome season it is predicting.
 */
export const DISCOVERY_TRAIN_SEASONS = { from: MEASURE_SEASONS.from, to: 2021 } as const;
