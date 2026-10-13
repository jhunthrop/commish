import { STAT_FIELDS, type StatLine } from "@research-ts/domain/player";
import type { PlayerRates } from "./efficiency";
import type { PredictedOpportunity } from "./opportunity";

/**
 * LAYER 3: COMPOSITION — opportunity times efficiency, into a predicted `StatLine`.
 *
 * The engine spec's first decision is that a projection IS a predicted `StatLine`, composed into
 * points through each league's own rules by `computeFantasyPoints`. This is where that decision
 * pays: nothing here knows what a point is worth. The same predicted line scores a standard league,
 * a full-PPR league and a superflex TE-premium league without a line of change, because the league
 * supplies the rules and this supplies the components.
 *
 * That is also why the arithmetic is deliberately boring. Every field is one multiplication of a
 * predicted volume by a regressed rate, and a reviewer can check any of them by hand. Anything
 * cleverer belongs in the layer that produced the volume or the rate, where it can be measured
 * separately — a correction applied here would be invisible to both of the scoreboards that could
 * catch it being wrong.
 *
 * THE FIELDS LEFT AT ZERO ARE LEFT AT ZERO HONESTLY. Field goals, extra points and the three team
 * defence stats are not modelled: Phase 2 projects QB, RB, WR and TE, and a kicker or a defence
 * would need its own opportunity model rather than a guess derived from this one. Zero is the
 * correct value for a quarterback's field goals and an explicit non-answer for a kicker, who is
 * simply never handed to this function.
 */

/** Volume in counts rather than shares — the intermediate a reviewer actually wants to see. */
export interface PredictedVolume {
  readonly targets: number;
  readonly carries: number;
  readonly passAttempts: number;
}

/**
 * A share becomes a count by multiplying by the offence's predicted volume.
 *
 * Exported separately from the composition because it is the number worth eyeballing when a
 * projection looks wrong: "we thought he would see nine targets" is a claim anybody can argue with,
 * while a receiving-yards total three multiplications deep is not.
 */
export function predictedVolume(opportunity: PredictedOpportunity): PredictedVolume {
  return {
    targets: opportunity.targetShare * opportunity.teamTargets,
    carries: opportunity.carryShare * opportunity.teamCarries,
    passAttempts: opportunity.passAttemptShare * opportunity.teamPassAttempts,
  };
}

/**
 * One player's predicted `StatLine` for one week.
 *
 * Fumbles are taken over every PLAY — targets, carries and throws together — because the ball comes
 * loose on all three and a league's rules charge the same points however it did. That mirrors how
 * the actuals are mapped: nflverse splits a lost fumble across three columns and `stat-lines.ts`
 * sums them into one field.
 */
export function composeStatLine(
  playerId: string,
  week: number,
  opportunity: PredictedOpportunity,
  rates: PlayerRates,
): StatLine {
  const volume = predictedVolume(opportunity);
  const plays = volume.targets + volume.carries + volume.passAttempts;
  return {
    playerId,
    week,
    ...(Object.fromEntries(STAT_FIELDS.map((field) => [field, 0])) as Omit<StatLine, "playerId" | "week">),
    receptions: volume.targets * rates.receptionsPerTarget,
    receivingYards: volume.targets * rates.receivingYardsPerTarget,
    receivingTouchdowns: volume.targets * rates.receivingTouchdownsPerTarget,
    rushingYards: volume.carries * rates.rushingYardsPerCarry,
    rushingTouchdowns: volume.carries * rates.rushingTouchdownsPerCarry,
    passingYards: volume.passAttempts * rates.passingYardsPerAttempt,
    passingTouchdowns: volume.passAttempts * rates.passingTouchdownsPerAttempt,
    interceptions: volume.passAttempts * rates.interceptionsPerAttempt,
    fumblesLost: plays * rates.fumblesLostPerPlay,
  };
}
