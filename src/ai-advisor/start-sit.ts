import type { AdvisorContext } from "./context";
import { adviseOrFallback, type Advice, type AdvisorLlmDeps } from "./llm-fallback";
import { startSitPrompt } from "./prompt";
import { baselineStartSit, type StartSitCandidate } from "./valuation";

export type StartSitFn = (input: { readonly context: AdvisorContext; readonly question: string }) => Promise<Advice>;

function baselineAdvice(context: AdvisorContext): Advice {
  const candidates: readonly StartSitCandidate[] = context.me.players;
  const baseline = baselineStartSit(candidates);
  const names = baseline.start.map((player) => `${player.name} (${player.averagePoints} pts/wk)`).join(", ");
  return {
    headline: baseline.changed ? `Start ${baseline.start.map((player) => player.name).join(", ")}.` : "Your current lineup is already your best one.",
    reasoning:
      names.length === 0
        ? "There isn't enough scored history yet to rank this roster. Check back once a week has been scored."
        : `Under this league's scoring, ${names} are your highest per-week scorers over the last few weeks.`,
    degraded: true,
  };
}

/**
 * Start/sit advice for one team in one week. The recommendation is grounded in the league's own
 * scoring settings before a token is spent — `averagePoints` is already computed under those
 * rules — so a PPR league and a standard league get different advice for the identical roster
 * whether or not a model is behind it.
 */
export function createStartSitAdvisor(deps: AdvisorLlmDeps): StartSitFn {
  return async ({ context, question }) => adviseOrFallback(deps, startSitPrompt(context, question), baselineAdvice(context));
}
