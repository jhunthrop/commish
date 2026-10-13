import { STAT_FIELDS, type StatLine } from "@research-ts/domain/player";
import { PPR_SCORING } from "@research-ts/domain/scoring";
import { computeFantasyPoints, type ScoringRules } from "@research-ts/scoring/compute";
import type { KickingWeekRow } from "../nflverse/kicking-weeks";
import { finalWeekOf } from "../nflverse/team-eras";
import type { GamesPlayedOutlook } from "./availability";
import type { BoardCandidate } from "./board";

/**
 * A KICKER'S SEASON, COMPOSED FROM MEASURED COMPONENTS (the 2026-09-05 kicker and team defence
 * round; spec `docs/superpowers/specs/2026-09-05-kicker-defense-projections-design.md` §5 Phase B).
 *
 * ATTEMPTS TRAVEL WITH THE CLUB, MAKE RATES TRAVEL WITH THE MAN. A kicker attempts a field goal
 * because his offence stalled at the thirty, which is a fact about the offence; he makes it because
 * he is a good kicker, which is a fact about him. Composing the two separately is the entire reason
 * this model can beat a last-season-points order: a good kicker who signs with a bad offence should
 * fall, a mediocre one inheriting a great offence should rise, and a points-order board says
 * neither. Every component is a shrinkage blend toward the league mean, weighted by how much
 * evidence there actually is, so a five-attempt sample never speaks with a three-hundred-attempt
 * sample's confidence.
 *
 * IT DOES NOT USE THE SKILL POSITIONS' MACHINERY, AND THAT IS DELIBERATE. `source.ts`'s candidate
 * builder composes a line out of target share, carry share and snap share, and a kicker has none of
 * those. `fit.ts`'s availability fit is labelled off `player_week_observations`, which has never
 * held a kicker row. Leaving both untouched is also the strongest available guarantee for gate G4,
 * which requires the four skill positions' 2025 board rows to be byte-identical before and after
 * this whole round.
 *
 * NOTHING HERE READS A HELD-OUT SEASON. `fitKickerPriors` throws when handed one, the same way
 * `fitGameVariance` and `fitAvailabilityPriors` already do, rather than filtering it out quietly.
 */

/** One kicker's one season, folded out of his weekly rows. */
export interface KickerSeason {
  readonly season: number;
  /** The gsis id. */
  readonly playerId: string;
  /** The club he kicked the most weeks for that season, in the source's own spelling. */
  readonly team: string;
  /** Weeks he recorded a kicking line. His availability evidence. */
  readonly games: number;
  /** Games his club played that season. The denominator `games` is a share of. */
  readonly teamGames: number;
  readonly fieldGoalsAttempted: number;
  readonly fieldGoalsMade: number;
  readonly extraPointsAttempted: number;
  readonly extraPointsMade: number;
}

/**
 * Games a club plays in one regular season: one fewer than the last week, because every club has
 * exactly one bye. `finalWeekOf` (`team-eras.ts`) is the authority on the week count, so the
 * seventeen-game era and the sixteen-game era are told apart there and not here.
 */
function teamGamesIn(season: number): number {
  return finalWeekOf(season) - 1;
}

interface Accumulating {
  season: number;
  playerId: string;
  weeksByTeam: Map<string, number>;
  games: number;
  fieldGoalsAttempted: number;
  fieldGoalsMade: number;
  extraPointsAttempted: number;
  extraPointsMade: number;
}

/** The club a kicker kicked the most weeks for, ties broken on the alphabetically first code so the
 *  fold is deterministic and a mid-season trade never depends on row order. */
function principalTeam(weeksByTeam: ReadonlyMap<string, number>): string {
  return [...weeksByTeam.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
}

/** Folds weekly kicking rows into one row per (season, kicker). */
export function kickerSeasonsFrom(rows: readonly KickingWeekRow[]): readonly KickerSeason[] {
  const byKey = new Map<string, Accumulating>();
  for (const row of rows) {
    const key = `${row.season}|${row.playerId}`;
    const held = byKey.get(key) ?? {
      season: row.season,
      playerId: row.playerId,
      weeksByTeam: new Map<string, number>(),
      games: 0,
      fieldGoalsAttempted: 0,
      fieldGoalsMade: 0,
      extraPointsAttempted: 0,
      extraPointsMade: 0,
    };
    held.weeksByTeam.set(row.team, (held.weeksByTeam.get(row.team) ?? 0) + 1);
    held.games += 1;
    held.fieldGoalsAttempted += row.fieldGoalsAttempted;
    held.fieldGoalsMade += row.fieldGoalsMade;
    held.extraPointsAttempted += row.extraPointsAttempted;
    held.extraPointsMade += row.extraPointsMade;
    byKey.set(key, held);
  }
  return [...byKey.values()]
    .map(({ weeksByTeam, ...rest }) => ({
      ...rest,
      team: principalTeam(weeksByTeam),
      teamGames: teamGamesIn(rest.season),
    }))
    .sort((a, b) => a.season - b.season || a.playerId.localeCompare(b.playerId));
}

/** Everything a kicker's projection is composed from, all of it measured on the fit seasons. */
export interface KickerPriors {
  readonly leagueFieldGoalAttemptsPerGame: number;
  readonly leagueExtraPointAttemptsPerGame: number;
  readonly leagueFieldGoalMakeRate: number;
  readonly leagueExtraPointMakeRate: number;
  /** Share of his club's games a kicker on a week-one roster plays, league-wide. Near 1, and the
   *  fit is what says so rather than an assumption. */
  readonly leagueGamesRate: number;
  /**
   * THE FOUR SHRINKAGE WEIGHTS, IN THE UNITS OF THE EVIDENCE THEY BALANCE AGAINST. Each is "how
   * much of its own evidence a cell needs before it outweighs the league mean": sixteen games of a
   * club's own kicking volume, thirty of a kicker's own attempts, sixteen games of his own
   * availability. Roughly one season each, and DOCUMENTED FLOORS rather than searched parameters —
   * a searched shrinkage weight on a population this small is a parameter fitted to noise. The one
   * thing this module searches is `recencyDecay`.
   */
  readonly teamPriorGames: number;
  readonly kickerPriorFieldGoalAttempts: number;
  readonly kickerPriorExtraPointAttempts: number;
  readonly kickerPriorGames: number;
  /** How much last season outweighs the one before it. Searched over a small grid. */
  readonly recencyDecay: number;
  /**
   * HOW WRONG THIS MODEL'S OWN SEASON PROJECTION TYPICALLY IS, in season points squared, under
   * `PPR_SCORING`. Feeds `seasonPointsInterval`'s third variance term — see its own docblock for
   * why an interval without it is not a predictive interval.
   *
   * MEASURED UNDER THE SHIPPED PRESET while the composition itself is always under the league's own
   * rules, and that asymmetry is stated rather than hidden. A projection ERROR is a quantity in
   * points, so measuring it needs a scoring preset; propagating per-component error variances
   * through an arbitrary rules object instead would be more correct and is not what this round
   * built. A league with unusual kicking weights therefore gets a band calibrated on the standard
   * ones, which is a documented approximation and not a silent one.
   */
  readonly projectionErrorVariance: number;
}

export interface KickerFitOptions {
  /** Seasons this fit is forbidden to read. It throws rather than filtering them out quietly. */
  readonly heldOutSeasons: readonly number[];
  readonly recencyDecayGrid?: readonly number[];
}

const DEFAULT_RECENCY_DECAY_GRID = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] as const;

/** See `KickerPriors`' own docblock for why these are floors and not searched. */
const TEAM_PRIOR_GAMES = 16;
const KICKER_PRIOR_FIELD_GOAL_ATTEMPTS = 30;
const KICKER_PRIOR_EXTRA_POINT_ATTEMPTS = 30;
const KICKER_PRIOR_GAMES = 16;

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** A ratio that returns `null` rather than a fabricated number when the denominator is zero —
 *  `metrics.ts`' rule that a sample which cannot answer says so. */
function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/**
 * The one blend this module makes: a cell's own measurement pulled toward the league's, weighted by
 * how much evidence the cell actually carries against a prior count in the same unit.
 */
function shrink(own: number | null, ownWeight: number, league: number, priorWeight: number): number {
  if (own === null || ownWeight <= 0) return league;
  return (own * ownWeight + league * priorWeight) / (ownWeight + priorWeight);
}

/** Recency weights for a run of seasons, most recent first: 1, decay, decay squared. */
function recencyWeights(seasons: readonly KickerSeason[], decay: number): readonly number[] {
  const ordered = [...seasons].sort((a, b) => b.season - a.season);
  return ordered.map((_, index) => decay ** index);
}

/** One recency-weighted total of a field over a run of seasons. */
function weightedTotal(seasons: readonly KickerSeason[], decay: number, field: (entry: KickerSeason) => number): number {
  const ordered = [...seasons].sort((a, b) => b.season - a.season);
  const weights = recencyWeights(seasons, decay);
  return sum(ordered.map((entry, index) => field(entry) * weights[index]!));
}

/** The five directly-measured league means. Named explicitly rather than derived from `KickerPriors`
 *  by `Omit`, so adding a fitted parameter there cannot silently make this function owe one. */
type KickerLeagueMeans = Pick<
  KickerPriors,
  | "leagueFieldGoalAttemptsPerGame"
  | "leagueExtraPointAttemptsPerGame"
  | "leagueFieldGoalMakeRate"
  | "leagueExtraPointMakeRate"
  | "leagueGamesRate"
>;

/** The league means, measured directly. Nothing here is searched. */
function leagueMeansOf(seasons: readonly KickerSeason[]): KickerLeagueMeans {
  const games = sum(seasons.map((entry) => entry.games));
  const teamGames = sum(seasons.map((entry) => entry.teamGames));
  return {
    leagueFieldGoalAttemptsPerGame: ratio(sum(seasons.map((entry) => entry.fieldGoalsAttempted)), games) ?? 0,
    leagueExtraPointAttemptsPerGame: ratio(sum(seasons.map((entry) => entry.extraPointsAttempted)), games) ?? 0,
    leagueFieldGoalMakeRate:
      ratio(sum(seasons.map((entry) => entry.fieldGoalsMade)), sum(seasons.map((entry) => entry.fieldGoalsAttempted))) ?? 0,
    leagueExtraPointMakeRate:
      ratio(sum(seasons.map((entry) => entry.extraPointsMade)), sum(seasons.map((entry) => entry.extraPointsAttempted))) ?? 0,
    leagueGamesRate: ratio(games, teamGames) ?? 0,
  };
}

/** The four component predictions one candidate decay produces for one kicker-season, against the
 *  seasons of his that precede it. */
interface Components {
  readonly fieldGoalAttemptsPerGame: number;
  readonly extraPointAttemptsPerGame: number;
  readonly fieldGoalMakeRate: number;
  readonly extraPointMakeRate: number;
}

function predictComponents(
  ownPrior: readonly KickerSeason[],
  teamPrior: readonly KickerSeason[],
  league: KickerLeagueMeans,
  decay: number,
): Components {
  const teamGamesSeen = weightedTotal(teamPrior, decay, (entry) => entry.games);
  const ownFieldGoalAttempts = weightedTotal(ownPrior, decay, (entry) => entry.fieldGoalsAttempted);
  const ownExtraPointAttempts = weightedTotal(ownPrior, decay, (entry) => entry.extraPointsAttempted);
  return {
    fieldGoalAttemptsPerGame: shrink(
      ratio(weightedTotal(teamPrior, decay, (entry) => entry.fieldGoalsAttempted), teamGamesSeen),
      teamGamesSeen,
      league.leagueFieldGoalAttemptsPerGame,
      TEAM_PRIOR_GAMES,
    ),
    extraPointAttemptsPerGame: shrink(
      ratio(weightedTotal(teamPrior, decay, (entry) => entry.extraPointsAttempted), teamGamesSeen),
      teamGamesSeen,
      league.leagueExtraPointAttemptsPerGame,
      TEAM_PRIOR_GAMES,
    ),
    fieldGoalMakeRate: shrink(
      ratio(weightedTotal(ownPrior, decay, (entry) => entry.fieldGoalsMade), ownFieldGoalAttempts),
      ownFieldGoalAttempts,
      league.leagueFieldGoalMakeRate,
      KICKER_PRIOR_FIELD_GOAL_ATTEMPTS,
    ),
    extraPointMakeRate: shrink(
      ratio(weightedTotal(ownPrior, decay, (entry) => entry.extraPointsMade), ownExtraPointAttempts),
      ownExtraPointAttempts,
      league.leagueExtraPointMakeRate,
      KICKER_PRIOR_EXTRA_POINT_ATTEMPTS,
    ),
  };
}

/** What one kicker-season actually was, in the same four units the prediction is in. */
function observedComponents(entry: KickerSeason): Components | null {
  const fieldGoalMakeRate = ratio(entry.fieldGoalsMade, entry.fieldGoalsAttempted);
  const extraPointMakeRate = ratio(entry.extraPointsMade, entry.extraPointsAttempted);
  const perGame = ratio(entry.fieldGoalsAttempted, entry.games);
  const extraPerGame = ratio(entry.extraPointsAttempted, entry.games);
  if (fieldGoalMakeRate === null || extraPointMakeRate === null || perGame === null || extraPerGame === null) return null;
  return {
    fieldGoalAttemptsPerGame: perGame,
    extraPointAttemptsPerGame: extraPerGame,
    fieldGoalMakeRate,
    extraPointMakeRate,
  };
}

/**
 * THE ONLY SEARCH THIS MODULE MAKES. Each candidate decay is scored by predicting every
 * kicker-season that has at least one earlier season in the fit window, from that kicker's own
 * earlier seasons and his club's, and taking the mean absolute error across the four components.
 *
 * SCORED ON THE COMPONENTS AND NOT ON FANTASY POINTS, deliberately: a points-based search would
 * bake one scoring preset into a model whose whole claim is that it composes through the league's
 * own rules. Each component's error is divided by that component's league mean so the four are
 * comparable before they are summed, and so a make rate near 0.85 does not silently outweigh an
 * attempt count near 2.
 */
function scoreDecay(seasons: readonly KickerSeason[], league: KickerLeagueMeans, decay: number): number {
  const scale = [
    league.leagueFieldGoalAttemptsPerGame,
    league.leagueExtraPointAttemptsPerGame,
    league.leagueFieldGoalMakeRate,
    league.leagueExtraPointMakeRate,
  ];
  let total = 0;
  let counted = 0;
  for (const entry of seasons) {
    const ownPrior = seasons.filter((other) => other.playerId === entry.playerId && other.season < entry.season);
    if (ownPrior.length === 0) continue;
    const teamPrior = seasons.filter((other) => other.team === entry.team && other.season < entry.season);
    const observed = observedComponents(entry);
    if (observed === null) continue;
    const predicted = predictComponents(ownPrior, teamPrior, league, decay);
    const errors = [
      predicted.fieldGoalAttemptsPerGame - observed.fieldGoalAttemptsPerGame,
      predicted.extraPointAttemptsPerGame - observed.extraPointAttemptsPerGame,
      predicted.fieldGoalMakeRate - observed.fieldGoalMakeRate,
      predicted.extraPointMakeRate - observed.extraPointMakeRate,
    ];
    total += sum(errors.map((error, index) => (scale[index]! === 0 ? 0 : Math.abs(error) / scale[index]!)));
    counted += 1;
  }
  return counted === 0 ? Infinity : total / counted;
}

/**
 * Fits the kicker priors on the seasons it is handed.
 *
 * THROWS on a held-out season rather than filtering it out, the same contract `fitGameVariance`
 * keeps: a parameter fitted on a season it is later scored on is not a measurement, and a silent
 * filter is how that happens without anybody noticing.
 */
export function fitKickerPriors(seasons: readonly KickerSeason[], { heldOutSeasons, recencyDecayGrid = DEFAULT_RECENCY_DECAY_GRID }: KickerFitOptions): KickerPriors {
  const forbidden = new Set(heldOutSeasons);
  for (const entry of seasons) {
    if (forbidden.has(entry.season)) {
      throw new Error(
        `The kicker fit was handed ${entry.season}, which is held out. A parameter fitted on a season it is later scored on is not a measurement.`,
      );
    }
  }
  if (seasons.length === 0) {
    throw new Error("The kicker fit was handed no kicker seasons. A league mean measured from nothing is not a measurement.");
  }

  const league = leagueMeansOf(seasons);
  const scored = recencyDecayGrid.map((decay) => ({ decay, error: scoreDecay(seasons, league, decay) }));
  // Ties resolve to the FIRST entry of the caller's own grid, so the fit is reproducible.
  const best = scored.reduce((chosen, entry) => (entry.error < chosen.error ? entry : chosen));
  const base: KickerPriors = {
    ...league,
    teamPriorGames: TEAM_PRIOR_GAMES,
    kickerPriorFieldGoalAttempts: KICKER_PRIOR_FIELD_GOAL_ATTEMPTS,
    kickerPriorExtraPointAttempts: KICKER_PRIOR_EXTRA_POINT_ATTEMPTS,
    kickerPriorGames: KICKER_PRIOR_GAMES,
    recencyDecay: best.decay,
    projectionErrorVariance: 0,
  };
  return { ...base, projectionErrorVariance: fitProjectionErrorVariance(seasons, base) };
}

/**
 * THE VARIANCE OF THE MODEL'S OWN SEASON ERROR, measured leave-one-season-out over the fit window.
 *
 * For every kicker-season that has at least one earlier season behind it, the model is asked for
 * exactly the projection it would have made from what preceded it, and the residual against what
 * that season actually scored is recorded. The variance of those residuals is what a predictive
 * interval owes on top of its outcome noise.
 *
 * NOT MEAN-CENTRED. The residuals are squared about ZERO rather than about their own mean, on
 * purpose: a model with a systematic bias should have that bias widen its interval rather than be
 * quietly subtracted out of its own error estimate. An honest interval pays for a bias it has not
 * fixed.
 */
function fitProjectionErrorVariance(seasons: readonly KickerSeason[], priors: KickerPriors): number {
  const residuals: number[] = [];
  for (const entry of seasons) {
    const ownPrior = seasons.filter((other) => other.playerId === entry.playerId && other.season < entry.season);
    if (ownPrior.length === 0) continue;
    const teamPrior = seasons.filter((other) => other.team === entry.team && other.season < entry.season);
    const projected = projectedSeasonPoints(
      { playerId: entry.playerId, team: entry.team, season: entry.season, ownHistory: ownPrior, teamHistory: teamPrior },
      priors,
    );
    residuals.push(projected - actualSeasonPoints(entry));
  }
  if (residuals.length < 2) return 0;
  return sum(residuals.map((residual) => residual ** 2)) / residuals.length;
}

/** What the model would have said this season would score, under the shipped preset. */
function projectedSeasonPoints(input: KickerCandidateInput, priors: KickerPriors): number {
  const candidate = kickerCandidate(input, priors);
  return computeFantasyPoints(candidate.perGame, "K", PPR_SCORING) * candidate.games.expected;
}

/** What it actually scored, from the season's own totals. */
function actualSeasonPoints(entry: KickerSeason): number {
  const line: StatLine = {
    playerId: entry.playerId,
    week: 1,
    ...(Object.fromEntries(STAT_FIELDS.map((field) => [field, 0])) as Omit<StatLine, "playerId" | "week">),
    fieldGoalsMade: entry.fieldGoalsMade,
    fieldGoalsMissed: entry.fieldGoalsAttempted - entry.fieldGoalsMade,
    extraPointsMade: entry.extraPointsMade,
    extraPointsMissed: entry.extraPointsAttempted - entry.extraPointsMade,
  };
  return computeFantasyPoints(line, "K", PPR_SCORING);
}

export interface KickerCandidateInput {
  /** His `nfl_players.id`. */
  readonly playerId: string;
  /** The club he is on for the season being projected, in the SOURCE's spelling. */
  readonly team: string;
  readonly season: number;
  /** His own kicking seasons, strictly before `season`. */
  readonly ownHistory: readonly KickerSeason[];
  /** Every kicking season his 2026 club produced, whoever kicked it, strictly before `season`. */
  readonly teamHistory: readonly KickerSeason[];
}

/** `Math.exp(logChoose)`-free binomial mass: built by the recurrence, so no factorial overflows and
 *  no log-gamma is needed for a run this short. */
function binomialProbabilities(trials: number, rate: number): readonly number[] {
  const bounded = Math.min(1, Math.max(0, rate));
  const probabilities: number[] = [(1 - bounded) ** trials];
  for (let successes = 1; successes <= trials; successes += 1) {
    const previous = probabilities[successes - 1]!;
    const factor = ((trials - successes + 1) / successes) * (bounded === 1 ? Infinity : bounded / (1 - bounded));
    probabilities.push(Number.isFinite(factor) ? previous * factor : 0);
  }
  // A rate of exactly 1 puts all the mass on `trials`, which the recurrence above cannot express.
  if (bounded === 1) return probabilities.map((_, index) => (index === trials ? 1 : 0));
  const total = sum(probabilities);
  return total === 0 ? probabilities : probabilities.map((probability) => probability / total);
}

/** The count at or below which `share` of the mass sits. */
function quantileOf(probabilities: readonly number[], share: number): number {
  let cumulative = 0;
  for (let count = 0; count < probabilities.length; count += 1) {
    cumulative += probabilities[count]!;
    if (cumulative >= share) return count;
  }
  return probabilities.length - 1;
}

/**
 * How many games a kicker plays, as a distribution.
 *
 * A BINOMIAL AND NOT THE BETA-BINOMIAL the skill positions use, and the difference is stated rather
 * than hidden: `availability.ts`'s shape carries a fitted concentration parameter, and this round
 * fitted none for this position. Asserting one would be a number nothing measured. The binomial is
 * the honest minimum — it says "he plays each of his club's games with this probability" and nothing
 * more — and `game-variance.ts`'s own per-game variance cell carries the rest of the spread.
 */
function gamesOutlook(rate: number, teamGames: number): GamesPlayedOutlook {
  const probabilities = binomialProbabilities(teamGames, rate);
  return {
    expected: rate * teamGames,
    rate,
    distribution: {
      floor: quantileOf(probabilities, 0.1),
      median: quantileOf(probabilities, 0.5),
      ceiling: quantileOf(probabilities, 0.9),
    },
    probabilities,
  };
}

/** A per-game line carrying only what a kicker produces. Every other scored field is exactly zero,
 *  which for a kicker is a fact and not an absence. */
function kickerLine(playerId: string, components: Components): StatLine {
  return {
    playerId,
    week: 1,
    ...(Object.fromEntries(STAT_FIELDS.map((field) => [field, 0])) as Omit<StatLine, "playerId" | "week">),
    fieldGoalsMade: components.fieldGoalAttemptsPerGame * components.fieldGoalMakeRate,
    fieldGoalsMissed: components.fieldGoalAttemptsPerGame * (1 - components.fieldGoalMakeRate),
    extraPointsMade: components.extraPointAttemptsPerGame * components.extraPointMakeRate,
    extraPointsMissed: components.extraPointAttemptsPerGame * (1 - components.extraPointMakeRate),
  };
}

/** One kicker, as the board receives him. */
export function kickerCandidate(input: KickerCandidateInput, priors: KickerPriors): BoardCandidate {
  const league = {
    leagueFieldGoalAttemptsPerGame: priors.leagueFieldGoalAttemptsPerGame,
    leagueExtraPointAttemptsPerGame: priors.leagueExtraPointAttemptsPerGame,
    leagueFieldGoalMakeRate: priors.leagueFieldGoalMakeRate,
    leagueExtraPointMakeRate: priors.leagueExtraPointMakeRate,
    leagueGamesRate: priors.leagueGamesRate,
  };
  const components = predictComponents(input.ownHistory, input.teamHistory, league, priors.recencyDecay);
  const ownTeamGames = weightedTotal(input.ownHistory, priors.recencyDecay, (entry) => entry.teamGames);
  const gamesRate = shrink(
    ratio(weightedTotal(input.ownHistory, priors.recencyDecay, (entry) => entry.games), ownTeamGames),
    ownTeamGames,
    priors.leagueGamesRate,
    priors.kickerPriorGames,
  );

  return {
    playerId: input.playerId,
    position: "K",
    team: input.team,
    perGame: kickerLine(input.playerId, components),
    games: gamesOutlook(gamesRate, teamGamesIn(input.season)),
    seasonProjectionErrorVariance: priors.projectionErrorVariance,
    reasons: [
      ...(input.ownHistory.length === 0 ? ([{ code: "kicker_no_history" }] as const) : []),
      {
        code: "kicker_opportunity",
        fieldGoalAttemptsPerGame: components.fieldGoalAttemptsPerGame,
        extraPointAttemptsPerGame: components.extraPointAttemptsPerGame,
        fieldGoalMakeRate: components.fieldGoalMakeRate,
      },
    ],
  };
}

/**
 * Each kicker-season's own weekly fantasy points, keyed `"<season>|<playerId>"` — the input the
 * per-game variance fit needs for the K cell (`game-variance.ts`). A week with no kicking row is
 * ABSENT rather than a zero, matching `loadGameVarianceObservations`' own rule: a bye is
 * availability's question, not evidence about how a kicker's output varies in the games he plays.
 */
export function kickerWeeklyPoints(rows: readonly KickingWeekRow[], rules: ScoringRules): ReadonlyMap<string, readonly number[]> {
  const byKey = new Map<string, number[]>();
  for (const row of rows) {
    const line: StatLine = {
      playerId: row.playerId,
      week: row.week,
      ...(Object.fromEntries(STAT_FIELDS.map((field) => [field, 0])) as Omit<StatLine, "playerId" | "week">),
      fieldGoalsMade: row.fieldGoalsMade,
      fieldGoalsMissed: row.fieldGoalsMissed,
      extraPointsMade: row.extraPointsMade,
      extraPointsMissed: row.extraPointsMissed,
    };
    const key = `${row.season}|${row.playerId}`;
    const held = byKey.get(key) ?? [];
    held.push(computeFantasyPoints(line, "K", rules));
    byKey.set(key, held);
  }
  return byKey;
}
