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
 * `from: 2003` AS OF THE 2026-09-01 DISCOVERY-EXPANSION ROUND. It was 2013 for as long as the store
 * reached no further back, and the reason given was the snap counts: `touches`/`targetShare` are
 * built from participation rows, and nflverse publishes no snap-count file before 2013 (2012's is
 * header-only, 2011 and older are 404s — now recorded as `SNAP_COUNT_ASSET_FLOOR`, `nflverse/map.ts`).
 * That upstream fact has NOT changed. What changed is that stat lines now reach back to 2003
 * (51,108 lines / 715,512 observations, 100% player resolution every season, plus schedules for
 * 2003-2010 so every older line can be dated), so the seasons below 2013 are no longer empty of
 * evidence — they are empty of PARTICIPATION evidence only.
 *
 * WHAT THAT ASYMMETRY MEANS, MEASURED RATHER THAN ASSUMED (`window-probe.ts`, Task 1 of the round):
 * of the six tribal laws, exactly ONE gains anything from the extension — `td_regression`, which is
 * built from stat lines alone, gains roughly 82% more population. The other five gain exactly zero
 * pairs, each blocked by a NAMED missing input rather than by a vague one: `rb_workload_cliff` and
 * `target_share_persistence` need snap-count-derived touches and target share;
 * `wr_target_competition` needs the per-week team edge `mapPlayerTeams` builds from the same
 * snap-count file; `rb_age_curve` needs `age` from `preseason_rosters`, not backfilled below
 * `HISTORICAL_ROSTER_FLOOR`; `play_caller_fingerprint` needs coach pace and pass-rate history, which
 * exists only from 2013. TWO OF THOSE FIVE BLOCKERS WERE LIFTED BY FIT-ROUND TASK 1, which moved
 * `HISTORICAL_ROSTER_FLOOR` to 2003 (so `rb_age_curve` and every `age`-conditioned discovery
 * candidate can see the old decade) and backfilled `player_week_teams` for 2003-2012 from the
 * published weekly stats' own team column (so `wr_target_competition` and `incomingTeamWinTotal` can
 * resolve a player to a team there). The other three are unchanged: participation and coach history
 * still begin at 2013. A law that cannot see a season simply matches no pair in it, which is the
 * tri-state "no evidence is not false" rule doing its ordinary job, not a silent degradation.
 *
 * THIS CONSTANT IS NOT DEFINED BY `HISTORICAL_ROSTER_FLOOR` OR `SNAP_COUNT_ASSET_FLOOR`. All three
 * read 2013 and were once documented as agreeing; they answer three different questions. Two of them
 * read 2003 again today (this one moved on 2026-09-01, the roster floor on 2026-09-02, each by its
 * own separate decision) and `SNAP_COUNT_ASSET_FLOOR` is still 2013. Agreement between any two of
 * them is a coincidence to be re-checked, never an equality to be relied on. Any prose that reads "matches `MEASURE_SEASONS.from`" is about the old
 * coincidence and has been corrected at its own site.
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
export const MEASURE_SEASONS = { from: 2003, to: 2024 } as const;

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
 *
 * `from` IS DEFINED AS `MEASURE_SEASONS.from` AND THEREFORE MOVED WITH IT, to 2003 (2026-09-01
 * round). This window is what `scripts/discovery-quantile-fit.ts` fits every threshold in
 * `discovery/quantiles.ts` on, so widening it re-fits the whole table: a quantity the older seasons
 * CAN see (points per game, games played, touchdowns) now has a decade more of observations behind
 * its percentiles, and one they cannot (age, snap share, draft pick, anything roster- or
 * participation-derived) keeps exactly the same threshold it had, because `computeQuantileTable`
 * ignores a null value rather than counting it as a zero. Refitting the table is a mandatory step of
 * any change to this constant: the generator SKIPS a (quantity, position, level) the table does not
 * carry, so a stale table silently shrinks the candidate family instead of failing.
 */
export const DISCOVERY_TRAIN_SEASONS = { from: MEASURE_SEASONS.from, to: 2021 } as const;

/**
 * THE LAW TRAIN CUTOFF (C1 fix round, 2026-08-31) — the predictor-season boundary
 * `registry.ts`'s `trainEffectFor` measures every law's OWN train-only effect against, restricted
 * to pairs whose predictor season is at or before this value. `market/blend.ts`'s law delta reads
 * a law's `trainEffect`, never its full-window `measured.effect`: the full window runs through
 * `MEASURE_SEASONS.to - 1` (2023), which overlaps the final-bar seasons (2023, 2024) `blend.ts`'s
 * own docblock calls untouchable by any fitting — a delta sized off the full-window effect would
 * let 2023/2024 outcome information leak into a score later judged on those same seasons.
 *
 * SAME VALUE AS `DISCOVERY_TRAIN_SEASONS.to`, KEPT TEXTUALLY SEPARATE (see `REPLICATION_FOLDS`'s own
 * docblock for why: two constants that happen to agree today must not be silently assumed to track
 * each other forever). `DISCOVERY_TRAIN_SEASONS.to` bounds what a discovered candidate's OWN
 * antecedent may be screened on; `LAW_TRAIN_CUTOFF_SEASON` bounds what ANY law's (tribal or
 * discovered) `trainEffect` may be MEASURED on, a related but distinct question a discovered law
 * already answers for itself via `measureCandidateOnTrain`'s own `trainEffect` (carried straight
 * through rather than recomputed — see `discovery/measure.ts`). Also the same boundary Task 10's
 * market curve, rookie curve and blend fit constants train through (`MARKET_CURVE_TRAIN_CUTOFF_SEASON`,
 * `ROOKIE_CURVE_TRAIN_CUTOFF_SEASON`, `BLEND_TRAIN_CUTOFF_SEASON`, each 2021) — one predictor-season
 * boundary the whole engine treats as the edge of what a train-time number may see, named once per
 * module rather than imported across module boundaries.
 */
export const LAW_TRAIN_CUTOFF_SEASON = 2021;
