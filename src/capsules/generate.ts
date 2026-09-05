import { CAPSULE_MODEL } from "./config";
import type { PlayerFacts } from "./facts";
import { renderTemplateCapsule } from "./template";
import { validateCapsule, type CapsuleSize } from "./validate";
import { generateCapsuleBody, type CapsuleWriterDeps, type GatewayUsage } from "./write";

/** One size's own outcome — which source actually won, its text, and the usage SUMMED ACROSS
 *  EVERY BILLED ATTEMPT (fix round 1, MEDIUM c) — not just the winning one. A validation failure
 *  still means the gateway was called and billed; discarding that attempt's `usage` when the
 *  capsule ultimately falls back to template was undercounting the sweep's own real spend. `null`
 *  only when no attempt ever got back a billable response at all (every attempt was a pure
 *  transport failure — a timeout, a network error, an unparseable body). */
export interface CapsuleSizeResult {
  readonly text: string;
  readonly source: "llm" | "template";
  readonly usage: GatewayUsage | null;
}

function sumNullable(a: number | null, b: number | null): number | null {
  return a === null && b === null ? null : (a ?? 0) + (b ?? 0);
}

function addUsage(accumulated: GatewayUsage | null, next: GatewayUsage): GatewayUsage {
  if (accumulated === null) return next;
  return {
    promptTokens: sumNullable(accumulated.promptTokens, next.promptTokens),
    completionTokens: sumNullable(accumulated.completionTokens, next.completionTokens),
    totalTokens: sumNullable(accumulated.totalTokens, next.totalTokens),
    costUsd: sumNullable(accumulated.costUsd, next.costUsd),
  };
}

export interface CapsuleGenerationResult {
  readonly compact: CapsuleSizeResult;
  readonly full: CapsuleSizeResult;
  /** `"llm"` only when BOTH sizes were freshly written and validated this run; `"template"`
   *  whenever either fell back — a conservative, single provenance flag rather than two, so a
   *  consumer never has to reconcile two different answers to "can I trust this text" (see
   *  `store.ts`'s own docblock for where this lands). */
  readonly source: "llm" | "template";
  readonly model: string | null;
}

/**
 * ONE SIZE, WRITE THEN VALIDATE THEN (ON FAILURE) ONE REGENERATION, THEN THE TEMPLATE — the
 * spec's own AMENDED paragraph, verbatim: "One regeneration on failure, then the deterministic
 * template." A transport failure (`write.ts`'s own retry already exhausted) is treated exactly
 * like a validation failure here: one more attempt, then the floor. Never throws — the template
 * is the permanent floor precisely because this function always has an answer.
 */
async function generateOneSize(facts: PlayerFacts, size: CapsuleSize, deps: CapsuleWriterDeps): Promise<CapsuleSizeResult> {
  let priorBody = "";
  let violations: readonly string[] = [];
  let usage: GatewayUsage | null = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const generated = await generateCapsuleBody(facts, size, deps, attempt === 1 ? undefined : { body: priorBody, violations });
      usage = addUsage(usage, generated.usage);
      const result = validateCapsule(generated.text, facts, size);
      if (result.ok) return { text: generated.text, source: "llm", usage };
      priorBody = generated.text;
      violations = result.violations;
    } catch (error: unknown) {
      // A transport failure that survived `write.ts`'s own retry. One more whole attempt (the
      // "one regeneration" the spec promises) before the template, same as a validation failure.
      // No billable usage to add here — a pure transport failure never got back a response.
      priorBody = "";
      violations = [`The previous attempt failed to generate at all (${error instanceof Error ? error.message : String(error)}). Try again.`];
    }
  }
  return { text: renderTemplateCapsule(facts), source: "template", usage };
}

/** Both sizes, from the same facts. See `CapsuleGenerationResult`'s own docblock for the
 *  provenance rule. */
export async function generateCapsule(facts: PlayerFacts, deps: CapsuleWriterDeps): Promise<CapsuleGenerationResult> {
  const [compact, full] = await Promise.all([generateOneSize(facts, "compact", deps), generateOneSize(facts, "full", deps)]);
  const bothLlm = compact.source === "llm" && full.source === "llm";
  return { compact, full, source: bothLlm ? "llm" : "template", model: bothLlm ? CAPSULE_MODEL : null };
}
