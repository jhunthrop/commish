import type { PlayerFactsRoleTrend, PlayerFactsSplitShare, PlayerFactsTargetCompetition, PlayerFactsTargetLeader } from "./types";

/**
 * HOW THE ROLE MOVED INSIDE ONE SEASON, AND WHO ELSE WAS EATING (spec §4, facts 7 and 8; inventory
 * rows 7 and 8).
 *
 * The sheet already carried a season AVERAGE share and a year-over-year trend, and both hide the
 * commonest breakout tell there is: a role that was a third of the snaps in September and three
 * quarters of them in December averages out to something unremarkable. This states both ends.
 *
 * THE WINDOWS ARE NAMED, NOT IMPLIED. `earlyWeeks` and `lateWeeks` carry the actual week numbers,
 * because "September" and "December" are months the store never said and a player who missed six
 * weeks has an "early" window nothing like his neighbour's. The renderer prints the weeks.
 *
 * A SPLIT IT CANNOT MAKE IS REFUSED. Fewer than `WINDOW * 2` weeks with a real reading yields
 * `null` for the whole trend rather than two overlapping windows quietly sharing weeks, which would
 * make every short season look like a rising role.
 */

const WINDOW = 4;

/** One week's readings for one player, as `collect-depth.ts` assembles them from the participation
 *  and snap-count stores. Either quantity can be independently absent for a week. */
export interface PlayerWeekShare {
  readonly week: number;
  readonly snapShare: number | null;
  readonly targetShare: number | null;
}

/** Four decimals: a share is a fraction of a season's snaps, and register precision on it would
 *  make two runs over the same rows disagree in the last bit and change `factsHash`. */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function meanOver(weeks: readonly PlayerWeekShare[], select: (week: PlayerWeekShare) => number | null): number | null {
  const values = weeks.map(select).filter((value): value is number => value !== null);
  return values.length === 0 ? null : round4(values.reduce((sum, value) => sum + value, 0) / values.length);
}

/** A metric's own early-against-late split, `null` unless BOTH windows carry a real reading of it:
 *  a comparison with one side missing is not a comparison. */
function splitFor(early: readonly PlayerWeekShare[], late: readonly PlayerWeekShare[], select: (week: PlayerWeekShare) => number | null): PlayerFactsSplitShare | null {
  const earlyMean = meanOver(early, select);
  const lateMean = meanOver(late, select);
  return earlyMean === null || lateMean === null ? null : { early: earlyMean, late: lateMean };
}

/** His first four and last four weeks with a real reading, or `null` when there are not eight. */
export function roleTrendFor(season: number, weeks: readonly PlayerWeekShare[]): PlayerFactsRoleTrend | null {
  const withReading = [...weeks].filter((week) => week.snapShare !== null || week.targetShare !== null).sort((a, b) => a.week - b.week);
  if (withReading.length < WINDOW * 2) return null;

  const early = withReading.slice(0, WINDOW);
  const late = withReading.slice(-WINDOW);
  const snapShare = splitFor(early, late, (week) => week.snapShare);
  const targetShare = splitFor(early, late, (week) => week.targetShare);
  if (snapShare === null && targetShare === null) return null;

  return {
    season,
    earlyWeeks: early.map((week) => week.week),
    lateWeeks: late.map((week) => week.week),
    snapShare,
    targetShare,
  };
}

/** One player's season targets against his team's own, as `collect-depth.ts` sums them. */
export interface TeamPlayerTargets {
  readonly playerId: string;
  readonly targets: number;
  readonly teamTargets: number;
}

const LEADERS = 2;

/**
 * The team's two biggest target earners last season, and their combined share.
 *
 * "WHO ELSE EATS" IS HALF OF A RECEIVER'S PROJECTION, and the sheet named nobody: a 20% target
 * share reads completely differently on a team where two men take half the throws than on one
 * where nobody takes more than 18%.
 *
 * A TEAM WITH FEWER THAN TWO REAL EARNERS YIELDS NOTHING. A single leader is not a competition, and
 * a zero team-target denominator is not a share — both are the store being thin, not a fact.
 */
export function targetCompetitionFor(season: number, team: string, rows: readonly TeamPlayerTargets[], names: ReadonlyMap<string, string>): PlayerFactsTargetCompetition | null {
  const shares = rows
    .filter((row) => row.teamTargets > 0 && row.targets > 0)
    .map((row) => ({ playerId: row.playerId, share: round4(row.targets / row.teamTargets) }))
    // Share descending, then player id, so a tie resolves the same way on every run.
    .sort((a, b) => b.share - a.share || a.playerId.localeCompare(b.playerId));
  if (shares.length < LEADERS) return null;

  const leaders: readonly PlayerFactsTargetLeader[] = shares.slice(0, LEADERS).map((row) => ({ name: names.get(row.playerId) ?? row.playerId, share: row.share }));
  return { season, team, leaders, combinedShare: round4(leaders.reduce((sum, leader) => sum + leader.share, 0)) };
}
