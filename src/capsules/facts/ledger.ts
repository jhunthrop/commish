import type { RankedStat } from "../rank";
import type { PlayerFactsDepth } from "./types";

/**
 * THE DEPTH GROUP'S SHARE OF THE TWO LEDGERS — every number, every person's name and every team
 * code the depth section can print, walked in `PlayerFactsDepth`'s OWN declaration order so two
 * calls with identical input always produce byte-identical arrays (`facts.ts`'s determinism rule,
 * which `factsHash` depends on).
 *
 * THE RULES ARE `facts.ts`'S OWN, RESTATED HERE RATHER THAN REINVENTED:
 *   - a fraction-valued fact contributes BOTH its raw fraction and its whole-percent form, because
 *     prose almost always states the latter;
 *   - a `RankedStat` contributes its value, its rank and its honest qualifier count, and its named
 *     neighbour is a NAME rather than a number;
 *   - a printed date contributes its year, month and day as separate numbers, the same shape
 *     `printedTextNumbers` already gives the injury line's own stamp.
 *
 * TEAM CODES ARE RETURNED SEPARATELY from people's names (`depthTeamCodes`), because `facts.ts`
 * expands a team code into its city, nickname and full spelling before grounding it and must not
 * do the same to a person.
 *
 * EVERY FIELD IS WALKED, INCLUDING THE ONES NO BUILDER FILLS YET. An empty list and a `null` object
 * both contribute nothing, so this file is complete from the start rather than growing a branch per
 * fact and risking a field that renders but never grounds.
 */

const PERCENT = 100;

/**
 * THREE FORMS OF ONE SHARE, and the third is the one that actually matters here. `facts.ts`'s own
 * ledger carries the raw fraction and the exact product, which is right, and is not enough on its
 * own: the depth section PRINTS a whole percent (`Math.round`), and 0.581 times a hundred is
 * 58.099999999999994 in floating point, not the 58 the model reads on the page. A writer quoting
 * the sheet verbatim must ground against what the sheet printed, so the rounded form is on the
 * ledger beside the two exact ones rather than left to a comparison tolerance to rescue.
 */
function shareNumbers(fraction: number): readonly number[] {
  return [fraction, fraction * PERCENT, Math.round(fraction * PERCENT)];
}

function rankedNumbers(rank: RankedStat | null): readonly number[] {
  return rank === null ? [] : [rank.value, rank.positionRank, rank.qualifierCount];
}

/** An ISO `yyyy-mm-dd` (or a longer ISO instant) as its three printed parts. */
function dateNumbers(iso: string): readonly number[] {
  return iso
    .slice(0, 10)
    .split("-")
    .map(Number)
    .filter((value) => Number.isFinite(value));
}

function absenceNumbers(depth: PlayerFactsDepth): readonly number[] {
  const numbers: number[] = [];
  for (const ending of depth.seasonEndings) numbers.push(ending.season, ending.lastPlayedWeek, ending.firstMissedWeek);
  for (const record of depth.gamesMissed) {
    numbers.push(record.season, record.teamGames, record.gamesPlayed);
    if (record.firstPlayedWeek !== null) numbers.push(record.firstPlayedWeek);
    if (record.unavailableWeeks !== null) numbers.push(record.unavailableWeeks.length, ...record.unavailableWeeks);
    if (record.suspendedWeeks !== null) numbers.push(record.suspendedWeeks.length, ...record.suspendedWeeks);
    if (record.healthyDidNotPlay !== null) numbers.push(record.healthyDidNotPlay);
  }
  for (const spell of depth.injuryHistory) {
    numbers.push(spell.captureCount, ...dateNumbers(spell.firstSeenAt), ...dateNumbers(spell.lastSeenAt));
  }
  return numbers;
}

function situationNumbers(depth: PlayerFactsDepth): readonly number[] {
  const numbers: number[] = [];
  if (depth.coaching !== null) numbers.push(depth.coaching.season);
  const pedigree = depth.pedigree;
  if (pedigree !== null) {
    for (const value of [pedigree.ageOnOpeningDay, pedigree.seasonsPlayed, pedigree.draftYear, pedigree.draftRound, pedigree.draftPick]) {
      if (value !== null) numbers.push(value);
    }
  }
  const chart = depth.depthChart;
  if (chart !== null) {
    numbers.push(chart.season, chart.slot, ...dateNumbers(chart.asOf));
    for (const neighbor of chart.aroundHim) numbers.push(neighbor.slot);
  }
  return numbers;
}

function roleNumbers(depth: PlayerFactsDepth): readonly number[] {
  const numbers: number[] = [];
  const trend = depth.roleTrend;
  if (trend !== null) {
    numbers.push(trend.season, ...trend.earlyWeeks, ...trend.lateWeeks);
    for (const split of [trend.snapShare, trend.targetShare]) {
      if (split !== null) numbers.push(...shareNumbers(split.early), ...shareNumbers(split.late));
    }
  }
  const competition = depth.targetCompetition;
  if (competition !== null) {
    numbers.push(competition.season, ...shareNumbers(competition.combinedShare));
    for (const leader of competition.leaders) numbers.push(...shareNumbers(leader.share));
  }
  const usage = depth.scoringUsage;
  if (usage !== null) {
    numbers.push(usage.season, ...rankedNumbers(usage.redZoneTouches), ...rankedNumbers(usage.insideTenTouches), ...rankedNumbers(usage.targetDepth));
  }
  return numbers;
}

function contextNumbers(depth: PlayerFactsDepth): readonly number[] {
  const numbers: number[] = [];
  const context = depth.teamContext;
  if (context !== null) {
    numbers.push(context.priorSeason);
    if (context.paceSecondsPerPlay !== null) numbers.push(context.paceSecondsPerPlay);
    if (context.passRate !== null) numbers.push(...shareNumbers(context.passRate));
    for (const value of [context.wins, context.weekOneImpliedTotal, context.weekOneSpread]) {
      if (value !== null) numbers.push(value);
    }
  }
  const schedule = depth.schedule;
  if (schedule !== null) {
    numbers.push(schedule.homeGames, schedule.roadGames);
    if (schedule.indoorGames !== null) numbers.push(schedule.indoorGames);
    if (schedule.weekOneOpponent !== null) numbers.push(schedule.weekOneOpponent.week);
    for (const fixture of schedule.playoffWeeks) numbers.push(fixture.week);
  }
  return numbers;
}

function historyNumbers(depth: PlayerFactsDepth): readonly number[] {
  const numbers: number[] = [];
  const movement = depth.marketMovement;
  if (movement !== null) {
    // BOTH THE SIGNED MOVEMENT AND ITS SIZE. The rendered sentence puts the DIRECTION in words
    // ("moved him down 11.5 picks") and the magnitude in the number, so a fall prints `11.5` while
    // `picks` itself is `-11.5`. Grounding only the signed value left every fall's printed number
    // off the ledger, which is the one case the sentence and the ledger could disagree about.
    numbers.push(movement.latestAdp, movement.earlierAdp, movement.picks, Math.abs(movement.picks), ...dateNumbers(movement.latestAt), ...dateNumbers(movement.earlierAt));
  }
  const volatility = depth.volatility;
  if (volatility !== null) {
    numbers.push(volatility.season, volatility.weeksPlayed, volatility.weeksAboveThreshold, volatility.threshold, volatility.worstWeek.week, volatility.worstWeek.points);
  }
  for (const season of depth.priorSeasons) {
    numbers.push(season.season, season.points, season.gamesPlayed, season.positionRank, season.qualifierCount);
  }
  return numbers;
}

/** Every number the depth section can print. */
export function depthNumbers(depth: PlayerFactsDepth): readonly number[] {
  return [...absenceNumbers(depth), ...situationNumbers(depth), ...roleNumbers(depth), ...contextNumbers(depth), ...historyNumbers(depth)];
}

/** Every PERSON the depth section can name — coaches, the players listed around him on the depth
 *  chart, his team's target leaders, and any ranked stat's named neighbour. */
export function depthNames(depth: PlayerFactsDepth): readonly string[] {
  const names: string[] = [];
  const push = (name: string | null) => {
    if (name !== null && name.trim() !== "") names.push(name);
  };
  if (depth.coaching !== null) {
    push(depth.coaching.headCoach);
    push(depth.coaching.playCaller);
  }
  if (depth.depthChart !== null) for (const neighbor of depth.depthChart.aroundHim) push(neighbor.name);
  if (depth.targetCompetition !== null) for (const leader of depth.targetCompetition.leaders) push(leader.name);
  if (depth.scoringUsage !== null) {
    for (const rank of [depth.scoringUsage.redZoneTouches, depth.scoringUsage.insideTenTouches, depth.scoringUsage.targetDepth]) {
      push(rank?.namedNeighbor ?? null);
    }
  }
  return names;
}

/** Every TEAM CODE the depth section can print, for `facts.ts` to expand into its own spellings. */
export function depthTeamCodes(depth: PlayerFactsDepth): readonly string[] {
  const codes: string[] = [];
  if (depth.pedigree?.draftClub != null) codes.push(depth.pedigree.draftClub);
  if (depth.targetCompetition !== null) codes.push(depth.targetCompetition.team);
  const schedule = depth.schedule;
  if (schedule !== null) {
    if (schedule.weekOneOpponent !== null) codes.push(schedule.weekOneOpponent.opponent);
    for (const fixture of schedule.playoffWeeks) codes.push(fixture.opponent);
  }
  return codes;
}
