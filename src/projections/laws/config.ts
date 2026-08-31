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
 * rows nflverse never published rather than measuring anything. Within the window, 2019 is a HOLE:
 * nflverse's `stats_player_week_2019.csv` release does not exist (a deterministic 404), so no
 * stat-line season for 2019 is ever built. That hole needs no special-case code anywhere in this
 * harness — every `PlayerSeasonPoint` whose season-N+1 outcome cannot be read already drops out
 * under the tri-state "no evidence is not false" rule (`populations.ts`'s own docblock), and a
 * missing 2019 stat line is exactly that: no evidence, not a zero.
 */
export const MEASURE_SEASONS = { from: 2013, to: 2024 } as const;

/** Bootstrap resampling: how many pair-resamples, and the seed that makes runs reproducible. */
export const BOOTSTRAP = { resamples: 1000, seed: 20260831 } as const;
