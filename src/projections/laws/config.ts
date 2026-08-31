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

/** The full window a law's evidence is drawn from, held-out seasons included in the range. */
export const MEASURE_SEASONS = { from: 2011, to: 2024 } as const;

/** Bootstrap resampling: how many pair-resamples, and the seed that makes runs reproducible. */
export const BOOTSTRAP = { resamples: 1000, seed: 20260831 } as const;
