import type { Position } from "@research-ts/domain/player";
import type { TeamContext } from "../team-context";
import type { PlayerWeekUsage } from "../usage";
import { predictOpportunity, type OpportunityPriors } from "./opportunity";
import { detectTransactions } from "./transactions";

/**
 * HOW MUCH OF A VACATED SHARE IS ACTUALLY ABSORBED — one number, measured on the fit seasons.
 *
 * Never one, and the reason is worth stating because it is the whole justification for fitting it
 * rather than assuming it. An offence that trades its best receiver does not throw the same number
 * of passes to worse receivers; it throws fewer. Some of the vacated share does not move to anybody
 * — it stops existing, and it shows up in layer 1's team-volume estimate instead of in anybody's
 * share. Assuming full absorption would systematically over-project every remaining teammate.
 *
 * The estimator is a ratio of sums rather than a mean of ratios, for the reason that recurs
 * throughout this engine: a team that vacated 1% of its targets and gained 2% would otherwise claim
 * an absorption of 200% and one such row would move the answer. The ratio of sums weights each
 * event by the share actually at stake.
 *
 * MEASURED AGAINST WHAT LAYER 1 ALREADY PREDICTS, not against the raw before-and-after. Layer 1's
 * in-season recency weighting finds part of the redistribution on its own within a few weeks, and
 * an estimator that ignored that would credit this feature with work already done and double-count
 * it.
 */

export interface RedistributionPriors {
  /** The fraction of a vacated share the remaining roster takes on. Between 0 and 1. */
  readonly absorptionRate: number;
  /** How many team-weeks with a detected departure the estimate rests on. */
  readonly events: number;
}

export interface RedistributionFitInput {
  readonly usage: readonly PlayerWeekUsage[];
  readonly positions: ReadonlyMap<string, Position>;
  readonly context: TeamContext;
  readonly opportunity: OpportunityPriors;
  readonly seasons: readonly number[];
  readonly heldOut?: readonly number[];
}

/**
 * A rate outside this range is a measurement failure rather than a discovery, and is clamped.
 *
 * Above 1 would say an offence gives away more work than the departing player was taking, which no
 * arithmetic in this file can honestly support; below 0 would say the remaining players get LESS,
 * which is the sign of an estimator picking up a coincident scheme change rather than the
 * departure. Both are recorded in the report if they happen, and neither is allowed into a model.
 */
const RATE_BOUND = { min: 0, max: 1 } as const;

export function fitRedistributionPriors(input: RedistributionFitInput): RedistributionPriors {
  const overlap = input.seasons.filter((season) => (input.heldOut ?? []).includes(season));
  if (overlap.length > 0) {
    throw new Error(
      `Season${overlap.length > 1 ? "s" : ""} ${overlap.join(", ")} would be fitted on and then reported on. A parameter that has read the test set is not a parameter.`,
    );
  }

  const bySeason = new Map<number, PlayerWeekUsage[]>();
  for (const row of input.usage) (bySeason.get(row.season) ?? bySeason.set(row.season, []).get(row.season)!).push(row);
  const teamOf = new Map(
    input.context.playerTeams.map((edge) => [`${edge.season}|${edge.week}|${edge.playerId}`, edge.team] as const),
  );

  let vacated = 0;
  let absorbed = 0;
  let events = 0;

  for (const season of [...input.seasons].sort((a, b) => a - b)) {
    const thisSeason = bySeason.get(season) ?? [];
    const priorSeason = bySeason.get(season - 1) ?? [];
    for (const week of [...new Set(thisSeason.map((row) => row.week))].sort((a, b) => a - b)) {
      // Exactly what the model would see: everything before this week, nothing at or after it.
      const visibleUsage = [...priorSeason, ...thisSeason.filter((row) => row.week < week)];
      const visibleTeams = input.context.playerTeams.filter(
        (edge) => edge.season < season || (edge.season === season && edge.week < week),
      );
      const predictions = predictOpportunity(visibleUsage, { season, week, positions: input.positions }, input.opportunity);
      const snapShares = new Map([...predictions].map(([playerId, player]) => [playerId, player.snapShare] as const));
      const transactions = detectTransactions({
        usage: visibleUsage,
        playerTeams: visibleTeams,
        positions: input.positions,
        snapShares,
      });

      const actualThisWeek = new Map(
        thisSeason.filter((row) => row.week === week).map((row) => [row.playerId, row] as const),
      );
      for (const transaction of transactions) {
        if (transaction.departures.length === 0) continue;
        const vacatedHere = transaction.departures.reduce(
          (sum, move) => sum + move.targetShare + move.carryShare,
          0,
        );
        if (vacatedHere <= 0) continue;

        let gap = 0;
        let scored = 0;
        for (const player of transaction.roster) {
          const actual = actualThisWeek.get(player.playerId);
          const predicted = predictions.get(player.playerId);
          // Only players who really were in this offence this week, so a man who left between the
          // detection and the game does not count as an absorption of zero.
          if (actual === undefined || predicted === undefined) continue;
          if (teamOf.get(`${season}|${week}|${player.playerId}`) !== transaction.team) continue;
          gap +=
            (actual.targetShare ?? 0) - predicted.targetShare + ((actual.carryShare ?? 0) - predicted.carryShare);
          scored += 1;
        }
        if (scored === 0) continue;
        vacated += vacatedHere;
        absorbed += gap;
        events += 1;
      }
    }
  }

  const raw = vacated === 0 ? 0 : absorbed / vacated;
  return { absorptionRate: Math.min(RATE_BOUND.max, Math.max(RATE_BOUND.min, raw)), events };
}
