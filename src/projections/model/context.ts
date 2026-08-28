import { lineComposite } from "../features/line";
import { contextWindow, indexTeamMetrics, latestTeams } from "../team-context";
import { LAST_POSSIBLE_WEEK } from "../store";
import type { ProjectionInput } from "../backtest";
import type { PlayerRates } from "./efficiency";
import type { FeatureFlags } from "./features";
import type { LinePriors } from "./line-fit";

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
  if (!features.line) return rates;

  const metrics = indexTeamMetrics(input.teamContext);
  const teams = latestTeams(input.teamContext);
  const weeks = contextWindow(input.season, input.week, LAST_POSSIBLE_WEEK);
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

  const adjusted = new Map<string, PlayerRates>();
  for (const [playerId, playerRates] of rates) {
    const team = teams.get(playerId);
    if (team === undefined) {
      // No known offence means no composite. The model without the feature is the right answer,
      // never a league-average one — an unknown team is not an average team, it is an unknown.
      adjusted.set(playerId, playerRates);
      continue;
    }
    const composite = compositeFor(team);
    const rushing =
      composite.runBlocking === null || composite.runBlocking <= 0
        ? 1
        : bounded(composite.runBlocking ** priors.line.rushingYardsElasticity);
    const passing =
      composite.passProtection === null || composite.passProtection <= 0
        ? 1
        : bounded(composite.passProtection ** priors.line.passingYardsElasticity);
    adjusted.set(playerId, {
      ...playerRates,
      rushingYardsPerCarry: playerRates.rushingYardsPerCarry * rushing,
      passingYardsPerAttempt: playerRates.passingYardsPerAttempt * passing,
    });
  }
  return adjusted;
}
