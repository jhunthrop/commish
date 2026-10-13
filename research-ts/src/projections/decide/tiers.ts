/**
 * WHERE A POSITION FALLS OFF, in units a manager already thinks in.
 *
 * A tier is a run of players a drafter would be roughly indifferent between. Two rules draw them,
 * both stated in games and points per game rather than in a fitted statistic:
 *
 *   1. A NEW TIER STARTS where the next player projects at least a full game's worth of production
 *      less than the one above him (`TIER_BREAK_GAMES / GAMES_PER_SEASON` of the man above). The
 *      break is a SHARE, not a fixed point gap, because positions score on different scales: the
 *      seventeen points between Nacua and Chase are a smaller slice of a receiver's season than
 *      the sixteen between Robinson and Achane are of a back's, and a fixed gap either split the
 *      receivers into singletons or glued Achane to the top two. The founder's own tier sheet
 *      (2026-09-05) is the fixture the rule was shaped against; see the tests.
 *   2. NO TIER STRETCHES more than `TIER_SPAN_POINTS_PER_GAME` points a game end to end. A long
 *      run of small steps (the middle of the receiver pool) would otherwise be one tier of thirty;
 *      it splits at its widest internal gaps, into as many tiers as that natural split needs to
 *      fit under the cap. Deliberately NOT the fewest tiers that could fit: squeezing twelve
 *      receivers into two tiers of thirty-four cuts between Jefferson and London, a three point
 *      step, and a cut on a narrow gap made only to save a tier is not a break anyone would draw.
 *
 * Both constants are chosen, not fitted: there is no held-out measurement of "the tier a human
 * expert would draw", and quoting a fitted-looking number would be a claim we cannot support. The
 * previous rule compared each gap to the position's median gap, and the flat tail of every pool
 * set that median so low that ordinary spacing at the top read as one cliff per row.
 *
 * The spec's own rule (a cliff is where the gap exceeds the players' overlap) stays shelved until
 * the model emits a per-game distribution; `preseason/board.ts`'s `overlapTiers` explains why.
 *
 * Tiers are consumed by the draft recommendation, where the useful question is never "which tier
 * is he in" but "how many men are left before the drop, and how big is the drop".
 */

/** Regular-season games a player can play; the unit both tier constants are stated in. */
export const GAMES_PER_SEASON = 17;

/** A new tier starts where the next player gives up at least this many games' worth of production. */
export const TIER_BREAK_GAMES = 1;

/** No tier stretches more than this many points a game from its best player to its worst. */
export const TIER_SPAN_POINTS_PER_GAME = 2;

const TIER_SPAN_POINTS = TIER_SPAN_POINTS_PER_GAME * GAMES_PER_SEASON;

/**
 * Whether the step from one player down to the next is at least a game's worth of what the man
 * above is projected to produce. Written as a cross-multiplication so a non-positive projection
 * above reads as "no break" rather than a division by nothing.
 *
 * THE STEP AND THE DENOMINATOR ARE TWO QUANTITIES, not one (the Overall bands, 2026-09-12). The
 * step is measured on whatever key the ladder is ORDERED by; the denominator is always the man
 * above's own SEASON PRODUCTION, because "a game's worth" is only a unit at all when it is a
 * share of what he actually scores. Inside one position the two coincide — a drop of eight points
 * of value is a drop of eight points, and `aboveProduction === aboveKey` — which is why a position
 * pool passes one array and gets exactly the rule it always had. Across positions they do not: a
 * board ordered by points over replacement has a key that runs to zero at the bottom, and a share
 * OF THE KEY would call an ordinary two point step near the tail a cliff and cut the whole board
 * into tiers of one.
 */
function isTierBreak(aboveProduction: number, aboveKey: number, belowKey: number): boolean {
  return aboveProduction > 0 && (aboveKey - belowKey) * GAMES_PER_SEASON >= aboveProduction * TIER_BREAK_GAMES;
}

/**
 * WHETHER THE DROP BELOW A PLAYER IS A CLIFF WORTH NAMING (dossier-voice round §3.3, from the
 * founder's own McCaffrey read: "for every player we say 'last man in his tier', that doesn't mean
 * they shouldn't be drafted").
 *
 * A tier boundary is not automatically a cliff. Rule 2 above splits a long run of small steps at
 * its widest internal gaps to hold a tier under the span cap, so a perfectly ordinary 3.2 point
 * step can end a tier — and a reason that fires on any positive drop turns that step into a
 * warning nobody would give out loud. This is the SAME games-worth share rule 1 uses, applied to
 * the player's own projection: the drop behind him has to be worth at least a game of what he
 * himself is projected for. Written as a cross-multiplication for the same reason `isTierBreak`
 * is: a non-positive projection reads as "no cliff", never as a division by nothing.
 *
 * BOTH EMITTERS ASK THIS ONE FUNCTION — the draft recommendation's own pick reason
 * (`decide/draft.ts`, which keeps `TIER_IS_THIN_AT` on top of it) and the stored board reason
 * (`preseason/board.ts`, which is the one the player peek's verdict actually reads back). A
 * threshold that lived in only one of the two would be a rule the product does not keep.
 */
export function isRealTierCliff(ownProjectedPoints: number, dropToNextTier: number): boolean {
  return ownProjectedPoints > 0 && dropToNextTier * GAMES_PER_SEASON >= ownProjectedPoints * TIER_BREAK_GAMES;
}

/** Indices at which a new run starts under rule 1, always beginning with zero. */
function runStarts(keyDescending: readonly number[], productionByRow: readonly number[]): readonly number[] {
  return keyDescending.flatMap((key, index) =>
    index === 0 || isTierBreak(productionByRow[index - 1]!, keyDescending[index - 1]!, key) ? [index] : [],
  );
}

/**
 * The contiguous split of a sorted run into `count` groups with the least within-group spread,
 * which places every cut on the run's widest gaps (exact dynamic programme over prefix sums; runs
 * are a few dozen players, so the cubic bound is nothing). Returns the group index per player.
 */
function leastSpreadSplit(run: readonly number[], count: number): readonly number[] {
  const size = run.length;
  const prefix = run.reduce<number[]>((sums, value) => [...sums, sums[sums.length - 1]! + value], [0]);
  const prefixSquares = run.reduce<number[]>((sums, value) => [...sums, sums[sums.length - 1]! + value * value], [0]);
  const spread = (from: number, to: number): number => {
    const members = to - from + 1;
    const sum = prefix[to + 1]! - prefix[from]!;
    return prefixSquares[to + 1]! - prefixSquares[from]! - (sum * sum) / members;
  };

  const cost = Array.from({ length: count + 1 }, () => Array<number>(size).fill(Number.POSITIVE_INFINITY));
  const firstOfLast = Array.from({ length: count + 1 }, () => Array<number>(size).fill(0));
  for (let last = 0; last < size; last += 1) cost[1]![last] = spread(0, last);
  for (let groups = 2; groups <= count; groups += 1) {
    for (let last = groups - 1; last < size; last += 1) {
      for (let first = groups - 1; first <= last; first += 1) {
        const candidate = cost[groups - 1]![first - 1]! + spread(first, last);
        if (candidate < cost[groups]![last]!) {
          cost[groups]![last] = candidate;
          firstOfLast[groups]![last] = first;
        }
      }
    }
  }

  const assignment = Array<number>(size).fill(0);
  let end = size - 1;
  for (let group = count; group >= 1; group -= 1) {
    const start = group === 1 ? 0 : firstOfLast[group]![end]!;
    for (let index = start; index <= end; index += 1) assignment[index] = group - 1;
    end = start - 1;
  }
  return assignment;
}

function widestGroupSpan(run: readonly number[], assignment: readonly number[]): number {
  const groups = new Set(assignment);
  return Math.max(...[...groups].map((group) => run[assignment.indexOf(group)]! - run[assignment.lastIndexOf(group)]!));
}

/**
 * Rule 2: the least-spread split of one run into the smallest count at which every group fits
 * under the cap. Because the split at each count is the natural one (cuts on the widest gaps), a
 * count is accepted only when that natural split fits: a different split of the same count could
 * sometimes fit by cutting a narrow gap, and the rule declines it on purpose (see the header).
 * Singletons always fit, so the loop terminates by `count === run.length` at the latest.
 */
function naturalSplitWithinSpan(run: readonly number[]): readonly number[] {
  for (let count = 1; count < run.length; count += 1) {
    const assignment = leastSpreadSplit(run, count);
    if (widestGroupSpan(run, assignment) <= TIER_SPAN_POINTS) return assignment;
  }
  return run.map((_, index) => index);
}

/**
 * Tier index per player, 0-based, for a ladder's RANKING KEY sorted DESCENDING.
 *
 * One position's pool passes its projected points and gets the rule exactly as it has always
 * stood. A CROSS-POSITION ladder (the board's own Overall order) passes points over replacement
 * as the key and each player's projected points as `productionByRow`, so rule 1's "a game's
 * worth" stays a share of real production — see `isTierBreak`. Rule 2's span cap is measured on
 * the key either way, because the key is what the reader sees the tier stretch across.
 */
export function tiersOf(keyDescending: readonly number[], productionByRow: readonly number[] = keyDescending): readonly number[] {
  const starts = runStarts(keyDescending, productionByRow);
  return starts.reduce<{ readonly tiers: readonly number[]; readonly nextTier: number }>(
    (state, start, runIndex) => {
      const end = starts[runIndex + 1] ?? keyDescending.length;
      const groups = naturalSplitWithinSpan(keyDescending.slice(start, end));
      return {
        tiers: [...state.tiers, ...groups.map((group) => state.nextTier + group)],
        nextTier: state.nextTier + Math.max(-1, ...groups) + 1,
      };
    },
    { tiers: [], nextTier: 0 },
  ).tiers;
}

export interface TierStanding {
  readonly tier: number;
  /** Including him: how many men at this position are left before the drop. */
  readonly playersLeftInTier: number;
  /** How far the position falls after this tier is gone. Zero when he is in the last tier. */
  readonly dropToNextTier: number;
}

/**
 * Where one player stands in his position's tier structure, at the moment the board was taken.
 * `pointsDescending` is projected points; within a position the drop between two players is the
 * same in points and in value over replacement, so the drop reads correctly under either.
 */
export function tierStanding(pointsDescending: readonly number[], index: number): TierStanding {
  const tiers = tiersOf(pointsDescending);
  const tier = tiers[index];
  if (tier === undefined) {
    throw new Error(`No player sits at index ${index} in a pool of ${pointsDescending.length}.`);
  }
  const lastOfTier = tiers.lastIndexOf(tier);
  const firstOfNext = tiers.indexOf(tier + 1);
  return {
    tier,
    playersLeftInTier: lastOfTier - index + 1,
    dropToNextTier: firstOfNext === -1 ? 0 : pointsDescending[lastOfTier]! - pointsDescending[firstOfNext]!,
  };
}
