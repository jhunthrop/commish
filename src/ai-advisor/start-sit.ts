import type { LlmClient } from "@/lib/llm/client";
import { ADVISOR_CONFIG } from "./config";
import type { AdvisorContext } from "./context";
import { ADVISOR_SYSTEM_PROMPT, startSitPrompt } from "./prompt";
import { baselineStartSit, type StartSitCandidate } from "./valuation";

export interface Advice {
  readonly headline: string;
  readonly reasoning: string;
  /** True when this is the deterministic answer because the model was off, slow or unhelpful. */
  readonly degraded: boolean;
}

export interface AdvisorLlmDeps {
  /** Decided once, at the route edge, from the shared LLM-enablement check. This module never reads env. */
  readonly enabled: boolean;
  readonly llm: LlmClient;
  readonly timeoutMs?: number;
}

/** Rejects after `ms`, and always clears its timer so no handle is left dangling. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("advisor timed out")), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Two lines in, two fields out. A reply that isn't two usable lines is treated as no reply —
 * showing half a card is worse than showing the deterministic one.
 */
function toAdvice(text: string): Advice | null {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const [headline, ...rest] = lines;
  if (headline === undefined) return null;
  return { headline, reasoning: rest.join(" ").trim(), degraded: false };
}

/**
 * Ask the model, but only after the answer already exists.
 *
 * The `fallback` is computed FIRST and returned for every path that isn't a clean reply:
 * disabled, thrown, timed out, or empty. When `enabled` is false the model is **never called at
 * all**, so no API key is ever required for the advisor to work — the same contract
 * `createNudgeCopy` proves for the draft moderator.
 */
async function adviseOrFallback(deps: AdvisorLlmDeps, user: string, fallback: Advice): Promise<Advice> {
  if (!deps.enabled) return fallback;
  try {
    const result = await withTimeout(
      deps.llm.generateCompletion({ system: ADVISOR_SYSTEM_PROMPT, user, maxTokens: ADVISOR_CONFIG.maxTokens }),
      deps.timeoutMs ?? ADVISOR_CONFIG.llmTimeoutMs,
    );
    return toAdvice(result.text) ?? fallback;
  } catch {
    return fallback;
  }
}

export type StartSitFn = (input: { readonly context: AdvisorContext; readonly question: string }) => Promise<Advice>;

function baselineAdvice(context: AdvisorContext): Advice {
  const candidates: readonly StartSitCandidate[] = context.me.players;
  const baseline = baselineStartSit(candidates);
  const names = baseline.start.map((player) => `${player.name} (${player.averagePoints} pts/wk)`).join(", ");
  return {
    headline: baseline.changed ? `Start ${baseline.start.map((player) => player.name).join(", ")}.` : "Your current lineup is already your best one.",
    reasoning:
      names.length === 0
        ? "There isn't enough scored history yet to rank this roster — check back once a week has been scored."
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

/** Shared with the trade analyzer so there is one timeout, one fallback rule, one wrapper. */
export { adviseOrFallback, withTimeout };
