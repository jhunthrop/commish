import type { Position } from "@research-ts/domain/player";
import { NEWS_MULTIPLIER_BOUND, type DesignationEffect, type NewsPriors } from "../news/adjust";
import { INJURY_METRICS, INJURY_SOURCE, PRACTICE_STATUS, REPORT_STATUS } from "../news/retrieve";
import type { PlayerWeekObservation } from "../store";
import type { PlayerWeekUsage } from "../usage";
import { predictOpportunity, type OpportunityPriors } from "./opportunity";

/**
 * WHAT A DESIGNATION IS WORTH, MEASURED — the "weighs" half of "weighs retrieved facts and never
 * generates them".
 *
 * Everybody knows that "Out" means no snaps. Nobody knows what "Questionable" means, and the honest
 * answer is a number rather than an opinion: over the fit seasons, players carrying that designation
 * took some measurable fraction of the snaps layer 1 predicted for them. That fraction is the
 * multiplier, and it is the only thing this file produces.
 *
 * AGAINST LAYER 1'S PREDICTION, not against the player's season average. The question the multiplier
 * has to answer is "given what the model already expects of him, how much less does he play", and a
 * ratio against his own average would answer a different one and would double-count everything layer
 * 1's recency weighting has already noticed about a man who has been hurt for a fortnight.
 *
 * A MISSING USAGE ROW COUNTS AS ZERO HERE, and this is the one place in the engine where it does.
 * Everywhere else an absent player-week means "no evidence" and is skipped, which is right when the
 * absence is unexplained. Here the absence IS the outcome: the injury report is filed for a specific
 * game, so a player on it who has no snap row that week did not play, and skipping him would fit the
 * multiplier on the subset of injured players who turned out to be fine. That is selection on the
 * outcome, and it would produce a comfortable, useless number near 1 for every designation.
 *
 * THE FIT READS FINAL DATA, as every other fit in this engine does — a parameter should be measured
 * against what really happened. The point-in-time gate governs what the MODEL may see when it
 * applies these numbers, and for this feature that gate turns out to be the whole story: see
 * `docs/research/2026-08-27-model-v3.md`.
 */

export interface NewsFitInput {
  readonly usage: readonly PlayerWeekUsage[];
  /** Every injury observation for the fit seasons, read at a final moment. */
  readonly news: readonly PlayerWeekObservation[];
  readonly positions: ReadonlyMap<string, Position>;
  readonly opportunity: OpportunityPriors;
  readonly seasons: readonly number[];
  readonly heldOut?: readonly number[];
}

/** One designation's measured effect, with the evidence behind it. */
export interface DesignationFit extends DesignationEffect {
  readonly designation: number;
  readonly playerWeeks: number;
  /** The raw ratio before the contract's bound was applied, so a clamp is visible not silent. */
  readonly measured: number;
}

export interface NewsFitReport {
  readonly priors: NewsPriors;
  readonly reportStatus: readonly DesignationFit[];
  readonly practiceStatus: readonly DesignationFit[];
}

/**
 * How many player-weeks of evidence a designation's multiplier is worth half its confidence at.
 *
 * Fifty, which is a couple of weeks of one designation across the league. Below that the ratio is
 * being read off a handful of men and the contract should apply it timidly; above it, the confidence
 * saturates and the multiplier speaks for itself.
 */
const CONFIDENCE_PRIOR_PLAYER_WEEKS = 50;

/**
 * How long a filed designation keeps applying.
 *
 * Ten days: long enough that a Friday filing survives to the Sunday or Monday game it was about
 * however the schedule falls, short enough that it cannot still be suppressing a man who has been
 * back for a fortnight. Not fitted, because what is being expressed is the publisher's own intent —
 * a report is filed about one game — rather than anything the data could be asked.
 */
const REPORT_VALIDITY_HOURS = 240;

/** Every designation an effect is measured for. Zero is excluded: it means "no designation". */
const REPORT_DESIGNATIONS: readonly number[] = [REPORT_STATUS.questionable, REPORT_STATUS.doubtful, REPORT_STATUS.out];
const PRACTICE_DESIGNATIONS: readonly number[] = [PRACTICE_STATUS.full, PRACTICE_STATUS.limited, PRACTICE_STATUS.didNotParticipate];

/** One player-week's designations, joined from the two metric rows the feed writes. */
interface Designations {
  readonly report: number;
  readonly practice: number;
}

function designationsBy(news: readonly PlayerWeekObservation[]): ReadonlyMap<string, Designations> {
  const byKey = new Map<string, { report: number; practice: number }>();
  for (const row of news) {
    if (row.source !== INJURY_SOURCE) continue;
    const key = `${row.season}|${row.week}|${row.playerId}`;
    const entry = byKey.get(key) ?? { report: REPORT_STATUS.none, practice: PRACTICE_STATUS.none };
    if (row.metric === INJURY_METRICS.reportStatus) entry.report = row.value;
    if (row.metric === INJURY_METRICS.practiceStatus) entry.practice = row.value;
    byKey.set(key, entry);
  }
  return byKey;
}

/** A ratio of sums, clamped into the contract's bound, with the raw number kept beside it. */
function effectOf(actual: number, predicted: number, playerWeeks: number, designation: number): DesignationFit {
  const measured = predicted <= 0 ? 1 : actual / predicted;
  return {
    designation,
    measured,
    multiplier: Math.min(NEWS_MULTIPLIER_BOUND.max, Math.max(NEWS_MULTIPLIER_BOUND.min, measured)),
    confidence: playerWeeks / (playerWeeks + CONFIDENCE_PRIOR_PLAYER_WEEKS),
    playerWeeks,
  };
}

/**
 * Fits a multiplier for every designation. Throws if pointed at a held-out season.
 *
 * The two tables are fitted on exactly the populations the derivation will apply them to: the game
 * status over player-weeks carrying one, and the practice status only over player-weeks carrying NO
 * game status. `newsAdjustments` prefers the game status where both exist, so fitting the practice
 * table over all of them would measure it on players it is never used for — and those are precisely
 * the ones whose outcome the game status already explains.
 */
export function fitNewsPriors(input: NewsFitInput): NewsFitReport {
  const overlap = input.seasons.filter((season) => (input.heldOut ?? []).includes(season));
  if (overlap.length > 0) {
    throw new Error(
      `Season${overlap.length > 1 ? "s" : ""} ${overlap.join(", ")} would be fitted on and then reported on. A parameter that has read the test set is not a parameter.`,
    );
  }

  const designations = designationsBy(input.news);
  const bySeason = new Map<number, PlayerWeekUsage[]>();
  for (const row of input.usage) {
    (bySeason.get(row.season) ?? bySeason.set(row.season, []).get(row.season)!).push(row);
  }

  const totals = new Map<string, { actual: number; predicted: number; playerWeeks: number }>();
  const add = (table: "report" | "practice", designation: number, actual: number, predicted: number): void => {
    const key = `${table}|${designation}`;
    const running = totals.get(key) ?? totals.set(key, { actual: 0, predicted: 0, playerWeeks: 0 }).get(key)!;
    running.actual += actual;
    running.predicted += predicted;
    running.playerWeeks += 1;
  };

  for (const season of [...input.seasons].sort((a, b) => a - b)) {
    const thisSeason = bySeason.get(season) ?? [];
    const history = [...(bySeason.get(season - 1) ?? []), ...thisSeason];
    for (const week of [...new Set(thisSeason.map((row) => row.week))].sort((a, b) => a - b)) {
      const predictions = predictOpportunity(history, { season, week, positions: input.positions }, input.opportunity);
      const played = new Map(thisSeason.filter((row) => row.week === week).map((row) => [row.playerId, row] as const));
      for (const [key, designation] of designations) {
        const [designationSeason, designationWeek, playerId] = key.split("|") as [string, string, string];
        if (Number(designationSeason) !== season || Number(designationWeek) !== week) continue;
        const predicted = predictions.get(playerId);
        // No prediction means the model has no opinion about him at all, so there is no ratio to
        // take. That is a different case from "predicted to play and did not", which is the one
        // being measured.
        if (predicted === undefined || predicted.snapShare <= 0) continue;
        // The absence IS the outcome — see this file's docblock. Everywhere else in the engine a
        // missing player-week means no evidence; here it means he did not play.
        const actual = played.get(playerId)?.snapShare ?? 0;
        if (designation.report !== REPORT_STATUS.none) {
          add("report", designation.report, actual, predicted.snapShare);
        } else if (designation.practice !== PRACTICE_STATUS.none) {
          add("practice", designation.practice, actual, predicted.snapShare);
        }
      }
    }
  }

  const fitsFor = (table: "report" | "practice", codes: readonly number[]): readonly DesignationFit[] =>
    codes
      .map((designation) => {
        const running = totals.get(`${table}|${designation}`);
        return running === undefined ? null : effectOf(running.actual, running.predicted, running.playerWeeks, designation);
      })
      .filter((fit): fit is DesignationFit => fit !== null);

  const reportStatus = fitsFor("report", REPORT_DESIGNATIONS);
  const practiceStatus = fitsFor("practice", PRACTICE_DESIGNATIONS);
  const table = (fits: readonly DesignationFit[]): Readonly<Record<string, DesignationEffect>> =>
    Object.fromEntries(fits.map((fit) => [String(fit.designation), { multiplier: fit.multiplier, confidence: fit.confidence }]));

  return {
    priors: {
      reportStatus: table(reportStatus),
      practiceStatus: table(practiceStatus),
      validityHours: REPORT_VALIDITY_HOURS,
    },
    reportStatus,
    practiceStatus,
  };
}
