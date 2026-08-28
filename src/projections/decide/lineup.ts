import type { Position } from "@/domain/player";
import { BENCH_SLOT, type RosterSlotConfig, type RosterSlotType } from "@/domain/roster";
import { chanceOfClearing } from "./normal";
import { standardDeviationOf, type ProjectionDistribution } from "./outlook";

/**
 * START AND SIT: FLOOR WHEN YOU ARE AHEAD, CEILING WHEN YOU ARE BEHIND.
 *
 * A weekly lineup is a different decision from a draft board and it is easy to ship the same one
 * twice. Draft value asks what a player is worth against everyone else you could have had all
 * season. A lineup asks one question about one afternoon: DOES THIS TEAM WIN THIS MATCHUP. The
 * two answers come apart the moment the matchup is lopsided, and if the recommendation does not
 * change with the matchup then it is a ranking wearing a different hat.
 *
 * THE RULE IS NOT WRITTEN DOWN ANYWHERE HERE, IT IS ARITHMETIC. Every starter is chosen to
 * maximise `P(our total clears theirs)`. When you are favoured, the margin is positive and a
 * SMALLER spread raises that probability; when you are trailing it is negative and a LARGER
 * spread raises it. "Play the floor with a lead, chase the ceiling from behind" is what the
 * expression does, not a branch somebody added. That matters, because a rule written as a branch
 * would need a threshold, and nobody could say what the threshold should be.
 *
 * NOTHING HERE RE-PREDICTS. Every distribution arrives as an argument, from layer 3 when it emits
 * one and from `realizedDispersion` until then. This module never touches a projected stat.
 *
 * TWO PASSES, AND WHY. A player's contribution to the win probability depends on the rest of the
 * lineup, and the rest of the lineup is what we are choosing. That circle is cut by settling a
 * baseline lineup on expected points first, then re-choosing each spot against it. The result is
 * a fixed point of one iteration rather than of many, which is enough: the second pass moves men
 * whose expected points are close, so the baseline it was measured against barely moves.
 */

export interface LineupCandidate {
  readonly playerId: string;
  readonly position: Position;
  /** This week, THIS matchup. Supplied, never derived here. */
  readonly outlook: ProjectionDistribution;
}

export interface MatchupContext {
  /**
   * Your expected-points lineup's total minus the opponent's. POSITIVE MEANS FAVOURED. Stated by
   * the caller because only the caller knows the opponent, and it is the single number that turns
   * a ranking into a decision.
   */
  readonly projectedMargin: number;
  /** How much the opponent's own total swings week to week. Must be positive: certainty is not on offer. */
  readonly opponentStandardDeviation: number;
}

export interface StartSitQuery {
  readonly candidates: readonly LineupCandidate[];
  /** The league's own roster rows. Superflex and tight-end premium are config, not special cases. */
  readonly rosterSlots: readonly RosterSlotConfig[];
  readonly matchup: MatchupContext;
}

export type LineupReason =
  | { readonly code: "highest_expected_points"; readonly expectedPoints: number }
  | { readonly code: "floor_protects_a_lead"; readonly projectedMargin: number; readonly standardDeviation: number; readonly expectedPointsForgone: number }
  | { readonly code: "ceiling_chases_a_deficit"; readonly projectedMargin: number; readonly standardDeviation: number; readonly expectedPointsForgone: number }
  | { readonly code: "only_eligible_player"; readonly slot: RosterSlotType }
  | { readonly code: "no_eligible_player"; readonly slot: RosterSlotType };

export interface StartDecision {
  readonly slot: RosterSlotType;
  readonly slotIndex: number;
  /** `null` when the roster holds nobody who can fill this slot. */
  readonly playerId: string | null;
  readonly expectedPoints: number | null;
  readonly floor: number | null;
  readonly ceiling: number | null;
  readonly reasons: readonly LineupReason[];
}

export interface LineupDecision {
  readonly starters: readonly StartDecision[];
  /** Everyone not starting, in a stable order. */
  readonly bench: readonly string[];
  /** The chance the lineup actually chosen clears the opponent. */
  readonly winProbability: number;
}

interface Spot {
  readonly slot: RosterSlotType;
  readonly slotIndex: number;
  readonly eligiblePositions: readonly Position[];
}

/**
 * Starting spots, one per configured place, NARROWEST ELIGIBILITY FIRST.
 *
 * That order is not a heuristic here, it is what makes the assignment optimal. This product's
 * eligibility sets are laminar - QB sits inside SUPERFLEX, and RB/WR/TE each sit inside FLEX
 * which sits inside SUPERFLEX - and for a laminar family, filling the most restrictive place
 * first with the best man it can take is provably the best whole lineup. Widest first is not: it
 * puts your best back in the flex and leaves your worst in the back slot.
 */
function startingSpots(rosterSlots: readonly RosterSlotConfig[]): readonly Spot[] {
  return rosterSlots
    .filter((config) => config.slot !== BENCH_SLOT)
    .flatMap((config) =>
      Array.from({ length: config.count }, (_, slotIndex) => ({
        slot: config.slot,
        slotIndex,
        eligiblePositions: config.eligiblePositions,
      })),
    )
    .sort((a, b) => a.eligiblePositions.length - b.eligiblePositions.length);
}

function eligibleFor(spot: Spot, candidates: readonly LineupCandidate[], taken: ReadonlySet<string>): readonly LineupCandidate[] {
  return candidates.filter(
    (candidate) => !taken.has(candidate.playerId) && spot.eligiblePositions.includes(candidate.position),
  );
}

function byExpectedPoints(a: LineupCandidate, b: LineupCandidate): number {
  return b.outlook.median - a.outlook.median || a.playerId.localeCompare(b.playerId);
}

/** The baseline: the lineup a manager gets by starting his best expected scorers. */
function fillByExpectedPoints(
  spots: readonly Spot[],
  candidates: readonly LineupCandidate[],
): ReadonlyMap<string, LineupCandidate | null> {
  const taken = new Set<string>();
  const filled = new Map<string, LineupCandidate | null>();
  for (const spot of spots) {
    const best = [...eligibleFor(spot, candidates, taken)].sort(byExpectedPoints)[0] ?? null;
    if (best !== null) taken.add(best.playerId);
    filled.set(`${spot.slot}:${spot.slotIndex}`, best);
  }
  return filled;
}

export function startSit({ candidates, rosterSlots, matchup }: StartSitQuery): LineupDecision {
  if (!(matchup.opponentStandardDeviation > 0)) {
    throw new Error(
      `A matchup needs a positive opponent spread; got ${matchup.opponentStandardDeviation}. Certainty is not on offer.`,
    );
  }
  const spots = startingSpots(rosterSlots);
  const baseline = fillByExpectedPoints(spots, candidates);
  const spreadOf = (candidate: LineupCandidate): number => standardDeviationOf(candidate.outlook);

  const baselineVariance =
    matchup.opponentStandardDeviation ** 2 +
    [...baseline.values()].reduce((sum, player) => sum + (player === null ? 0 : spreadOf(player) ** 2), 0);

  /**
   * The chance this lineup wins if `candidate` takes `spot` instead of whoever the baseline put
   * there. Everything not under consideration is held at its baseline value, which is what makes
   * the comparison between two candidates for one spot a fair one.
   */
  const winIfStarted = (spot: Spot, candidate: LineupCandidate): number => {
    const incumbent = baseline.get(`${spot.slot}:${spot.slotIndex}`) ?? null;
    const incumbentPoints = incumbent?.outlook.median ?? 0;
    const incumbentVariance = incumbent === null ? 0 : spreadOf(incumbent) ** 2;
    const variance = baselineVariance - incumbentVariance + spreadOf(candidate) ** 2;
    return chanceOfClearing(
      matchup.projectedMargin + candidate.outlook.median - incumbentPoints,
      Math.sqrt(variance),
      0,
    );
  };

  const taken = new Set<string>();
  const starters: StartDecision[] = [];
  for (const spot of spots) {
    const eligible = eligibleFor(spot, candidates, taken);
    if (eligible.length === 0) {
      starters.push({
        slot: spot.slot,
        slotIndex: spot.slotIndex,
        playerId: null,
        expectedPoints: null,
        floor: null,
        ceiling: null,
        reasons: [{ code: "no_eligible_player", slot: spot.slot }],
      });
      continue;
    }
    const chosen = [...eligible].sort(
      (a, b) => winIfStarted(spot, b) - winIfStarted(spot, a) || a.playerId.localeCompare(b.playerId),
    )[0]!;
    taken.add(chosen.playerId);

    // The man we passed over, not the best man overall. When the two are tied on expected points
    // the shape is what broke the tie, and saying "highest expected points" would name a reason
    // that did no work.
    const passedOver = [...eligible]
      .filter((candidate) => candidate.playerId !== chosen.playerId)
      .sort(byExpectedPoints)[0];

    const reasons: LineupReason[] = [];
    if (passedOver === undefined) {
      reasons.push({ code: "only_eligible_player", slot: spot.slot });
    } else if (
      chosen.outlook.median > passedOver.outlook.median &&
      spreadOf(chosen) <= spreadOf(passedOver)
    ) {
      reasons.push({ code: "highest_expected_points", expectedPoints: chosen.outlook.median });
    } else {
      const forgone = passedOver.outlook.median - chosen.outlook.median;
      const spread = spreadOf(chosen);
      reasons.push(
        spread < spreadOf(passedOver)
          ? {
              code: "floor_protects_a_lead",
              projectedMargin: matchup.projectedMargin,
              standardDeviation: spread,
              expectedPointsForgone: forgone,
            }
          : {
              code: "ceiling_chases_a_deficit",
              projectedMargin: matchup.projectedMargin,
              standardDeviation: spread,
              expectedPointsForgone: forgone,
            },
      );
    }

    starters.push({
      slot: spot.slot,
      slotIndex: spot.slotIndex,
      playerId: chosen.playerId,
      expectedPoints: chosen.outlook.median,
      floor: chosen.outlook.floor,
      ceiling: chosen.outlook.ceiling,
      reasons,
    });
  }

  const chosenPlayers = candidates.filter((candidate) => taken.has(candidate.playerId));
  const chosenPoints = chosenPlayers.reduce((sum, player) => sum + player.outlook.median, 0);
  const baselinePoints = [...baseline.values()].reduce((sum, player) => sum + (player?.outlook.median ?? 0), 0);
  const chosenVariance =
    matchup.opponentStandardDeviation ** 2 +
    chosenPlayers.reduce((sum, player) => sum + spreadOf(player) ** 2, 0);

  return {
    starters,
    bench: candidates
      .filter((candidate) => !taken.has(candidate.playerId))
      .map((candidate) => candidate.playerId)
      .sort(),
    winProbability: chanceOfClearing(
      matchup.projectedMargin + chosenPoints - baselinePoints,
      Math.sqrt(chosenVariance),
      0,
    ),
  };
}
