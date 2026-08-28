import { gameContextFor } from "../features/context";
import { lineComposite, lineWindow } from "../features/line";
import { redZoneLeverage, redZoneMultiplier, redZoneTotals, NO_LEVERAGE } from "../features/red-zone";
import { targetDepthMultiplier, targetDepthRatio, targetDepthTotals } from "../features/target-depth";
import { redistributeShares, type ShareDelta } from "../features/redistribution";
import { schemeEstimate, schemeRatios } from "../features/scheme";
import { indexTeamMetrics, latestTeams } from "../team-context";
import { LAST_POSSIBLE_WEEK } from "../store";
import type { ProjectionInput } from "../backtest";
import type { PlayerRates } from "./efficiency";
import type { FeatureFlags } from "./features";
import type { GameContextPriors } from "./context-fit";
import type { LinePriors } from "./line-fit";
import type { PredictedOpportunity } from "./opportunity";
import type { RedZonePriors } from "../features/red-zone";
import type { TargetDepthPriors } from "../features/target-depth";
import { applyNews, newsAdjustments, type NewsPriors } from "../news/adjust";
import type { RedistributionPriors } from "./redistribution-fit";
import type { SchemePriors, SchemeVolumeElasticity } from "./scheme-fit";
import { detectTransactions } from "./transactions";

/**
 * WHERE PHASE 3'S CONTEXT MEETS PHASE 2'S MODEL — one file, so the whole of "what the context is
 * allowed to change" is visible at once.
 *
 * Every adjustment here is a MULTIPLIER on something the three layers already produced, never a
 * replacement for it. That is the same contract the spec puts on the news pass and it is imposed
 * here for the same reason: a context feature that can set a component value outright is a context
 * feature that can invent one, and the layer below it stops being measurable. A multiplier can be
 * bounded, ablated and explained; a substitution cannot.
 *
 * Each group is behind its own flag and each flag is off until a commit measured it on two
 * held-out seasons. A group whose flag is off costs exactly one boolean read, which is what makes
 * the `before` arm of an ablation genuinely the model without it rather than an approximation.
 */

/** Every fitted parameter the context layers consume. Fitted on the fit seasons, never on 2023/24. */
export interface ContextPriors {
  readonly line: LinePriors;
  readonly scheme: SchemePriors;
  readonly redistribution: RedistributionPriors;
  readonly gameContext: GameContextPriors;
  readonly redZone: RedZonePriors;
  readonly targetDepth: TargetDepthPriors;
  readonly news: NewsPriors;
}

/**
 * The largest factor any single context group may apply, either way.
 *
 * Not a safety net for a bug — it is a statement about what these features can honestly claim. The
 * difference between the best and worst offensive line in a season is worth a few tenths of a yard
 * a carry, not a doubling, and an unbounded power function on a ratio near zero can produce a
 * doubling from four carries of evidence in week 2. The bound is generous enough never to bind on a
 * real full-season composite and tight enough that a thin one cannot run away.
 */
export const CONTEXT_MULTIPLIER_BOUND = { min: 0.8, max: 1.25 } as const;

function bounded(multiplier: number): number {
  if (!Number.isFinite(multiplier)) return 1;
  return Math.min(CONTEXT_MULTIPLIER_BOUND.max, Math.max(CONTEXT_MULTIPLIER_BOUND.min, multiplier));
}

/**
 * Applies every switched-on context group to layer 2's rates.
 *
 * Layer 2 is where the LINE belongs and layer 1 is not: a good line does not get its back more
 * carries, it gets him more yards on the carries he has. Putting it on opportunity would have
 * produced a plausible-looking improvement for entirely the wrong reason, and would have been
 * invisible in a points scoreboard where a volume error and a rate error look identical.
 */
export function contextualiseRates(
  rates: ReadonlyMap<string, PlayerRates>,
  input: ProjectionInput,
  features: FeatureFlags,
  priors: ContextPriors,
): ReadonlyMap<string, PlayerRates> {
  if (!features.line && !features.gameContext && !features.redZone && !features.targetDepth) return rates;

  const metrics = indexTeamMetrics(input.teamContext);
  const teams = latestTeams(input.teamContext);
  const weeks = lineWindow(input.season, input.week, LAST_POSSIBLE_WEEK);
  // One composite per TEAM, not per player: it is a property of the offence, and computing it
  // inside the player loop would repeat the same arithmetic fifty times a week per team.
  const composites = new Map<string, ReturnType<typeof lineComposite>>();
  const compositeFor = (team: string): ReturnType<typeof lineComposite> => {
    const known = composites.get(team);
    if (known !== undefined) return known;
    const fresh = lineComposite({ team, weeks, metrics, league: priors.line.league });
    composites.set(team, fresh);
    return fresh;
  };

  /** One matchup multiplier pair per team, computed once — it is a property of the game. */
  const matchups = new Map<string, { rushing: number; passing: number }>();
  const matchupFor = (team: string): { rushing: number; passing: number } => {
    const known = matchups.get(team);
    if (known !== undefined) return known;
    const context = gameContextFor(team, { season: input.season, week: input.week }, metrics);
    const rest = context.restRatio === null || context.restRatio <= 0 ? 1 : context.restRatio;
    const factor = (opponent: number | null, elasticity: { opponent: number; rest: number }): number =>
      opponent === null || opponent <= 0 ? 1 : bounded(opponent ** elasticity.opponent * rest ** elasticity.rest);
    const fresh = {
      rushing: factor(context.opponentRushDefence, priors.gameContext.rushing),
      passing: factor(context.opponentPassDefence, priors.gameContext.passing),
    };
    matchups.set(team, fresh);
    return fresh;
  };

  /**
   * Every player's red-zone totals over the history he is being projected from, indexed once.
   *
   * `input.usage` is ALREADY the visible window — `replayWeeks` reads it through the as-of gate and
   * bounds it at the week before the one being predicted — so summing all of a player's rows is the
   * point-in-time answer with no further filtering. Grouped in one pass rather than filtered per
   * player: the usage array is tens of thousands of rows and there are hundreds of players a week.
   */
  const rowsByPlayer = new Map<string, (typeof input.usage)[number][]>();
  if (features.redZone || features.targetDepth) {
    for (const row of input.usage) {
      (rowsByPlayer.get(row.playerId) ?? rowsByPlayer.set(row.playerId, []).get(row.playerId)!).push(row);
    }
  }

  const redZoneByPlayer = new Map<string, ReturnType<typeof redZoneTotals>>();
  if (features.redZone) {
    const window = { season: input.season, week: input.week, decay: priors.redZone.recencyDecay };
    for (const [playerId, playerRows] of rowsByPlayer) redZoneByPlayer.set(playerId, redZoneTotals(playerRows, window));
  }
  const leverageFor = (playerId: string): ReturnType<typeof redZoneLeverage> => {
    if (!features.redZone) return NO_LEVERAGE;
    const position = input.positions.get(playerId);
    const totals = redZoneByPlayer.get(playerId);
    if (position === undefined || totals === undefined) return NO_LEVERAGE;
    return redZoneLeverage(totals, position, priors.redZone);
  };

  const depthByPlayer = new Map<string, number | null>();
  if (features.targetDepth) {
    const window = { season: input.season, week: input.week, decay: priors.targetDepth.recencyDecay };
    for (const [playerId, playerRows] of rowsByPlayer) {
      const position = input.positions.get(playerId);
      depthByPlayer.set(
        playerId,
        position === undefined ? null : targetDepthRatio(targetDepthTotals(playerRows, window), position, priors.targetDepth),
      );
    }
  }

  const adjusted = new Map<string, PlayerRates>();
  for (const [playerId, playerRates] of rates) {
    const leverage = leverageFor(playerId);
    // The touchdown multipliers are applied whether or not the player's TEAM is known, unlike every
    // other group here: red-zone leverage is a fact about the man, and a player whose offence we
    // cannot name still had his own carries near the goal line.
    const touchdowns = {
      rushingTouchdownsPerCarry:
        playerRates.rushingTouchdownsPerCarry * redZoneMultiplier(leverage.rushing, priors.redZone.rushingElasticity),
      receivingTouchdownsPerTarget:
        playerRates.receivingTouchdownsPerTarget * redZoneMultiplier(leverage.receiving, priors.redZone.receivingElasticity),
    };
    // Depth of target moves the two receiving rates in OPPOSITE directions, which is the whole claim:
    // a deeper throw is worth more yards and is caught less often. Applied beside the touchdown
    // multipliers rather than through them, so the two groups stay independently ablatable.
    const depth = features.targetDepth ? (depthByPlayer.get(playerId) ?? null) : null;
    const receiving = {
      receivingYardsPerTarget:
        playerRates.receivingYardsPerTarget * targetDepthMultiplier(depth, priors.targetDepth.yardsElasticity),
      // A catch rate is a probability, and nothing downstream is prepared for one above 1: layer 3
      // would emit more receptions than targets, and a PPR league would pay for them.
      receptionsPerTarget: Math.min(
        1,
        playerRates.receptionsPerTarget * targetDepthMultiplier(depth, priors.targetDepth.receptionsElasticity),
      ),
    };
    const team = teams.get(playerId);
    if (team === undefined) {
      // No known offence means no composite. The model without the feature is the right answer,
      // never a league-average one — an unknown team is not an average team, it is an unknown.
      adjusted.set(playerId, { ...playerRates, ...touchdowns, ...receiving });
      continue;
    }
    const composite = features.line ? compositeFor(team) : null;
    const rushing =
      composite === null || composite.runBlocking === null || composite.runBlocking <= 0
        ? 1
        : bounded(composite.runBlocking ** priors.line.rushingYardsElasticity);
    const passing =
      composite === null || composite.passProtection === null || composite.passProtection <= 0
        ? 1
        : bounded(composite.passProtection ** priors.line.passingYardsElasticity);
    const matchup = features.gameContext ? matchupFor(team) : { rushing: 1, passing: 1 };
    adjusted.set(playerId, {
      ...playerRates,
      ...touchdowns,
      ...receiving,
      rushingYardsPerCarry: playerRates.rushingYardsPerCarry * rushing * matchup.rushing,
      // Receiving yards move with the passing matchup too: they are the same throws seen from the
      // other end, and adjusting one without the other would say a defence can be soft against a
      // quarterback and neutral against everyone he throws to.
      receivingYardsPerTarget: receiving.receivingYardsPerTarget * matchup.passing,
      passingYardsPerAttempt: playerRates.passingYardsPerAttempt * passing * matchup.passing,
    });
  }
  return adjusted;
}

/**
 * Applies every switched-on context group to layer 1's TEAM VOLUME.
 *
 * Volume rather than share, and that distinction is the whole of where this feature belongs. A fast
 * offence does not give any one receiver a larger fraction of its targets; it runs more plays, so
 * the same fraction is worth more targets. Putting the scheme on the share would have moved players
 * relative to their own teammates, which is not what pace does and would have been wrong in a way
 * a points scoreboard could not distinguish from being right.
 */
export function contextualiseOpportunity(
  opportunity: ReadonlyMap<string, PredictedOpportunity>,
  input: ProjectionInput,
  features: FeatureFlags,
  priors: ContextPriors,
): ReadonlyMap<string, PredictedOpportunity> {
  if (!features.scheme) return opportunity;

  const metrics = indexTeamMetrics(input.teamContext);
  const teams = latestTeams(input.teamContext);
  const league = priors.scheme.league;
  const factors = new Map<string, { targets: number; carries: number; passAttempts: number } | null>();

  const factorsFor = (team: string): { targets: number; carries: number; passAttempts: number } | null => {
    if (factors.has(team)) return factors.get(team)!;
    const estimate = schemeEstimate({
      team,
      season: input.season,
      week: input.week,
      metrics,
      league,
      lastPossibleWeek: LAST_POSSIBLE_WEEK,
    });
    const ratios = schemeRatios(estimate, league);
    const resolved =
      ratios.tempo === null || ratios.passLean === null || ratios.tempo <= 0 || ratios.passLean <= 0
        ? null
        : {
            targets: applyElasticity(ratios.tempo, ratios.passLean, priors.scheme.targets),
            carries: applyElasticity(ratios.tempo, ratios.passLean, priors.scheme.carries),
            passAttempts: applyElasticity(ratios.tempo, ratios.passLean, priors.scheme.passAttempts),
          };
    factors.set(team, resolved);
    return resolved;
  };

  const adjusted = new Map<string, PredictedOpportunity>();
  for (const [playerId, player] of opportunity) {
    const team = teams.get(playerId);
    const factor = team === undefined ? null : factorsFor(team);
    if (factor === null) {
      adjusted.set(playerId, player);
      continue;
    }
    adjusted.set(playerId, {
      ...player,
      teamTargets: player.teamTargets * factor.targets,
      teamCarries: player.teamCarries * factor.carries,
      teamPassAttempts: player.teamPassAttempts * factor.passAttempts,
    });
  }
  return adjusted;
}

/** Two ratios raised to their fitted powers, bounded. `exp(a·log x + b·log y)`, written plainly. */
function applyElasticity(tempo: number, passLean: number, elasticity: SchemeVolumeElasticity): number {
  return bounded(tempo ** elasticity.tempo * passLean ** elasticity.passLean);
}

/**
 * Redistributes shares when somebody leaves or arrives — the one context group that moves a player
 * relative to his own TEAMMATES rather than moving a whole offence together.
 *
 * Applied to shares AFTER the scheme has sized the pie, and the order matters: the scheme decides
 * how many targets an offence throws, this decides who catches them, and doing it the other way
 * round would apply a redistribution to a volume it was never measured against.
 *
 * Layer 1's clamp is reapplied here because a delta can in principle push a share outside `[0, 1]`,
 * and nothing downstream is prepared for a share that is not one.
 */
export function redistributeOpportunity(
  opportunity: ReadonlyMap<string, PredictedOpportunity>,
  input: ProjectionInput,
  features: FeatureFlags,
  priors: ContextPriors,
): ReadonlyMap<string, PredictedOpportunity> {
  if (!features.redistribution) return opportunity;

  const transactions = detectTransactions({
    usage: input.usage,
    playerTeams: input.teamContext.playerTeams,
    positions: input.positions,
    snapShares: new Map([...opportunity].map(([playerId, player]) => [playerId, player.snapShare] as const)),
  });
  if (transactions.length === 0) return opportunity;

  const deltas = new Map<string, ShareDelta>();
  for (const transaction of transactions) {
    for (const [playerId, delta] of redistributeShares({
      roster: transaction.roster,
      departures: transaction.departures,
      arrivals: transaction.arrivals,
      absorptionRate: priors.redistribution.absorptionRate,
    })) {
      deltas.set(playerId, delta);
    }
  }

  const adjusted = new Map<string, PredictedOpportunity>();
  for (const [playerId, player] of opportunity) {
    const delta = deltas.get(playerId);
    if (delta === undefined) {
      adjusted.set(playerId, player);
      continue;
    }
    adjusted.set(playerId, {
      ...player,
      targetShare: clampShare(player.targetShare + delta.targetShare),
      carryShare: clampShare(player.carryShare + delta.carryShare),
    });
  }
  return adjusted;
}

/** A share is a fraction; nothing downstream is prepared for one that is not. Mirrors layer 1's own. */
function clampShare(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * THE NEWS PASS, applied to opportunity and to nothing else.
 *
 * Last in the chain on purpose. The scheme sizes the pie, redistribution decides who eats it, and
 * this removes the men who are not at the table — which is the order the three actually happen in.
 * Running it earlier would redistribute a share to a player the news had already ruled out.
 *
 * Everything the contract enforces is enforced inside `applyNews`; this function's whole job is to
 * hand it the rows the as-of gate admitted and the moment to judge expiry against. `input.asOf` is
 * that moment rather than the wall clock, so a backtest of October 2023 applies exactly the
 * adjustments that were live in October 2023.
 */
export function applyNewsToOpportunity(
  opportunity: ReadonlyMap<string, PredictedOpportunity>,
  input: ProjectionInput,
  features: FeatureFlags,
  priors: ContextPriors,
): ReadonlyMap<string, PredictedOpportunity> {
  if (!features.news || input.news.length === 0) return opportunity;
  return applyNews(opportunity, newsAdjustments(input.news, priors.news), input.asOf).opportunity;
}
