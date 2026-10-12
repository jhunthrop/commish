import { STAT_FIELDS, type StatLine } from "@research/domain/player";
import { PPR_SCORING } from "@research/domain/scoring";
import { computeFantasyPoints, type ScoringRules } from "@research/scoring/compute";
import { finalWeekOf } from "../nflverse/team-eras";
import { teamDefenseUniverseId, teamWeekKey } from "../nflverse/team-codes";
import type { TeamDefenseWeekRow } from "../nflverse/team-defense-weeks";
import type { GamesPlayedOutlook } from "./availability";
import type { BoardCandidate } from "./board";

/**
 * A TEAM DEFENCE'S SEASON, COMPOSED FROM MEASURED COMPONENTS (the 2026-09-05 kicker and team defence
 * round; spec §5 Phase B).
 *
 * THE COMPONENTS SPLIT IN TWO, AND THE SPLIT IS THE WHOLE DESIGN. Sacks, interceptions, fumble
 * recoveries, defensive touchdowns and safeties are LINEAR: they are scored per unit, so a per-game
 * rate times a game count is exactly right and they ride on the candidate's stat line. Points
 * allowed and yards allowed are NOT: they are scored through step tables
 * (`scoring/compute.ts`'s `POINTS_ALLOWED_TIERS` and `YARDS_ALLOWED_TIERS`), and the expectation of
 * a step function is not the step function of the expectation. A defence that allows 13 one week and
 * 27 the next averages 20, which scores 1 point; the two real weeks score 3 and 0, an average of
 * 1.5. Taking the tier of the average would understate that defence by half a point a game, every
 * game, and the error is systematic rather than noise. So this module averages the tier function
 * over the club's own per-game DISTRIBUTION and hands the result to
 * `BoardCandidate.perGameTierPoints`, and the per-game line it emits carries no `pointsAllowed` and
 * no `yardsAllowed` at all.
 *
 * THE TIER FUNCTION IS `computeFantasyPoints` ITSELF, called on a one-game line carrying only the
 * two allowed quantities. The tables stay private to `scoring/compute.ts`, so they have exactly one
 * spelling in this repository and a league that ever retunes them retunes this composition with
 * them. It costs one function call per game of history and buys the guarantee that the projection
 * and the scoring can never drift apart.
 *
 * SHRINKAGE IS A MIXTURE OF DISTRIBUTIONS, not a blend of two numbers. A club's own recent games are
 * mixed with the league's pooled games at a weight set by how many of its own games this board has
 * seen, and the tier function is averaged over the mixture. Blending the MEANS first and tiering
 * afterwards would reintroduce exactly the error the paragraph above exists to avoid.
 *
 * TEAM QUALITY ENTERS THROUGH THE CLUB'S OWN RECENT RECORD, which is the direct measurement of it.
 * The spec names prior-season point differential as the team-level signal we hold historically; a
 * club's own points allowed per game IS half of that differential and is already the quantity the
 * tier tables score, so it is used directly rather than through a second, derived regressor. A
 * season-win-total market, if one ever lands in the harvest, is a named amendment and not a quiet
 * addition.
 *
 * EVERY DEFENCE PLAYS EVERY GAME. That is a fact about the schedule, not a fit: a club's defence
 * cannot be inactive. The games outlook is therefore degenerate at the club's own game count, and
 * this module says so rather than fitting an availability prior that could only ever report 1.
 */

/** One club's one game, in the frame a fantasy defence is scored in. */
export interface DefenseGame {
  readonly season: number;
  readonly week: number;
  /** nflverse's own team code. */
  readonly team: string;
  readonly sacks: number;
  readonly interceptions: number;
  readonly fumbleRecoveries: number;
  readonly defensiveTouchdowns: number;
  readonly safeties: number;
  readonly pointsAllowed: number;
  readonly yardsAllowed: number;
}

/** The five components that are linear in games and ride the stat line. */
const LINEAR_COMPONENTS = ["sacks", "interceptions", "fumbleRecoveries", "defensiveTouchdowns", "safeties"] as const;
type LinearComponent = (typeof LINEAR_COMPONENTS)[number];

/**
 * One game's two allowed quantities, `[pointsAllowed, yardsAllowed]`, kept together because the tier
 * function reads both at once and they are not independent of each other: a defence that allowed six
 * points usually allowed few yards too, and pairing them by game is what preserves that.
 *
 * A TUPLE RATHER THAN AN OBJECT, for one reason. The committed priors carry one entry per fit game
 * (6,270 of them across 2013 to 2024) because a distribution shrinkage needs the games themselves,
 * and the object form renders a 25,000-line generated file that says nothing the tuple does not.
 */
export type AllowedGame = readonly [pointsAllowed: number, yardsAllowed: number];

/**
 * THE ONE SPELLING OF THE POINTS-ALLOWED JOIN KEY, for both sides of it.
 *
 * `productTeamCode` folds `STL`, `SD` and `OAK` onto the franchise's current code, and both feeds
 * have to go through it or they do not meet. The `stats_team` release normalises every club to its
 * CURRENT code (the 2013 Rams read `LA`), while `games.csv` — which the schedule observations that
 * carry the scores are built from — uses the CONTEMPORARY code (the same club reads `STL`). Keying
 * on the raw codes silently dropped exactly 224 club-games from a 2013-2023 fit: St. Louis's three
 * seasons, San Diego's four and Oakland's seven, sixteen games each, every one a real defensive
 * season that simply vanished from the sample. It was visible at all only because
 * `defenseGamesFrom` COUNTS what it drops instead of swallowing it.
 */
export const pointsAllowedKey = teamWeekKey;

/**
 * Joins the archived defence rows to the points each club allowed, which lives in the schedule
 * observations the store already holds rather than in the defence archive (see
 * `nflverse_team_defense_weeks`' own docblock for why there is only one copy of that number).
 *
 * `pointsAllowedByKey` is keyed by `pointsAllowedKey` above, on BOTH sides. A row the map cannot
 * answer for is DROPPED, never defaulted: a fabricated zero here would be a shutout this function
 * invented, which is the single most flattering wrong number a defence board can carry.
 */
export function defenseGamesFrom(
  rows: readonly TeamDefenseWeekRow[],
  pointsAllowedByKey: ReadonlyMap<string, number>,
): readonly DefenseGame[] {
  const games: DefenseGame[] = [];
  for (const row of rows) {
    const pointsAllowed = pointsAllowedByKey.get(pointsAllowedKey(row.season, row.week, row.team));
    if (pointsAllowed === undefined) continue;
    games.push({
      season: row.season,
      week: row.week,
      team: row.team,
      sacks: row.sacks,
      interceptions: row.interceptions,
      fumbleRecoveries: row.fumbleRecoveries,
      defensiveTouchdowns: row.defensiveTouchdowns,
      safeties: row.safeties,
      pointsAllowed,
      yardsAllowed: row.passingYardsAllowed + row.rushingYardsAllowed,
    });
  }
  return games.sort((a, b) => a.season - b.season || a.week - b.week || a.team.localeCompare(b.team));
}

/** Everything a team defence's projection is composed from, all of it measured on the fit seasons. */
export interface DefensePriors {
  readonly leaguePerGame: Readonly<Record<LinearComponent, number>>;
  /**
   * EVERY FIT GAME'S OWN allowed pair, not their means. A distribution shrinkage needs the games
   * themselves: averaging them first and tiering afterwards is precisely the error this module
   * exists to avoid, so the vector is what the priors carry.
   */
  readonly leagueAllowed: readonly AllowedGame[];
  /** How many of a club's own games it takes to outweigh the league mean on a linear component. */
  readonly teamPriorGames: number;
  /** The same weight for the allowed DISTRIBUTION mixture. Separate from `teamPriorGames` because
   *  the two quantities are shrunk in different spaces and there is no reason they must agree. */
  readonly tierPriorGames: number;
  /** How much a club's most recent season outweighs the one before it. Searched over a small grid. */
  readonly recencyDecay: number;
  /**
   * HOW WRONG THIS MODEL'S OWN SEASON PROJECTION TYPICALLY IS, in season points squared, under
   * `PPR_SCORING`. Feeds `seasonPointsInterval`'s third variance term — see its own docblock for why
   * an interval without it is not a predictive interval, and `KickerPriors.projectionErrorVariance`
   * for why measuring an error in points needs a preset while the composition itself does not.
   */
  readonly projectionErrorVariance: number;
}

export interface DefenseFitOptions {
  /** Seasons this fit is forbidden to read. It throws rather than filtering them out quietly. */
  readonly heldOutSeasons: readonly number[];
  readonly recencyDecayGrid?: readonly number[];
}

const DEFAULT_RECENCY_DECAY_GRID = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] as const;

/** One season's worth of a club's own games before it outweighs the league. A documented floor
 *  rather than a searched parameter, for the reason `KickerPriors` gives at length: a searched
 *  shrinkage weight on a population of 32 clubs is a parameter fitted to noise. */
const TEAM_PRIOR_GAMES = 16;
const TIER_PRIOR_GAMES = 16;

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

/** A cell's own measurement pulled toward the league's, weighted by the evidence behind it. */
function shrink(own: number, ownWeight: number, league: number, priorWeight: number): number {
  if (ownWeight <= 0) return league;
  return (own * ownWeight + league * priorWeight) / (ownWeight + priorWeight);
}

/** How heavily one game counts, by how many seasons back it sits from the most recent one present. */
function recencyWeightOf(game: DefenseGame, latestSeason: number, decay: number): number {
  return decay ** (latestSeason - game.season);
}

function latestSeasonOf(games: readonly DefenseGame[]): number {
  return games.reduce((latest, game) => Math.max(latest, game.season), 0);
}

/** One game's tier points, through `computeFantasyPoints` itself so the tables have one spelling. */
function tierPointsOf(allowed: AllowedGame, rules: ScoringRules): number {
  const line: StatLine = {
    playerId: "team-defense",
    week: 1,
    ...(Object.fromEntries(STAT_FIELDS.map((field) => [field, 0])) as Omit<StatLine, "playerId" | "week">),
    pointsAllowed: allowed[0],
    yardsAllowed: allowed[1],
  };
  return computeFantasyPoints(line, "DEF", rules);
}

/**
 * THE MEAN OF THE TIERS, NEVER THE TIER OF THE MEAN.
 *
 * A weighted average of the tier function over the club's own games (recency-weighted), mixed with
 * the same average over the league's pooled games at a weight set by `tierPriorGames` against the
 * club's own game count. A club with no games at all gets the league's own expectation, which is the
 * honest answer for a club this board has never seen play.
 */
export function expectedTierPoints(
  own: readonly DefenseGame[],
  priors: DefensePriors,
  rules: ScoringRules,
): number {
  const leagueExpectation = mean(priors.leagueAllowed.map((allowed) => tierPointsOf(allowed, rules)));
  if (own.length === 0) return leagueExpectation;

  const latest = latestSeasonOf(own);
  const weights = own.map((game) => recencyWeightOf(game, latest, priors.recencyDecay));
  const totalWeight = sum(weights);
  const ownExpectation =
    totalWeight === 0
      ? leagueExpectation
      : sum(own.map((game, index) => tierPointsOf([game.pointsAllowed, game.yardsAllowed], rules) * weights[index]!)) / totalWeight;

  // Mixed on the EXPECTATIONS of the two distributions, which is exactly a mixture of the
  // distributions themselves because expectation is linear in the mixing weight. The nonlinearity
  // that matters was already handled: each side averaged its own tier VALUES before this line.
  return shrink(ownExpectation, own.length, leagueExpectation, priors.tierPriorGames);
}

/**
 * Fits the defence priors on the games it is handed.
 *
 * THROWS on a held-out season rather than filtering it out, the same contract every other fit in
 * this directory keeps.
 */
export function fitDefensePriors(
  games: readonly DefenseGame[],
  { heldOutSeasons, recencyDecayGrid = DEFAULT_RECENCY_DECAY_GRID }: DefenseFitOptions,
): DefensePriors {
  const forbidden = new Set(heldOutSeasons);
  for (const game of games) {
    if (forbidden.has(game.season)) {
      throw new Error(
        `The team defence fit was handed ${game.season}, which is held out. A parameter fitted on a season it is later scored on is not a measurement.`,
      );
    }
  }
  if (games.length === 0) {
    throw new Error("The team defence fit was handed no defence games. A league mean measured from nothing is not a measurement.");
  }

  const leaguePerGame = Object.fromEntries(
    LINEAR_COMPONENTS.map((component) => [component, mean(games.map((game) => game[component]))]),
  ) as Record<LinearComponent, number>;
  const leagueAllowed: readonly AllowedGame[] = games.map((game) => [game.pointsAllowed, game.yardsAllowed] as const);

  const base: DefensePriors = {
    leaguePerGame,
    leagueAllowed,
    teamPriorGames: TEAM_PRIOR_GAMES,
    tierPriorGames: TIER_PRIOR_GAMES,
    recencyDecay: DEFAULT_RECENCY_DECAY_GRID[0],
    projectionErrorVariance: 0,
  };
  const scored = recencyDecayGrid.map((decay) => ({ decay, error: scoreDecay(games, { ...base, recencyDecay: decay }) }));
  // Ties resolve to the FIRST entry of the caller's own grid, so the fit is reproducible.
  const chosen: DefensePriors = {
    ...base,
    recencyDecay: scored.reduce((best, entry) => (entry.error < best.error ? entry : best)).decay,
  };
  return { ...chosen, projectionErrorVariance: fitProjectionErrorVariance(games, chosen) };
}

/**
 * THE VARIANCE OF THE MODEL'S OWN SEASON ERROR, measured leave-one-season-out over the fit window.
 *
 * For every club-season with at least one earlier season behind it, the model is asked for exactly
 * the projection it would have made from what preceded it, and the residual against what that season
 * actually scored is recorded. NOT MEAN-CENTRED, for the reason `kicker.ts`'s own version gives: an
 * honest interval pays for a bias it has not fixed rather than subtracting it out of its own error
 * estimate.
 */
function fitProjectionErrorVariance(games: readonly DefenseGame[], priors: DefensePriors): number {
  const bySeasonTeam = new Map<string, DefenseGame[]>();
  for (const game of games) {
    const key = `${game.season}|${game.team}`;
    bySeasonTeam.set(key, [...(bySeasonTeam.get(key) ?? []), game]);
  }
  const residuals: number[] = [];
  for (const [key, seasonGames] of bySeasonTeam) {
    const [seasonText, team] = key.split("|");
    const season = Number(seasonText);
    const prior = games.filter((game) => game.team === team && game.season < season);
    if (prior.length === 0) continue;
    const candidate = defenseCandidate({ team: team!, season, history: prior }, priors, PPR_SCORING);
    const projected =
      (computeFantasyPoints(candidate.perGame, "DEF", PPR_SCORING) + (candidate.perGameTierPoints ?? 0)) *
      candidate.games.expected;
    const actual = sum([...defenseWeeklyPoints(seasonGames, PPR_SCORING).values()].flatMap((points) => points));
    residuals.push(projected - actual);
  }
  if (residuals.length < 2) return 0;
  return sum(residuals.map((residual) => residual ** 2)) / residuals.length;
}

/**
 * THE ONLY SEARCH THIS MODULE MAKES. Each candidate decay predicts every club-season that has at
 * least one earlier season in the fit window, from that club's own earlier games, and is scored by
 * the mean absolute error across the five linear components plus the allowed pair.
 *
 * SCORED ON THE COMPONENTS AND NOT ON FANTASY POINTS, for the identical reason `kicker.ts` gives: a
 * points-based search would bake one scoring preset into a model whose claim is that it composes
 * through the league's own rules. Each component's error is divided by that component's league mean
 * so the six are comparable before they are summed.
 */
function scoreDecay(games: readonly DefenseGame[], priors: DefensePriors): number {
  const bySeasonTeam = new Map<string, DefenseGame[]>();
  for (const game of games) {
    const key = `${game.season}|${game.team}`;
    bySeasonTeam.set(key, [...(bySeasonTeam.get(key) ?? []), game]);
  }
  const leaguePointsAllowed = mean(priors.leagueAllowed.map((allowed) => allowed[0]));
  const leagueYardsAllowed = mean(priors.leagueAllowed.map((allowed) => allowed[1]));

  let total = 0;
  let counted = 0;
  for (const [key, seasonGames] of bySeasonTeam) {
    const [seasonText, team] = key.split("|");
    const season = Number(seasonText);
    const prior = games.filter((game) => game.team === team && game.season < season);
    if (prior.length === 0) continue;
    const predicted = shrunkComponents(prior, priors);
    const errors: readonly (readonly [number, number])[] = [
      ...LINEAR_COMPONENTS.map(
        (component) => [predicted[component] - mean(seasonGames.map((game) => game[component])), priors.leaguePerGame[component]] as const,
      ),
      [predictedAllowedMean(prior, priors, "pointsAllowed") - mean(seasonGames.map((game) => game.pointsAllowed)), leaguePointsAllowed] as const,
      [predictedAllowedMean(prior, priors, "yardsAllowed") - mean(seasonGames.map((game) => game.yardsAllowed)), leagueYardsAllowed] as const,
    ];
    total += sum(errors.map(([error, scale]) => (scale === 0 ? 0 : Math.abs(error) / scale)));
    counted += 1;
  }
  return counted === 0 ? Infinity : total / counted;
}

/** The five linear components, each recency-weighted over a club's own games and shrunk toward the
 *  league. */
function shrunkComponents(own: readonly DefenseGame[], priors: DefensePriors): Record<LinearComponent, number> {
  const latest = latestSeasonOf(own);
  const weights = own.map((game) => recencyWeightOf(game, latest, priors.recencyDecay));
  const totalWeight = sum(weights);
  return Object.fromEntries(
    LINEAR_COMPONENTS.map((component) => {
      const ownRate =
        totalWeight === 0 ? priors.leaguePerGame[component] : sum(own.map((game, index) => game[component] * weights[index]!)) / totalWeight;
      return [component, shrink(ownRate, own.length, priors.leaguePerGame[component], priors.teamPriorGames)];
    }),
  ) as Record<LinearComponent, number>;
}

/** The shrunk MEAN of one allowed quantity. Used only by the decay search, which scores against a
 *  season's own observed mean; the SHIPPED composition never means these, it tiers each game. */
function predictedAllowedMean(
  own: readonly DefenseGame[],
  priors: DefensePriors,
  field: "pointsAllowed" | "yardsAllowed",
): number {
  const latest = latestSeasonOf(own);
  const weights = own.map((game) => recencyWeightOf(game, latest, priors.recencyDecay));
  const totalWeight = sum(weights);
  const league = mean(priors.leagueAllowed.map((allowed) => (field === "pointsAllowed" ? allowed[0] : allowed[1])));
  const ownMean = totalWeight === 0 ? league : sum(own.map((game, index) => game[field] * weights[index]!)) / totalWeight;
  return shrink(ownMean, own.length, league, priors.tierPriorGames);
}

export interface DefenseCandidateInput {
  /** The club, in the SOURCE's spelling (`team-codes.ts`). */
  readonly team: string;
  readonly season: number;
  /** That club's own defence games, strictly before `season`. */
  readonly history: readonly DefenseGame[];
}

/** Games a club plays in one regular season: one fewer than the last week, because every club has
 *  exactly one bye. */
function teamGamesIn(season: number): number {
  return finalWeekOf(season) - 1;
}

/** A defence plays every game its club plays. A degenerate distribution says exactly that and
 *  nothing more, which is honest: this is a fact about the schedule and not a fitted prior. */
function everyGame(teamGames: number): GamesPlayedOutlook {
  return {
    expected: teamGames,
    rate: 1,
    distribution: { floor: teamGames, median: teamGames, ceiling: teamGames },
    probabilities: Array.from({ length: teamGames + 1 }, (_, count) => (count === teamGames ? 1 : 0)),
  };
}

/** One team defence, as the board receives it. */
export function defenseCandidate(
  input: DefenseCandidateInput,
  priors: DefensePriors,
  rules: ScoringRules,
): BoardCandidate {
  const components = shrunkComponents(input.history, priors);
  const tierPoints = expectedTierPoints(input.history, priors, rules);
  const perGame: StatLine = {
    playerId: teamDefenseUniverseId(input.team),
    week: 1,
    ...(Object.fromEntries(STAT_FIELDS.map((field) => [field, 0])) as Omit<StatLine, "playerId" | "week">),
    sacks: components.sacks,
    defensiveInterceptions: components.interceptions,
    defensiveTouchdowns: components.defensiveTouchdowns,
    defensiveFumblesRecovered: components.fumbleRecoveries,
    safeties: components.safeties,
  };

  return {
    playerId: teamDefenseUniverseId(input.team),
    position: "DEF",
    team: input.team,
    perGame,
    perGameTierPoints: tierPoints,
    games: everyGame(teamGamesIn(input.season)),
    seasonProjectionErrorVariance: priors.projectionErrorVariance,
    reasons: [
      ...(input.history.length === 0 ? ([{ code: "defense_no_history" }] as const) : []),
      {
        code: "defense_takeaways",
        sacksPerGame: components.sacks,
        takeawaysPerGame: components.interceptions + components.fumbleRecoveries,
        tierPointsPerGame: tierPoints,
      },
    ],
  };
}

/**
 * Each club-season's own weekly fantasy points, keyed `"<season>|<team>"` — the input the per-game
 * variance fit needs for the DEF cell (`game-variance.ts`). The tier points are included, because
 * they are most of a defence's week-to-week swing and a variance measured without them would
 * understate the position badly.
 */
export function defenseWeeklyPoints(
  games: readonly DefenseGame[],
  rules: ScoringRules,
): ReadonlyMap<string, readonly number[]> {
  const byKey = new Map<string, number[]>();
  for (const game of games) {
    const line: StatLine = {
      playerId: teamDefenseUniverseId(game.team),
      week: game.week,
      ...(Object.fromEntries(STAT_FIELDS.map((field) => [field, 0])) as Omit<StatLine, "playerId" | "week">),
      sacks: game.sacks,
      defensiveInterceptions: game.interceptions,
      defensiveTouchdowns: game.defensiveTouchdowns,
      defensiveFumblesRecovered: game.fumbleRecoveries,
      safeties: game.safeties,
      pointsAllowed: game.pointsAllowed,
      yardsAllowed: game.yardsAllowed,
    };
    const key = `${game.season}|${game.team}`;
    const held = byKey.get(key) ?? [];
    held.push(computeFantasyPoints(line, "DEF", rules));
    byKey.set(key, held);
  }
  return byKey;
}
