import { snakeTeamForPick, totalRosterSlots } from "@research/draft-engine/order";
import { BENCH_SLOT } from "@research/domain/roster";
import { canRoster, landingSlot, recommendPick, type DraftCandidate, type RosteredPlayer } from "./draft";
import { startSit, type LineupCandidate, type MatchupContext } from "./lineup";
import type { LeagueShape } from "./replacement";
import { MIN_RANK_GAP, type MarketPrice, type Sleeper } from "./sleepers";
import { assignStarters, bestStartingTotal, startingSpots, type Slottable } from "./slots";

/**
 * SCORING THE DECISIONS, NOT THE PREDICTIONS.
 *
 * Prediction accuracy and decision quality are different measurements and a model can do well at
 * the first while advising badly. `metrics.ts` asks whether the projection ordered players
 * correctly. Nothing in it asks the only question a manager cares about: WOULD FOLLOWING THIS
 * ADVICE HAVE LEFT ME WITH A BETTER TEAM.
 *
 * Every harness here is pure and takes its outcomes as arguments, for the reason `metrics.ts`
 * gives about itself: a measurement that needs a database cannot be run a thousand times inside
 * a loop, and one that is entangled with its data source cannot be checked by reading it.
 *
 * THE PAIRED DESIGN IS THE POINT. Comparing a room of one strategy against a room of another
 * measures the room, not the strategy - a good drafter surrounded by good drafters gets a worse
 * roster than a good drafter surrounded by bad ones, and neither fact is about the advice. So
 * every seat is replayed twice against the SAME eleven opponents drafting the SAME board, once
 * with the strategy under test in that seat and once without. The difference is the advice and
 * nothing else, and running it at all twelve seats retires draft position as a confound too.
 */

/** Everything a seat is allowed to see at its turn. Point-in-time by construction: no future picks. */
export interface SeatView {
  readonly board: readonly DraftCandidate[];
  readonly roster: readonly RosteredPlayer[];
  readonly shape: LeagueShape;
  readonly pickNumber: number;
  readonly nextPickNumber: number | null;
}

/**
 * The player id to take, or `null` when this roster can legally hold nobody left on the board.
 *
 * NULL IS A REAL OUTCOME AND NOT AN ERROR, which the first version of this harness got wrong. A
 * seat drafting on plain projected points will happily spend its whole bench on quarterbacks,
 * because quarterbacks score the most points; eleven such seats can empty the position entirely,
 * and a twelfth seat drafting on value over replacement - which correctly wants no quarterback
 * until late - then arrives at its last turn with only a quarterback slot open and no
 * quarterback in the world to put in it. Throwing there would abandon a replay for demonstrating
 * exactly the failure the replay exists to demonstrate. The seat passes, and its unfilled slot
 * scores nothing, which is the honest charge for it.
 */
export type SeatStrategy = (view: SeatView) => string | null;

function firstLegal(view: SeatView, order: (a: DraftCandidate, b: DraftCandidate) => number): string | null {
  return (
    [...view.board]
      .sort(order)
      .find((entry) => canRoster(view.roster, entry.position, view.shape.rosterSlots))?.playerId ?? null
  );
}

/**
 * THE THING WE CLAIM TO BEAT: a board ranked by projected points, taken best-first subject to
 * roster legality. It is what every generic ranking is, and it is what a manager reading one
 * does. If the decision layer cannot beat this, the decision layer has not earned its place.
 */
export const byProjectedPoints: SeatStrategy = (view) =>
  firstLegal(view, (a, b) => b.projectedPoints - a.projectedPoints || a.playerId.localeCompare(b.playerId));

/**
 * THE OPPONENT A REAL ROOM ACTUALLY HAS: fill your starting slots first, best available by
 * projected points, and only then take bench bodies.
 *
 * `byProjectedPoints` is the honest strawman but it is a strawman: because quarterbacks score the
 * most points, it spends four to six of every roster on them, which no human room does. That is
 * not merely a weak opponent, it INVALIDATES THE PREMISE VALUE OVER REPLACEMENT RESTS ON. A
 * replacement level says "the twelfth quarterback is free", and he is only free in a room that
 * rosters starters rationally. Measuring our advice against a room that hoards one position is
 * measuring it against a world where its central assumption is false.
 */
export const byStartersFirstPoints: SeatStrategy = (view) => {
  const { roster, shape } = view;
  const slotConfig = shape.rosterSlots;

  /**
   * One backup per startable slot and no more. The one positional rule every real manager keeps
   * without being told: nobody rosters a third quarterback in a league that starts one, however
   * many points he projects for.
   */
  const cap = (position: DraftCandidate["position"]): number =>
    slotConfig
      .filter((slot) => slot.slot !== BENCH_SLOT && slot.eligiblePositions.includes(position))
      .reduce((count, slot) => count + slot.count, 0) + 1;

  const byPoints = [...view.board]
    .sort((a, b) => b.projectedPoints - a.projectedPoints || a.playerId.localeCompare(b.playerId))
    .filter(
      (entry) =>
        canRoster(roster, entry.position, slotConfig) &&
        roster.filter((player) => player.position === entry.position).length < cap(entry.position),
    );

  const starter = byPoints.find(
    (entry) => landingSlot(roster, entry.position, slotConfig) !== BENCH_SLOT,
  );
  return (starter ?? byPoints[0])?.playerId ?? null;
};

/** Task 1 alone, with no survival and no roster need. Isolates what replacement level is worth. */
export const byValueOverReplacement: SeatStrategy = (view) =>
  firstLegal(
    view,
    (a, b) => b.valueOverReplacement - a.valueOverReplacement || a.playerId.localeCompare(b.playerId),
  );

/** The whole decision: value, survival and roster need together. */
export const byRecommendation: SeatStrategy = (view) => recommendPick(view)[0]?.playerId ?? null;

export interface ReplayPick {
  readonly pickNumber: number;
  readonly seat: number;
  readonly playerId: string;
}

export interface DraftReplayInput {
  readonly board: readonly DraftCandidate[];
  readonly shape: LeagueShape;
  /** One strategy per seat, in round-one order. */
  readonly seats: readonly SeatStrategy[];
}

export interface DraftReplayResult {
  readonly picks: readonly ReplayPick[];
  readonly rostersBySeat: readonly (readonly RosteredPlayer[])[];
}

/**
 * A whole snake draft, replayed. Pick order comes from `snakeTeamForPick` (`@/draft-engine`)
 * rather than a second snake written here, so a replayed draft turns exactly the way a real one
 * in this product does.
 */
export function replayDraft({ board, shape, seats }: DraftReplayInput): DraftReplayResult {
  if (seats.length !== shape.teamCount) {
    throw new Error(`This league seats ${shape.teamCount} teams; ${seats.length} strategies were given.`);
  }
  const draftOrder = seats.map((_, index) => String(index));
  const rounds = totalRosterSlots(shape.rosterSlots);
  const lastPick = rounds * shape.teamCount;
  const seatAt = (pickNumber: number): number => Number(snakeTeamForPick(draftOrder, pickNumber));

  const rosters: RosteredPlayer[][] = seats.map(() => []);
  const taken = new Set<string>();
  const picks: ReplayPick[] = [];

  for (let pickNumber = 1; pickNumber <= lastPick; pickNumber += 1) {
    const seat = seatAt(pickNumber);
    let nextPickNumber: number | null = null;
    for (let ahead = pickNumber + 1; ahead <= lastPick; ahead += 1) {
      if (seatAt(ahead) === seat) {
        nextPickNumber = ahead;
        break;
      }
    }
    const available = board.filter((entry) => !taken.has(entry.playerId));
    if (available.length === 0) break;
    const playerId = seats[seat]!({
      board: available,
      roster: rosters[seat]!,
      shape,
      pickNumber,
      nextPickNumber,
    });
    // A pass, not a failure. See `SeatStrategy`.
    if (playerId === null) continue;
    const chosen = available.find((entry) => entry.playerId === playerId);
    if (chosen === undefined) {
      throw new Error(`A seat took ${playerId} at pick ${pickNumber}, who is not on the board.`);
    }
    taken.add(playerId);
    // The VALUE travels with the pick. Without it every rostered man reads as replacement level,
    // the marginal-value rule in `fitFor` degenerates into the standalone-value rule, and the
    // replay quietly measures a strategy nobody wrote. See `RosteredPlayer`.
    rosters[seat]!.push({
      playerId,
      position: chosen.position,
      valueOverReplacement: chosen.valueOverReplacement,
    });
    picks.push({ pickNumber, seat, playerId });
  }
  return { picks, rostersBySeat: rosters };
}

export interface SeatComparison {
  readonly seat: number;
  /** What that seat's roster was worth when every seat drafted the baseline way. */
  readonly baselinePoints: number;
  /** What it was worth with the strategy under test in that seat and nothing else changed. */
  readonly underTestPoints: number;
  readonly improvement: number;
}

export interface PairedDraftResult {
  readonly bySeat: readonly SeatComparison[];
  readonly meanImprovement: number;
  readonly medianImprovement: number;
  readonly seatsImproved: number;
  readonly seatCount: number;
}

export interface PairedDraftInput {
  readonly board: readonly DraftCandidate[];
  readonly shape: LeagueShape;
  readonly baseline: SeatStrategy;
  readonly underTest: SeatStrategy;
  /** What each player ACTUALLY scored. Never visible to a seat; only to the scoring. */
  readonly actualPoints: ReadonlyMap<string, number>;
}

/**
 * A roster's value: the best starting lineup it could have fielded, priced in what those men
 * actually scored. Bench depth is worth nothing here, which is the honest season-long simplification
 * to state out loud - it charges a hoarding strategy nothing for its byes and nothing for its
 * injuries, so it is if anything generous to the baseline.
 */
export function rosterValue(
  // `Slottable` rather than `RosteredPlayer`: scoring a roster needs a position and an id, and
  // asking for a value over replacement it never reads would invite a caller to invent one.
  roster: readonly Slottable[],
  actualPoints: ReadonlyMap<string, number>,
  shape: LeagueShape,
): number {
  return bestStartingTotal(roster, shape.rosterSlots, (player) => actualPoints.get(player.playerId) ?? 0);
}

export function pairedDraftReplay({
  board,
  shape,
  baseline,
  underTest,
  actualPoints,
}: PairedDraftInput): PairedDraftResult {
  const allBaseline = replayDraft({
    board,
    shape,
    seats: Array.from({ length: shape.teamCount }, () => baseline),
  });
  const bySeat: SeatComparison[] = [];
  for (let seat = 0; seat < shape.teamCount; seat += 1) {
    const swapped = replayDraft({
      board,
      shape,
      seats: Array.from({ length: shape.teamCount }, (_, index) => (index === seat ? underTest : baseline)),
    });
    const baselinePoints = rosterValue(allBaseline.rostersBySeat[seat]!, actualPoints, shape);
    const underTestPoints = rosterValue(swapped.rostersBySeat[seat]!, actualPoints, shape);
    bySeat.push({ seat, baselinePoints, underTestPoints, improvement: underTestPoints - baselinePoints });
  }
  const improvements = bySeat.map((comparison) => comparison.improvement).sort((a, b) => a - b);
  const middle = Math.floor(improvements.length / 2);
  return {
    bySeat,
    meanImprovement: improvements.reduce((sum, value) => sum + value, 0) / improvements.length,
    medianImprovement:
      improvements.length % 2 === 1
        ? improvements[middle]!
        : (improvements[middle - 1]! + improvements[middle]!) / 2,
    seatsImproved: improvements.filter((value) => value > 0).length,
    seatCount: improvements.length,
  };
}

export interface SleeperOutcome {
  readonly playerId: string;
  readonly ourRank: number;
  readonly marketRank: number;
  /** Where he actually finished, ranked over the same priced population. */
  readonly actualRank: number;
  readonly beatMarketBy: number;
  readonly hit: boolean;
}

export interface SleeperScorecard {
  /** Every named sleeper, HITS AND MISSES ALIKE. A list without its misses is a horoscope. */
  readonly outcomes: readonly SleeperOutcome[];
  readonly hits: number;
  readonly hitRate: number;
  /**
   * The same test applied to EVERY priced player. This is the bar: a list that hits at the base
   * rate has told a manager nothing he could not have got by pointing at the board at random.
   */
  readonly baseRate: number;
}

export interface SleeperScoreInput {
  readonly sleepers: readonly Sleeper[];
  readonly market: readonly MarketPrice[];
  readonly actualPoints: ReadonlyMap<string, number>;
}

/**
 * Did the men we said were mispriced actually outrun their price?
 *
 * A hit is finishing at least `MIN_RANK_GAP` places above where the market drafted him - the same
 * gap the sleeper list required to name him, so the claim and the test are the same size. Setting
 * the test looser than the claim would be marking our own homework.
 */
export function scoreSleepers({ sleepers, market, actualPoints }: SleeperScoreInput): SleeperScorecard {
  const priced = market.filter((price) => actualPoints.has(price.playerId));
  const marketRanks = new Map(
    [...priced]
      .sort((a, b) => a.averageDraftPosition - b.averageDraftPosition || a.playerId.localeCompare(b.playerId))
      .map((price, index) => [price.playerId, index + 1]),
  );
  const actualRanks = new Map(
    [...priced]
      .sort(
        (a, b) =>
          (actualPoints.get(b.playerId) ?? 0) - (actualPoints.get(a.playerId) ?? 0) ||
          a.playerId.localeCompare(b.playerId),
      )
      .map((price, index) => [price.playerId, index + 1]),
  );

  const beat = (playerId: string): number | null => {
    const marketRank = marketRanks.get(playerId);
    const actualRank = actualRanks.get(playerId);
    if (marketRank === undefined || actualRank === undefined) return null;
    return marketRank - actualRank;
  };

  const outcomes: SleeperOutcome[] = [];
  for (const sleeper of sleepers) {
    const margin = beat(sleeper.playerId);
    if (margin === null) continue;
    outcomes.push({
      playerId: sleeper.playerId,
      ourRank: sleeper.ourRank,
      marketRank: marketRanks.get(sleeper.playerId)!,
      actualRank: actualRanks.get(sleeper.playerId)!,
      beatMarketBy: margin,
      hit: margin >= MIN_RANK_GAP,
    });
  }
  const everybody = priced.map((price) => beat(price.playerId)!).filter((margin) => margin >= MIN_RANK_GAP);
  return {
    outcomes,
    hits: outcomes.filter((outcome) => outcome.hit).length,
    hitRate: outcomes.length === 0 ? 0 : outcomes.filter((outcome) => outcome.hit).length / outcomes.length,
    baseRate: priced.length === 0 ? 0 : everybody.length / priced.length,
  };
}

export interface LineupWeekInput {
  readonly candidates: readonly LineupCandidate[];
  readonly matchup: MatchupContext;
  readonly actualPoints: ReadonlyMap<string, number>;
}

export interface LineupRegret {
  /** The best lineup available in hindsight. Nobody can hit this; it is the bar. */
  readonly optimalPoints: number;
  /** What the matchup-aware recommendation actually scored. */
  readonly chosenPoints: number;
  /** What starting the highest projected scorers actually scored. */
  readonly baselinePoints: number;
  readonly regret: number;
  readonly baselineRegret: number;
}

/**
 * DECISION REGRET: points left on the bench against the lineup you could have started.
 *
 * Reported against the expected-points lineup rather than in isolation, because regret on its own
 * is dominated by how unpredictable the week was rather than by how well it was decided. The
 * comparison is the measurement.
 */
export function lineupRegret(
  { candidates, matchup, actualPoints }: LineupWeekInput,
  shape: LeagueShape,
): LineupRegret {
  const scored = (playerId: string | null): number =>
    playerId === null ? 0 : (actualPoints.get(playerId) ?? 0);

  const optimalPoints = bestStartingTotal(candidates, shape.rosterSlots, (player) =>
    scored(player.playerId),
  );
  // "Start your highest projected scorers", through the SAME slot filler the recommendation
  // uses for its own baseline pass, so the two can never disagree about who was eligible where.
  // Not a zero margin through `startSit`: with a margin of zero the win probability still turns
  // on the spread, so that would be a third, quieter strategy rather than the plain ranking.
  const baseline = assignStarters(
    startingSpots(shape.rosterSlots),
    candidates,
    (candidate) => candidate.outlook.median,
  );
  const chosen = startSit({ candidates, rosterSlots: shape.rosterSlots, matchup });

  const chosenPoints = chosen.starters.reduce((sum, starter) => sum + scored(starter.playerId), 0);
  const baselinePoints = [...baseline.values()].reduce(
    (sum, player) => sum + scored(player?.playerId ?? null),
    0,
  );
  return {
    optimalPoints,
    chosenPoints,
    baselinePoints,
    regret: optimalPoints - chosenPoints,
    baselineRegret: optimalPoints - baselinePoints,
  };
}
