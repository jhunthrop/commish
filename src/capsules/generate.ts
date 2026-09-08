import { parseBundle, type CapsuleBundle } from "./bundle";
import { CAPSULE_CONFIG, CAPSULE_MODEL } from "./config";
import type { PlayerFacts } from "./facts";
import { failedNarrative, narrativeRequestsFor, settleNarrative, type NarrativeResult, type NarrativeSlotRequest } from "./narrative";
import { bundlePromptFor, correctionKindOf, correctionPromptFor, NO_WORN_PHRASES, WRITER_RULES, type CorrectionKind, type PriorAttempt, type WornPhrases } from "./prompt";
import { renderTemplateCapsule } from "./template";
import { softCorrectionFor, validateCapsule, wordCount, type CapsuleSize, type ValidationResult } from "./validate";
import { addGatewayUsage, CapsuleGenerationError, postChatCompletion, type CapsuleWriterDeps, type GatewayUsage } from "./write";

/**
 * ONE CALL PER PLAYER (refrains round, 2026-09-07). A player used to be three gateway calls, one
 * each for the compact read, the full read and the narrative, each paying for the same fact sheet
 * and each written blind to the other two. He is one call now (`bundle.ts`), and every part is
 * still validated on its own exactly as before: the two reads against their word bands, grounding
 * and the tension mandate, every narrative slot against its cap and grounding.
 *
 * A PART THAT FAILS COSTS ONE MORE CALL FOR THAT PART ALONE. A read whose only fault is its length
 * gets a length correction, a read framed wrongly gets its soft corrections, a read that fabricated
 * gets a fresh write, a read the bundle left out gets written outright; the other parts are kept
 * as they were. A narrative slot that fails is dropped, never retried, as before: the module behind
 * it renders its template sentence. The whole bundle failing (a throttle that outlasts `write.ts`'s
 * own backoff, a body with no object in it) is given one more whole attempt, the spec's own "one
 * regeneration", and then both reads fall to the template and the narrative is empty.
 *
 * Never throws — the template is the permanent floor because this function always has an answer.
 */

/** WHY a size fell back to its template — an operator scanning the sweep's own detail lines needs
 *  to tell "the gateway would not talk to us" apart from "the gateway talked, but the model kept
 *  writing something the validator rejected". Classified from the LAST attempt at that part. */
export type CapsuleFallbackReason =
  | { readonly kind: "throttled" }
  | { readonly kind: "failed_validation"; readonly firstViolation: string };

/**
 * ONE ATTEMPT AT ONE READ (written rate round, 2026-09-08): the bundle's draft, then the one
 * correction by its kind. Seventy-four production reads fell on the word band and the tally logged
 * only the deciding violation, so whether the correction was ignored or the draft was further out
 * could not be known. The acceptance script prints these; the sweep never reads them.
 */
export interface ReadAttempt {
  readonly stage: "draft" | CorrectionKind;
  readonly words: number;
  readonly body: string;
  /** Empty when this attempt validated. */
  readonly violations: readonly string[];
}

/** One size's own outcome. `usage` is what THIS part's own correction call billed, when one was
 *  made; the bundle call that wrote every part at once is on `CapsuleGenerationResult.usage`. */
export interface CapsuleSizeResult {
  readonly text: string;
  readonly source: "llm" | "template";
  readonly usage: GatewayUsage | null;
  /** `null` when `source` is `"llm"`. See `CapsuleFallbackReason`. */
  readonly fallbackReason: CapsuleFallbackReason | null;
  /** Every attempt at this read, in order. Empty when the bundle itself never came back. */
  readonly attempts: readonly ReadAttempt[];
}

export interface CapsuleGenerationResult {
  readonly compact: CapsuleSizeResult;
  readonly full: CapsuleSizeResult;
  /** The validated per-module sentences. Deliberately outside `source`: a narrative that fails is a
   *  page of template sentences, which every module rendered before it existed, where a read that
   *  fails is a read nobody wrote. */
  readonly narrative: NarrativeResult;
  /** `"llm"` only when BOTH reads were freshly written and validated this run; `"template"`
   *  whenever either fell back — one conservative provenance flag, never two to reconcile. */
  readonly source: "llm" | "template";
  readonly model: string | null;
  /** Everything the gateway billed for this player: the bundle call, its retry if it had one, and
   *  every part's own correction call. `null` when no attempt ever got a billable response. */
  readonly usage: GatewayUsage | null;
}

/** A whole-bundle attempt's own outcome: the parsed parts, or why there are none. */
interface BundleOutcome {
  readonly bundle: CapsuleBundle | null;
  readonly usage: GatewayUsage | null;
  readonly failure: CapsuleFallbackReason | null;
}

const NOT_AN_OBJECT = "The answer was not a single JSON object.";

async function requestBundleOnce(facts: PlayerFacts, requests: readonly NarrativeSlotRequest[], deps: CapsuleWriterDeps, worn: WornPhrases, retryNote: string | null): Promise<BundleOutcome> {
  const user = retryNote === null ? bundlePromptFor(facts, requests, worn) : `${bundlePromptFor(facts, requests, worn)}\n\n${retryNote}`;
  const messages = [
    { role: "system", content: WRITER_RULES },
    { role: "user", content: user },
  ];
  try {
    const { content, usage } = await postChatCompletion(messages, CAPSULE_CONFIG.bundle.maxTokens, deps);
    const bundle = parseBundle(content);
    return bundle === null ? { bundle: null, usage, failure: { kind: "failed_validation", firstViolation: NOT_AN_OBJECT } } : { bundle, usage, failure: null };
  } catch (error: unknown) {
    const usage = error instanceof CapsuleGenerationError ? error.billedUsage : null;
    return { bundle: null, usage, failure: { kind: "throttled" } };
  }
}

/** The bundle, with the one whole retry the spec allows: a second attempt only when the first
 *  produced no object at all, its note naming which of the two things went wrong. */
async function requestBundle(facts: PlayerFacts, requests: readonly NarrativeSlotRequest[], deps: CapsuleWriterDeps, worn: WornPhrases): Promise<BundleOutcome> {
  const first = await requestBundleOnce(facts, requests, deps, worn, null);
  if (first.bundle !== null) return first;
  const note = first.failure?.kind === "throttled" ? "Your previous attempt did not complete. Answer again in full." : `Your previous answer was not a single JSON object. Return exactly one JSON object with the three keys and nothing around it.`;
  const second = await requestBundleOnce(facts, requests, deps, worn, note);
  return { ...second, usage: second.usage === null ? first.usage : addGatewayUsage(first.usage, second.usage) };
}

/** What a failed validation hands back for correction: the length alone, the soft points alone,
 *  or the violations for a fresh write. */
function priorAttemptFrom(body: string, result: ValidationResult): PriorAttempt {
  const corrections = result.violations.map((violation) => softCorrectionFor(violation));
  const softCorrections = corrections.every((correction): correction is string => correction !== null) ? corrections : undefined;
  return { body, violations: result.violations, lengthCorrection: result.bandFailure ?? undefined, softCorrections };
}

function llmRead(text: string, usage: GatewayUsage | null, attempts: readonly ReadAttempt[]): CapsuleSizeResult {
  return { text, source: "llm", usage, fallbackReason: null, attempts };
}

function templateRead(facts: PlayerFacts, usage: GatewayUsage | null, fallbackReason: CapsuleFallbackReason, attempts: readonly ReadAttempt[] = []): CapsuleSizeResult {
  return { text: renderTemplateCapsule(facts), source: "template", usage, fallbackReason, attempts };
}

function attemptOf(stage: ReadAttempt["stage"], body: string, result: ValidationResult): ReadAttempt {
  return { stage, words: wordCount(body), body, violations: result.violations };
}

/** One correction call for one read, graded exactly as the draft was. `attempts` is the log so
 *  far, the draft's own; the correction's attempt is appended whatever its outcome. */
async function correctRead(facts: PlayerFacts, size: CapsuleSize, prior: PriorAttempt, attempts: readonly ReadAttempt[], deps: CapsuleWriterDeps): Promise<CapsuleSizeResult> {
  const messages = [
    { role: "system", content: WRITER_RULES },
    { role: "user", content: correctionPromptFor(facts, size, prior) },
  ];
  try {
    const { content, usage } = await postChatCompletion(messages, CAPSULE_CONFIG.sizes[size].maxTokens, deps);
    const text = content.trim();
    const result = validateCapsule(text, facts, size);
    const log = [...attempts, attemptOf(correctionKindOf(prior), text, result)];
    if (result.ok) return llmRead(text, usage, log);
    return templateRead(facts, usage, { kind: "failed_validation", firstViolation: result.violations[0] ?? "unknown violation" }, log);
  } catch (error: unknown) {
    const usage = error instanceof CapsuleGenerationError ? error.billedUsage : null;
    return templateRead(facts, usage, { kind: "throttled" }, attempts);
  }
}

/** One read out of the bundle: kept when it validates, corrected once when it does not, written
 *  outright when the bundle left it out. */
async function settleRead(facts: PlayerFacts, size: CapsuleSize, drafted: string | null, deps: CapsuleWriterDeps): Promise<CapsuleSizeResult> {
  if (drafted === null) return correctRead(facts, size, { body: "", violations: [], missing: true }, [], deps);
  const result = validateCapsule(drafted, facts, size);
  const draft = attemptOf("draft", drafted, result);
  if (result.ok) return llmRead(drafted, null, [draft]);
  return correctRead(facts, size, priorAttemptFrom(drafted, result), [draft], deps);
}

function sumUsage(...parts: readonly (GatewayUsage | null)[]): GatewayUsage | null {
  return parts.reduce<GatewayUsage | null>((total, part) => (part === null ? total : addGatewayUsage(total, part)), null);
}

function assemble(compact: CapsuleSizeResult, full: CapsuleSizeResult, narrative: NarrativeResult, bundleUsage: GatewayUsage | null, model: string): CapsuleGenerationResult {
  const bothLlm = compact.source === "llm" && full.source === "llm";
  return { compact, full, narrative, source: bothLlm ? "llm" : "template", model: bothLlm ? model : null, usage: sumUsage(bundleUsage, compact.usage, full.usage) };
}

/** One player's own fallback reason, in words a sweep operator can scan in a log line. When the
 *  two sizes disagree, throttling wins the label: it is the systemic condition an operator most
 *  needs to know about, where a single size's validation failure is a one-player question. */
export function describeCapsuleFallback(compact: CapsuleSizeResult, full: CapsuleSizeResult): string {
  const reasons = [compact.fallbackReason, full.fallbackReason].filter((reason): reason is CapsuleFallbackReason => reason !== null);
  if (reasons.length === 0) return "llm";
  if (reasons.some((reason) => reason.kind === "throttled")) return "template (throttled)";
  const validationReason = reasons.find((reason): reason is Extract<CapsuleFallbackReason, { kind: "failed_validation" }> => reason.kind === "failed_validation");
  return validationReason === undefined ? "template (fell back)" : `template (failed validation: ${validationReason.firstViolation})`;
}

/** Both reads and the narrative, from one call and the same facts. `worn` is the board's current
 *  worn-out language, quoted into the prompt (see `WornPhrases`). */
export async function generateCapsule(facts: PlayerFacts, deps: CapsuleWriterDeps, worn: WornPhrases = NO_WORN_PHRASES): Promise<CapsuleGenerationResult> {
  const model = deps.model ?? CAPSULE_MODEL;
  const requests = narrativeRequestsFor(facts);
  const outcome = await requestBundle(facts, requests, deps, worn);
  if (outcome.bundle === null) {
    const failure = outcome.failure ?? { kind: "throttled" };
    const narrative = failedNarrative(failure.kind === "throttled" ? "the gateway never returned a usable answer" : NOT_AN_OBJECT);
    return assemble(templateRead(facts, null, failure), templateRead(facts, null, failure), narrative, outcome.usage, model);
  }
  const { bundle } = outcome;
  const [compact, full] = await Promise.all([settleRead(facts, "compact", bundle.compact, deps), settleRead(facts, "full", bundle.full, deps)]);
  return assemble(compact, full, settleNarrative(bundle.narrative, facts, requests, model), outcome.usage, model);
}
