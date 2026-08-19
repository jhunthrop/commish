import { withTimeout } from "@/lib/llm/with-timeout";
import type { LlmClient } from "@/lib/llm/client";
import { ADVISOR_CONFIG } from "./config";
import { ADVISOR_SYSTEM_PROMPT } from "./prompt";

/**
 * The shared "ask the model, but only after the answer already exists" seam both AI advisors
 * (`start-sit.ts`, `trade.ts`) sit on. Extracted so there is one timeout, one fallback rule and
 * one `Advice` shape rather than two copies drifting — `start-sit.ts` originally hosted this and
 * re-exported it to `trade.ts`, which put shared plumbing behind an unrelated feature's name.
 */
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
 * all**, so no API key is ever required for either advisor to work — the same contract
 * `createNudgeCopy` proves for the draft moderator.
 */
export async function adviseOrFallback(deps: AdvisorLlmDeps, user: string, fallback: Advice): Promise<Advice> {
  if (!deps.enabled) return fallback;
  try {
    const result = await withTimeout(
      deps.llm.generateCompletion({ system: ADVISOR_SYSTEM_PROMPT, user, maxTokens: ADVISOR_CONFIG.maxTokens }),
      deps.timeoutMs ?? ADVISOR_CONFIG.llmTimeoutMs,
      "advisor",
    );
    return toAdvice(result.text) ?? fallback;
  } catch {
    return fallback;
  }
}
