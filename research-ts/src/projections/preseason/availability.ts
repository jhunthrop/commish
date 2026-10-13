import type { Position } from "@research-ts/domain/player";
import type { ProjectionDistribution } from "../decide/outlook";
import type { RosterStatus } from "../nflverse/rosters";
import type { AvailabilityDesignation } from "./availability-status";

/**
 * EXPECTED GAMES PLAYED — the largest driver of season value that published rankings barely model.
 *
 * A season total is opportunity times efficiency times GAMES, and the third term is the one every
 * consensus board treats as seventeen for everybody. It is not. A back who misses four games loses
 * a quarter of his value however good he is per game, and across a whole board the spread in games
 * played is wider than the spread in points per game for everybody outside the top thirty.
 *
 * THE MODEL REGRESSES HARD, AND THAT IS THE POINT RATHER THAN A LIMITATION. Injury is famously
 * noisy year to year: the correlation between a player's missed games in consecutive seasons is
 * real but small, and a model that treats one lost season as destiny is wrong in the expensive
 * direction — it fades exactly the players a manager can buy cheaply and be right about. So a
 * player's own record is evidence weighed in games against a position-and-age baseline, and the
 * baseline wins unless the record is long.
 *
 * THE OUTPUT IS A DISTRIBUTION, NEVER A NUMBER. `outlook.ts` records that nothing in the engine
 * emits one, which is why the decision layer's floor and ceiling are read off a player's own
 * completed weeks and carry almost no information at draft time. Games played is the one quantity
 * where a real distribution is available cheaply and honestly: the outcome is a count between zero
 * and seventeen, so the whole distribution is eighteen numbers and can be written down exactly
 * rather than approximated by a normal that puts mass on nineteen games and on minus two.
 *
 * WHAT A SEASON OF RECORD IS EVIDENCE OF (founder report 2026-09-08). The first version of this
 * model read a player's record as one number, games played over team games, so a healthy backup
 * who dressed for eleven of seventeen was charged six missed games and a rookie promoted mid-season
 * was faded for the weeks he spent behind the starter. The record carries two facts and is now read
 * as both: games played per game AVAILABLE is role evidence, games available per team game is
 * availability evidence (`SeasonAvailability`, classified week by week in
 * `availability/week-classification.ts` from the injury report and the weekly roster). A week he
 * was rostered and healthy and did not play counts as available and as a game he did not play in,
 * which is exactly what it was. What this still does NOT do is read a game-day inactive list for
 * the season being projected: `rosters.ts` folds INA into `active` precisely so that a Sunday fact
 * cannot reach a stamp claiming late August.
 */

/** Regular-season games a team plays. Seventeen from 2021; sixteen before. */
export function teamGamesIn(season: number): number {
  return season >= 2021 ? 17 : 16;
}

/**
 * The age brackets the baseline is estimated in.
 *
 * Brackets rather than a fitted slope, because the shape is not a line and pretending it is would
 * be a claim the data does not support: availability is flat through the twenties and falls away
 * after thirty, and a straight line through that fits neither end. Four brackets over four
 * positions is sixteen cells, each estimated from enough player-seasons on the fit years to be a
 * measurement rather than an anecdote, and each one is a number a reader can argue with.
 */
export const AGE_BRACKETS = ["under25", "25to27", "28to30", "over30"] as const;
export type AgeBracket = (typeof AGE_BRACKETS)[number];

/**
 * Which bracket an age falls in. `unknown` age uses the middle of a career rather than the young
 * end: a player whose birth date the release does not carry is overwhelmingly a fringe body, and
 * guessing him young would hand him the most generous cell on the table.
 */
export function ageBracketFor(age: number | null): AgeBracket {
  if (age === null) return "25to27";
  if (age < 25) return "under25";
  if (age < 28) return "25to27";
  if (age <= 30) return "28to30";
  return "over30";
}

/**
 * The ROLE brackets, read off layer 1's predicted snap share.
 *
 * THE INPUT WITHOUT WHICH THIS MODEL IS WRONG IN THE MOST EXPENSIVE WAY AVAILABLE. The population a
 * board projects is every man on a week-one roster, and at quarterback that is three per club of
 * whom one plays. Estimated on position and age alone the quarterback cell comes out at 0.42 of a
 * season, which is the truth about a randomly chosen rostered quarterback and a catastrophic lie
 * about the starter — it would project a man who has played every game for three years at thirteen.
 *
 * BRACKETS RATHER THAN A SLOPE, and the first version of this file got that wrong. A linear term in
 * predicted snap share is attenuated by the shrinkage layer 1 already applied to that share, so the
 * fitted slope spanned a third of the range it needed to and a starting quarterback still came out
 * at thirteen games. A bucketed table reproduces each group's own mean exactly and cannot be
 * attenuated by the regression in its own input.
 */
export const ROLE_BRACKETS = ["bench", "rotation", "committee", "featured"] as const;
export type RoleBracket = (typeof ROLE_BRACKETS)[number];

/**
 * Which role bracket a predicted snap share falls in.
 *
 * Boundaries chosen from what a snap share MEANS rather than from quantiles: below 15% is a special
 * teamer, 15 to 35 is a rotation body, 35 to 60 is a committee or a two-tight-end set, and above 60
 * is a man his offence is built around. Quantile boundaries would move every time the population
 * moved and would make two seasons' tables incomparable.
 */
export function roleBracketFor(projectedSnapShare: number): RoleBracket {
  if (projectedSnapShare < 0.15) return "bench";
  if (projectedSnapShare < 0.35) return "rotation";
  if (projectedSnapShare < 0.6) return "committee";
  return "featured";
}

/** Age at the season's opener, in whole and fractional years, from an ISO `yyyy-mm-dd`. */
export function ageAtSeason(birthDate: string | null, season: number): number | null {
  if (birthDate === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate.trim());
  if (match === null) return null;
  const [, year, month, day] = match;
  const born = Date.UTC(Number(year), Number(month) - 1, Number(day));
  // The opener is always in the first ten days of September, and a bracket boundary is never within
  // a week of it, so a fixed first-of-September reference is exact for this purpose and does not
  // need the season's real schedule.
  const opener = Date.UTC(season, 8, 1);
  const years = (opener - born) / (365.2425 * 24 * 60 * 60 * 1000);
  return Number.isFinite(years) && years > 0 && years < 60 ? years : null;
}

/** One prior season of evidence about a player. */
export interface SeasonAvailability {
  readonly season: number;
  /** Games he appeared in — weeks the store holds an opportunity row for him. */
  readonly gamesPlayed: number;
  /** Games his league played that year, the denominator `gamesPlayed` is a share of. */
  readonly teamGames: number;
  /**
   * Games the store says he was UNAVAILABLE for: the injury report listed him Out, or Doubtful and
   * he did not play, or the weekly roster carried him on a reserve, PUP, non-football-injury or
   * exempt list that week (`availability/week-classification.ts`). A rostered week he was healthy
   * and did not play is neither played nor unavailable; a suspended week is counted apart, below.
   *
   * `null` where neither designation store covers the season: without the designations a missed
   * week and a did-not-play week are the same row, so the season says nothing about availability.
   * Never zero in that case, which would read as a clean season the store never observed.
   */
  readonly gamesUnavailable: number | null;
  /**
   * Games he sat SUSPENDED (founder report 2026-09-08: a served suspension is not an injury). Read
   * out of the record entirely by `availabilityEvidence`: a suspended week is neither a game he was
   * available for nor an absence that says anything about his body, so it leaves both the numerator
   * and the denominator of the availability half. `null` under the same coverage rule as
   * `gamesUnavailable`, and always `null` together with it.
   */
  readonly gamesSuspended: number | null;
}

/** One covered season of record, split into the two facts it carries. */
export interface SeasonEvidence {
  /** Games he played, never more than he was available for. */
  readonly played: number;
  /** Games he was available for: the games that count less the weeks the store says he was
   *  unavailable. A healthy week he did not play counts as available, because it was. */
  readonly available: number;
  /** Games that count for him: his team's games less the weeks he sat suspended. */
  readonly games: number;
}

function clampCount(value: number, ceiling: number): number {
  return Math.min(Math.max(0, value), ceiling);
}

/**
 * What one season of record says, in the two halves the model reads separately: `played` over
 * `available` is ROLE evidence (how much of the football he could have played he did play);
 * `available` over `games` is AVAILABILITY evidence (how much of the season he could have played at
 * all). A suspended week is in neither: it comes off `games` before anything else is read, so
 * Rashee Rice's 2025 (six suspended, three to a knee, eight played) is eight of eight available of
 * eleven games, not eight of seventeen. `null` where the designation stores do not cover the
 * season, which is silence rather than a clean year.
 */
export function availabilityEvidence(entry: SeasonAvailability): SeasonEvidence | null {
  if (entry.gamesUnavailable === null || entry.gamesSuspended === null || entry.teamGames <= 0) return null;
  const games = entry.teamGames - clampCount(entry.gamesSuspended, entry.teamGames);
  const available = games - clampCount(entry.gamesUnavailable, games);
  return { played: clampCount(entry.gamesPlayed, available), available, games };
}

/** Everything the model is allowed to know about one player before a season. */
export interface AvailabilityInput {
  readonly position: Position;
  /** Years old at the opener, or null where the release carries no birth date. */
  readonly age: number | null;
  /**
   * His status at the board's moment, in the cutdown file's four words: the resolution's word
   * where a dated source names him (`current-status.ts` through `availabilityStatusFor`), the
   * file's own where none does. `statusMultiplier` keys on it.
   */
  readonly status: RosterStatus;
  /**
   * The finer designation behind `status` (`availabilityDesignationOf`): which reserve list, a
   * return designation, an Out on an active roster. `null` where there is none. Read ONLY where
   * the priors carry a fitted cell for it (`designationMultiplier`); otherwise `status` stands.
   */
  readonly designation: AvailabilityDesignation | null;
  /**
   * ROLE, read through layer 1's predicted snap share. See `ROLE_BRACKETS` for why this input is
   * not optional and what happens to the model without it.
   *
   * ZERO where the engine has no opinion, and that is a claim rather than a placeholder: a man with
   * no predicted snap share is a man with no usage history who is not a drafted rookie, which on a
   * week-one roster means a camp body.
   */
  readonly projectedSnapShare: number;
  /** Prior seasons, in any order. Only the most recent `historySeasons` are weighed. */
  readonly history: readonly SeasonAvailability[];
  /**
   * A BASELINE THAT REPLACES THE POSITION-AND-ROLE TABLE, or null to use it. Set for rookies.
   *
   * The table below reads a player's role through layer 1's predicted snap share, and layer 1 emits
   * nothing at all for a man with no usage history. A drafted rookie therefore arrives here with a
   * snap share invented by `rookies.ts` from a table that is CONDITIONAL ON PLAYING — which is the
   * right per-game number and exactly the wrong role signal, because it says a seventh-round
   * quarterback is a featured starter when what it means is "the seventh-round quarterbacks who
   * played were starting".
   *
   * A rookie's draft capital IS his record, so it supplies his baseline directly. Everything else
   * about him runs through the same machinery: the cutdown status still multiplies, the
   * beta-binomial still gives him a floor and a ceiling, and his empty history still makes that
   * spread the widest on the board.
   */
  readonly baselineRate: number | null;
}

export interface AvailabilityPriors {
  /**
   * THE ROLE TABLE: games played per game AVAILABLE, per position and ROLE, on the fit seasons.
   * Sixteen cells, every one a weighted mean of real player-seasons, monotone in role (a smaller
   * role can never mean more football when healthy). What a player in that bracket does with the
   * weeks he could play; availability is the other table's business.
   */
  readonly baseline: Readonly<Record<Position, Readonly<Record<RoleBracket, number>>>>;
  /**
   * THE AVAILABILITY PRIOR: the share of his team's games an active player at each position was
   * AVAILABLE for on the fit seasons (not unavailable through the injury report or a reserve list),
   * whatever he then played. Four numbers, each over hundreds of player-seasons.
   */
  readonly availabilityBaseline: Readonly<Record<Position, number>>;
  /**
   * Age as a multiplier ON THE SHRUNK RATE rather than a second table.
   *
   * Sixteen role cells times four age brackets would be sixty-four cells over eighteen hundred
   * player-seasons, and the thin ones would assert things the position as a whole contradicts. Age
   * and role are close enough to independent that a multiplier is the honest simplification: a
   * thirty-two-year-old featured back and a thirty-two-year-old rotation back lose a similar SHARE
   * of their season to the same wear.
   *
   * APPLIED AFTER THE SHRINKAGE, WHICH IS A CHANGE, and the reason is measured rather than
   * aesthetic. Applied to the PRIOR, the term is diluted by however much of the prediction the
   * player's own record accounts for — and a player's own record carries the age signal back in,
   * because an old player's record is a run of full seasons and a young player's is a rookie year
   * spent behind somebody. `docs/research/2026-08-28-starter-band.md` measures what that left on the
   * board: on four seasons the model gave players of 24 and under between 1.2 and 2.1 games fewer
   * than they played, and players of 29 and over between 0.6 and 1.6 more. A multiplier on the
   * quantity it is fitted against cannot drift like that.
   */
  readonly ageMultiplier: Readonly<Record<Position, Readonly<Record<AgeBracket, number>>>>;
  /**
   * A multiplier on the SHRUNK RATE for each cutdown status. `active` is 1 by construction — the
   * baseline is estimated over active players — and the others are what the fit seasons measured
   * relative to them.
   *
   * THE SAME CORRECTION AS THE AGE TERM AND THE SAME BUG BEFORE IT, only much larger. The
   * multiplier was fitted as the reserve group's actual availability over its BASELINE and then
   * applied to its SHRUNK rate, and those are not the same number: a man his club puts on a reserve
   * list in week one is overwhelmingly an established starter, so his record pulls his shrunk rate
   * far above the role cell, and multiplying by a ratio measured against the role cell punished him
   * twice. Measured on four seasons the reserve cell came out between 3.1 and 4.9 games below what
   * those players actually played — the worst-calibrated cell in the model, and it lands on exactly
   * the players a manager is deciding about.
   */
  readonly statusMultiplier: Readonly<Record<RosterStatus, number>>;
  /**
   * A FINER CELL FOR A DESIGNATION, where the fit committed one (current-status round,
   * 2026-09-09): the same kind of ratio as `statusMultiplier`, over the players who carried that
   * designation at the board's moment, in place of the coarse status's cell for them. The
   * `reserve` cell is one number over a population that is mostly season-enders, and the listed
   * reserve players of 2023-2024 played most of the season; whether a split earns its place is a
   * held-out measurement (`scripts/availability-designation-split.ts`), so the field is ABSENT
   * unless it did. A designation with no cell here reads its coarse status.
   */
  readonly designationMultiplier?: Readonly<Partial<Record<AvailabilityDesignation, number>>>;
  /**
   * HOW HARD THE REGRESSION IS, in team-games of prior. A player with this many games of his own
   * record is weighed half on his record and half on the baseline. Large by design: see the module
   * docblock.
   */
  readonly priorGames: number;
  /**
   * HOW HARD THE AVAILABILITY HALF REGRESSES, in team-games of prior, searched separately from
   * `priorGames` because the two halves of a record are not equally predictive: last season's role
   * says a great deal about this season's, and last season's injuries say much less about this
   * season's (the fit seasons put it at two to three times `priorGames`).
   */
  readonly availabilityPriorGames: number;
  /** How much a season of history counts relative to the one after it. Below 1: older is weaker. */
  readonly recencyDecay: number;
  /** How many prior seasons are read at all. */
  readonly historySeasons: number;
  /**
   * THE OVERDISPERSION. A pure coin-flip model of "he plays this week" with a seventeen-game season
   * gives a spread of about 1.6 games, and the real spread is more than twice that: availability is
   * not seventeen independent flips, because one torn ligament costs eight weeks at once. This is
   * the beta-binomial concentration that reproduces the observed spread, fitted by moments on the
   * fit seasons. LOWER means wider.
   */
  readonly concentration: number;
  /**
   * How much narrower a player's distribution gets per season of his own record.
   *
   * A veteran with three seasons behind him is genuinely more predictable than a man with none, and
   * `rookies.ts` depends on this being the mechanism rather than a special case: a rookie is simply
   * somebody with an empty history, and his distribution comes out wider without anybody writing a
   * rule that says so.
   */
  readonly concentrationPerSeason: number;
}

/** What the model says about one player's season. */
export interface GamesPlayedOutlook {
  /** The mean of the distribution, in games. The number a season total multiplies by. */
  readonly expected: number;
  /** The share of his team's games that mean represents. */
  readonly rate: number;
  /** Tenth, fiftieth and ninetieth percentiles, in games. */
  readonly distribution: ProjectionDistribution;
  /** The exact probability of each game count, index 0 to `teamGames`. Sums to one. */
  readonly probabilities: readonly number[];
}

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
] as const;

/** Log gamma, Lanczos approximation. Private because nothing outside a beta-binomial needs it. */
function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let series = 0.99999999999980993;
  LANCZOS.forEach((coefficient, index) => {
    series += coefficient / (z + index + 1);
  });
  const t = z + LANCZOS.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(series);
}

function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

/**
 * The exact probability of every game count under a beta-binomial.
 *
 * Written out rather than approximated because the support is eighteen points. A normal
 * approximation would put probability on nineteen games and on minus two, and the tenth percentile
 * — the number a manager reads as a floor — is exactly where that approximation is worst.
 */
export function gamesPlayedProbabilities(teamGames: number, rate: number, concentration: number): readonly number[] {
  if (!Number.isInteger(teamGames) || teamGames < 1) {
    throw new Error(`A season has a whole number of games; got ${teamGames}.`);
  }
  if (!(rate >= 0 && rate <= 1)) {
    throw new Error(`An availability rate is a share of a season; got ${rate}.`);
  }
  if (!(concentration > 0) || !Number.isFinite(concentration)) {
    throw new Error(`A beta-binomial needs a positive concentration; got ${concentration}.`);
  }
  // Pinned at the ends rather than run through the beta, where alpha or beta would be zero and the
  // log gamma would diverge. A rate of exactly one means he plays every game, with no spread, and
  // that is a statement the model is entitled to make.
  if (rate === 0) return Array.from({ length: teamGames + 1 }, (_, k) => (k === 0 ? 1 : 0));
  if (rate === 1) return Array.from({ length: teamGames + 1 }, (_, k) => (k === teamGames ? 1 : 0));

  const alpha = rate * concentration;
  const beta = (1 - rate) * concentration;
  const denominator = logBeta(alpha, beta);
  const raw = Array.from({ length: teamGames + 1 }, (_, k) => {
    const choose = logGamma(teamGames + 1) - logGamma(k + 1) - logGamma(teamGames - k + 1);
    return Math.exp(choose + logBeta(k + alpha, teamGames - k + beta) - denominator);
  });
  // Renormalised because the Lanczos approximation leaves a few parts in 10^13, and a probability
  // vector a caller sums is a vector that had better sum to one.
  const total = raw.reduce((sum, value) => sum + value, 0);
  return raw.map((value) => value / total);
}

/** The smallest game count whose cumulative probability reaches `quantile`. */
function quantileOf(probabilities: readonly number[], quantile: number): number {
  let cumulative = 0;
  for (let games = 0; games < probabilities.length; games += 1) {
    cumulative += probabilities[games]!;
    if (cumulative >= quantile) return games;
  }
  return probabilities.length - 1;
}

function recentHistory(history: readonly SeasonAvailability[], seasons: number): readonly SeasonAvailability[] {
  return [...history].sort((a, b) => b.season - a.season).slice(0, seasons);
}

function clampShare(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** One half of the record, shrunk toward its prior in proportion to the games it covers. */
function shrunkTerm(
  input: AvailabilityInput,
  priors: AvailabilityPriors,
  prior: number,
  priorGames: number,
  read: (evidence: SeasonEvidence) => { readonly numerator: number; readonly denominator: number },
): number {
  let denominator = 0;
  let numerator = 0;
  recentHistory(input.history, priors.historySeasons).forEach((entry, index) => {
    const evidence = availabilityEvidence(entry);
    if (evidence === null) return;
    const weight = priors.recencyDecay ** index;
    const term = read(evidence);
    denominator += weight * term.denominator;
    numerator += weight * term.numerator;
  });
  return denominator > 0 ? (priorGames * prior + numerator) / (priorGames + denominator) : prior;
}

/** The role prior a player is read against: his bracket's cell. */
function rolePriorFor(input: AvailabilityInput, priors: AvailabilityPriors): number {
  return clampShare(priors.baseline[input.position][roleBracketFor(input.projectedSnapShare)]);
}

/**
 * THE ROLE HALF: games played per game available, the player's own record shrunk toward his
 * bracket's cell. A man who played every week he was healthy reads above his cell; a backup who
 * dressed for eleven of seventeen healthy weeks reads below it, as a role fact.
 */
export function shrunkRole(input: AvailabilityInput, priors: AvailabilityPriors): number {
  return shrunkTerm(input, priors, rolePriorFor(input, priors), priors.priorGames, (evidence) => ({ numerator: evidence.played, denominator: evidence.available }));
}

/**
 * THE AVAILABILITY HALF: games available per team game, the player's own record shrunk toward the
 * position's prior. A healthy did-not-play week counts as available, so a backup and a starter with
 * clean seasons carry the same availability; only the weeks the store says he could not play move
 * this number, and a man who lost a season to the reserve list, who used to leave no record at all,
 * now reads as one.
 */
export function shrunkAvailability(input: AvailabilityInput, priors: AvailabilityPriors): number {
  const prior = clampShare(priors.availabilityBaseline[input.position]);
  return shrunkTerm(input, priors, prior, priors.availabilityPriorGames, (evidence) => ({ numerator: evidence.available, denominator: evidence.games }));
}

/**
 * THE RATE BEFORE THE TWO CORRECTIONS: role times availability, each half of the record read only
 * as evidence of the fact it carries (founder report 2026-09-08). Before this the record was one
 * number, games played over team games, so a healthy backup's weeks on the bench read as absences
 * and a rookie promoted mid-season was faded for the weeks he spent behind the starter.
 *
 * A rookie's draft-capital baseline (`AvailabilityInput.baselineRate`) is a whole-rate prior, role
 * and availability together; it replaces the product of the two priors and is scaled by the same
 * two ratios, which for his empty record are both exactly one.
 *
 * Exported because the FIT has to see it. Both multipliers below are ratios of what a group
 * actually played to what the model told it to expect, and a ratio is only a correction if the
 * denominator is the number it will later multiply. Fitting against one quantity and applying to
 * another is how the reserve cell came to be three games wrong on four consecutive seasons.
 */
export function shrunkAvailabilityRate(input: AvailabilityInput, priors: AvailabilityPriors): number {
  const rolePrior = rolePriorFor(input, priors);
  const availabilityPrior = clampShare(priors.availabilityBaseline[input.position]);
  const role = shrunkRole(input, priors);
  const availability = shrunkAvailability(input, priors);
  if (input.baselineRate === null) return clampShare(role * availability);
  const roleRatio = rolePrior > 0 ? role / rolePrior : 1;
  const availabilityRatio = availabilityPrior > 0 ? availability / availabilityPrior : 1;
  return clampShare(clampShare(input.baselineRate) * roleRatio * availabilityRatio);
}

/** The status's multiplier: the designation's own fitted cell where the priors carry one, else the
 *  coarse status's. Exported because the fit measures its cells against exactly this choice. */
export function statusMultiplierFor(input: Pick<AvailabilityInput, "status" | "designation">, priors: Pick<AvailabilityPriors, "statusMultiplier" | "designationMultiplier">): number {
  const cell = input.designation === null ? undefined : priors.designationMultiplier?.[input.designation];
  return cell ?? priors.statusMultiplier[input.status];
}

/**
 * EXPECTED GAMES PLAYED, as a distribution.
 *
 * The rate is a shrinkage exactly like layer 1's: a position-and-role baseline, then the player's
 * own recency-weighted record pulled toward it in proportion to how many games that record covers.
 * A man with one season of evidence moves the baseline about a fifth of the way; a man with four
 * moves it half. AGE AND THE CUTDOWN STATUS THEN MULTIPLY THE RESULT, in that order and both after
 * the shrinkage, because both are fitted as ratios against exactly that quantity.
 *
 * The spread narrows with the length of the record rather than with the mean, which is what makes a
 * rookie's distribution honestly wider than a veteran's without a rule that says "rookies are
 * uncertain". See `AvailabilityPriors.concentrationPerSeason`.
 */
export function expectedGamesPlayed(
  input: AvailabilityInput,
  { season, priors }: { readonly season: number; readonly priors: AvailabilityPriors },
): GamesPlayedOutlook {
  const teamGames = teamGamesIn(season);
  const shrunk = shrunkAvailabilityRate(input, priors);
  const rate = Math.min(
    1,
    Math.max(
      0,
      shrunk *
        priors.ageMultiplier[input.position][ageBracketFor(input.age)] *
        statusMultiplierFor(input, priors),
    ),
  );
  const history = recentHistory(input.history, priors.historySeasons);
  return outlookFromRate(teamGames, rate, priors.concentration + priors.concentrationPerSeason * history.length);
}

/**
 * THE RECENCY AXIS (fit-round Task 3, deliverable D) — one `AvailabilityPriors` set with a different
 * `recencyDecay`, and NOTHING else changed.
 *
 * WHAT THE GAMES-HISTORY AGGREGATION ACTUALLY DOES, traced before parameterising it rather than
 * assumed: `shrunkAvailabilityRate` sorts a player's history newest first, keeps the most recent
 * `historySeasons` of it, and weighs season `index` by `recencyDecay ** index` in BOTH the numerator
 * (games played) and the denominator (team games) of the shrinkage. So the aggregation is already
 * exponentially decayed, at the committed fitted 0.7 — it was never flat — and the extension this
 * round needs is not a new mechanism but the ability for the BLEND's own grid to move that one
 * exponent and see whether the board scores better with a longer or shorter memory of a player's
 * availability record.
 *
 * `null` IS THE NULL CELL, and it returns the caller's own priors object BY REFERENCE. Not a copy
 * with the same fields: the same object, so "the null cell reproduces today's expected games bit for
 * bit" is true by construction rather than by floating-point luck. `availability.test.ts` pins it.
 */
export function withAvailabilityRecency(priors: AvailabilityPriors, recencyDecay: number | null): AvailabilityPriors {
  if (recencyDecay === null) return priors;
  if (!Number.isFinite(recencyDecay) || recencyDecay <= 0 || recencyDecay > 1) {
    throw new Error(
      `availability.ts: recencyDecay must lie in (0, 1]; got ${recencyDecay}. At or below zero a season of record would count negatively or not at all, and above one an older season would outweigh a newer one.`,
    );
  }
  return { ...priors, recencyDecay };
}

/** One rate turned into the distribution every consumer reads. The one place quantiles are taken. */
export function outlookFromRate(teamGames: number, rate: number, concentration: number): GamesPlayedOutlook {
  const probabilities = gamesPlayedProbabilities(teamGames, rate, concentration);
  return {
    expected: probabilities.reduce((sum, probability, games) => sum + probability * games, 0),
    rate,
    distribution: {
      floor: quantileOf(probabilities, 0.1),
      median: quantileOf(probabilities, 0.5),
      ceiling: quantileOf(probabilities, 0.9),
    },
    probabilities,
  };
}

/**
 * THE ABLATION'S `before` ARM: what every consensus board implicitly assumes.
 *
 * Not a strawman — it is what a site that publishes "projected season points" without a games
 * column is doing, and it is the comparison Task 1 has to beat to have been worth building.
 */
export function seventeenGamesForEveryone(season: number): GamesPlayedOutlook {
  const teamGames = teamGamesIn(season);
  const probabilities = Array.from({ length: teamGames + 1 }, (_, k) => (k === teamGames ? 1 : 0));
  return {
    expected: teamGames,
    rate: 1,
    distribution: { floor: teamGames, median: teamGames, ceiling: teamGames },
    probabilities,
  };
}
