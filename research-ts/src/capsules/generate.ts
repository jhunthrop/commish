import { parseBundle, type CapsuleBundle } from "./bundle";
import { CAPSULE_CONFIG, CAPSULE_MODEL } from "./config";
import type { PlayerFacts } from "./facts";
import { failedNarrative, narrativeRequestsFor, settleNarrative, slotRewritePrompt, voiceRewritable, withRewrittenSlot, type NarrativeResult, type NarrativeSlotRequest } from "./narrative";
import { NARRATIVE_MIN_WORDS } from "./narrative-slots";
import { bundlePromptFor, correctionKindOf, correctionPromptFor, NO_WORN_PHRASES, WRITER_RULES, type CorrectionKind, type PriorAttempt, type WornPhrases } from "./prompt";
import { renderTemplateCapsule } from "./template";
import { groundingOf, softCorrectionFor, validateCapsule, validateNarrativeSlot, wordCount, type CapsuleSize, type ValidationResult } from "./validate";
import { addGatewayUsage, CapsuleGenerationError, postChatCompletion, type CapsuleWriterDeps, type GatewayUsage } from "./write";

/**
 * ONE CALL PER PLAYER (refrains round, 2026-09-07). A player used to be three gateway calls, one
 * each for the compact read, the full read and the narrative, each paying for the same fact sheet
 * and each written blind to the other two. He is one call now (`bundle.ts`), and every part is
 * still validated on its own exactly as before: the two reads against their word bands, grounding
 * and the tension mandate, every narrative slot against its cap and grounding.
 *
 * A PART THAT FAILS COSTS MORE CALLS FOR THAT PART ALONE, UNDER ONE CEILING (overruns round,
 * 2026-09-08). A read whose fault is its length, over or under, gets the count-to-hit correction;
 * a read that misses its band a second time gets one fresh draft at that count; a read framed
 * wrongly gets its soft corrections, a read that fabricated gets a fresh write, a read the bundle
 * left out gets written outright. The other parts are kept as they were. Every call a player makes
 * counts against `CAPSULE_CONFIG.maxGatewayCallsPerPlayer` (four): the bundle, its one parse
 * retry, each read's own correction, and the fresh draft last, compact first when the two reads
 * compete for it. A narrative slot that fails is dropped, never retried, as before: the module
 * behind it renders its template sentence. The whole bundle failing (a throttle that outlasts
 * `write.ts`'s own backoff, a body with no object in it) is given one more whole attempt, the
 * spec's own "one regeneration", and then both reads fall to the template and the narrative is
 * empty.
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
 * ONE ATTEMPT AT ONE READ (written rate round, 2026-09-08): the bundle's draft, then each
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

/** One size's own outcome. `usage` is what THIS part's own calls billed, when any were made; the
 *  bundle call that wrote every part at once is on `CapsuleGenerationResult.usage`. */
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
   *  every part's own calls. `null` when no attempt ever got a billable response. */
  readonly usage: GatewayUsage | null;
}

/** A whole-bundle attempt's own outcome: the parsed parts, or why there are none, and what it
 *  cost in calls against the player's ceiling. */
interface BundleOutcome {
  readonly bundle: CapsuleBundle | null;
  readonly usage: GatewayUsage | null;
  readonly failure: CapsuleFallbackReason | null;
  readonly calls: number;
}

const NOT_AN_OBJECT = "The answer was not a single JSON object.";

function sumUsage(...parts: readonly (GatewayUsage | null)[]): GatewayUsage | null {
  return parts.reduce<GatewayUsage | null>((total, part) => (part === null ? total : addGatewayUsage(total, part)), null);
}

async function requestBundleOnce(facts: PlayerFacts, requests: readonly NarrativeSlotRequest[], deps: CapsuleWriterDeps, worn: WornPhrases, retryNote: string | null): Promise<BundleOutcome> {
  const user = retryNote === null ? bundlePromptFor(facts, requests, worn) : `${bundlePromptFor(facts, requests, worn)}\n\n${retryNote}`;
  const messages = [
    { role: "system", content: WRITER_RULES },
    { role: "user", content: user },
  ];
  try {
    const { content, usage } = await postChatCompletion(messages, CAPSULE_CONFIG.bundle.maxTokens, deps);
    const bundle = parseBundle(content);
    return bundle === null ? { bundle: null, usage, failure: { kind: "failed_validation", firstViolation: NOT_AN_OBJECT }, calls: 1 } : { bundle, usage, failure: null, calls: 1 };
  } catch (error: unknown) {
    const usage = error instanceof CapsuleGenerationError ? error.billedUsage : null;
    return { bundle: null, usage, failure: { kind: "throttled" }, calls: 1 };
  }
}

/** The bundle, with the one whole retry the spec allows: a second attempt only when the first
 *  produced no object at all, its note naming which of the two things went wrong. */
async function requestBundle(facts: PlayerFacts, requests: readonly NarrativeSlotRequest[], deps: CapsuleWriterDeps, worn: WornPhrases): Promise<BundleOutcome> {
  const first = await requestBundleOnce(facts, requests, deps, worn, null);
  if (first.bundle !== null) return first;
  const note = first.failure?.kind === "throttled" ? "Your previous attempt did not complete. Answer again in full." : `Your previous answer was not a single JSON object. Return exactly one JSON object with the three keys and nothing around it.`;
  const second = await requestBundleOnce(facts, requests, deps, worn, note);
  return { ...second, usage: sumUsage(first.usage, second.usage), calls: first.calls + second.calls };
}

/** What a failed validation hands back for correction: the soft points alone, or the violations
 *  for a fresh write. The band's own corrections are chosen in `nextCorrectionFor`. */
function priorAttemptFrom(body: string, result: ValidationResult): PriorAttempt {
  const corrections = result.violations.map((violation) => softCorrectionFor(violation));
  const softCorrections = corrections.every((correction): correction is string => correction !== null) ? corrections : undefined;
  return { body, violations: result.violations, softCorrections };
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

/** The latest text at one read and its verdict. */
interface GradedText {
  readonly text: string;
  readonly result: ValidationResult;
}

/** Where one read stands: what it has been through, and what it has cost. */
interface ReadState {
  /** `null` only before a read the bundle left out has been written. */
  readonly graded: GradedText | null;
  readonly attempts: readonly ReadAttempt[];
  /** The word count of every attempt that missed the band, in order, the latest included. */
  readonly bandMisses: readonly number[];
  /** Correction calls spent so far. The write of a left-out read is its draft, not a correction. */
  readonly corrections: number;
  /** Gateway calls this read has spent against the player's ceiling. */
  readonly calls: number;
  readonly usage: GatewayUsage | null;
}

const UNWRITTEN: ReadState = { graded: null, attempts: [], bandMisses: [], corrections: 0, calls: 0, usage: null };
const MISSING_PRIOR: PriorAttempt = { body: "", violations: [], missing: true };
const NOT_WRITTEN = "The answer carried no such read.";

/** The state after one more text has been graded: the bundle's draft (no call of this read's
 *  own) or the answer to one call. */
function graded(state: ReadState, stage: ReadAttempt["stage"], text: string, result: ValidationResult, usage: GatewayUsage | null, calls: number): ReadState {
  return {
    graded: { text, result },
    attempts: [...state.attempts, attemptOf(stage, text, result)],
    bandMisses: result.bandFailure === null ? state.bandMisses : [...state.bandMisses, result.bandFailure.words],
    corrections: state.corrections + (stage === "draft" || stage === "missing" ? 0 : 1),
    calls: state.calls + calls,
    usage: sumUsage(state.usage, usage),
  };
}

/** One read as the bundle left it: graded when it was drafted, unwritten when it was left out. */
function startOf(facts: PlayerFacts, size: CapsuleSize, drafted: string | null): ReadState {
  return drafted === null ? UNWRITTEN : graded(UNWRITTEN, "draft", drafted, validateCapsule(drafted, facts, size), null, 0);
}

function needsCall(state: ReadState): boolean {
  return state.graded === null || !state.graded.result.ok;
}

/**
 * THE RETRY POLICY, from the latest failure and the read's history alone (overruns round,
 * 2026-09-08). A band failure gets the count-to-hit correction on the read's first miss and one
 * fresh draft at that count on its second, over or under alike. A failure of content (a fabricated
 * number, a trading word, an uncited downside) gets the read's one soft or rewrite correction, and
 * only when no correction has been spent yet: a length correction that lands inside the band and
 * breaks another rule still falls to the template, as it did. `null` means the template.
 */
function nextCorrectionFor(state: ReadState): PriorAttempt | null {
  if (state.graded === null) return MISSING_PRIOR;
  const { text, result } = state.graded;
  if (result.bandFailure !== null) {
    if (state.bandMisses.length === 1) return { body: text, violations: result.violations, lengthCorrection: result.bandFailure };
    if (state.bandMisses.length === 2) return { body: text, violations: result.violations, freshDraft: { words: state.bandMisses, minWords: result.bandFailure.minWords, maxWords: result.bandFailure.maxWords } };
    return null;
  }
  return state.corrections === 0 ? priorAttemptFrom(text, result) : null;
}

function validationFailureOf(state: ReadState): CapsuleFallbackReason {
  return { kind: "failed_validation", firstViolation: state.graded?.result.violations[0] ?? NOT_WRITTEN };
}

/** One call for one read, graded exactly as the draft was; `null` text when the gateway never
 *  answered it (`write.ts` has already spent its own retries by then). */
async function askOnce(facts: PlayerFacts, size: CapsuleSize, prior: PriorAttempt, deps: CapsuleWriterDeps): Promise<{ readonly text: string | null; readonly usage: GatewayUsage | null }> {
  const messages = [
    { role: "system", content: WRITER_RULES },
    { role: "user", content: correctionPromptFor(facts, size, prior) },
  ];
  try {
    const { content, usage } = await postChatCompletion(messages, CAPSULE_CONFIG.sizes[size].maxTokens, deps);
    return { text: content.trim(), usage };
  } catch (error: unknown) {
    return { text: null, usage: error instanceof CapsuleGenerationError ? error.billedUsage : null };
  }
}

/** One read's own outcome, with the calls it spent so the other read's budget can be settled. */
interface ReadSettlement {
  readonly result: CapsuleSizeResult;
  readonly calls: number;
}

/**
 * Settles one read from where it stands, one call per step, until it validates, the policy says
 * template, or its share of the player's ceiling (`budget`) is spent.
 */
async function settleRead(facts: PlayerFacts, size: CapsuleSize, state: ReadState, budget: number, deps: CapsuleWriterDeps): Promise<ReadSettlement> {
  if (state.graded !== null && state.graded.result.ok) return { result: llmRead(state.graded.text, state.usage, state.attempts), calls: state.calls };
  const prior = nextCorrectionFor(state);
  if (prior === null || state.calls >= budget) return { result: templateRead(facts, state.usage, validationFailureOf(state), state.attempts), calls: state.calls };
  const answer = await askOnce(facts, size, prior, deps);
  if (answer.text === null) return { result: templateRead(facts, sumUsage(state.usage, answer.usage), { kind: "throttled" }, state.attempts), calls: state.calls + 1 };
  const next = graded(state, correctionKindOf(prior), answer.text, validateCapsule(answer.text, facts, size), answer.usage, 1);
  return settleRead(facts, size, next, budget, deps);
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

/**
 * Both reads and the narrative, from one call and the same facts. `worn` is the board's current
 * worn-out language, quoted into the prompt (see `WornPhrases`).
 *
 * THE CEILING IS SHARED (overruns round, 2026-09-08). What the bundle left of the four calls is
 * settled compact first, the peek's own read, with one call held back for the full read whenever
 * its draft failed, so a compact spending its extras can never take the full read's one correction.
 * The reads are settled in turn rather than at once because `write.ts` spaces every call anyway,
 * so nothing was gained by asking for two at the same time.
 */
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
  const remaining = CAPSULE_CONFIG.maxGatewayCallsPerPlayer - outcome.calls;
  const fullStart = startOf(facts, "full", bundle.full);
  const compact = await settleRead(facts, "compact", startOf(facts, "compact", bundle.compact), remaining - (needsCall(fullStart) ? 1 : 0), deps);
  const full = await settleRead(facts, "full", fullStart, remaining - compact.calls, deps);
  const settled = settleNarrative(bundle.narrative, facts, requests, model);
  const callsLeft = CAPSULE_CONFIG.maxGatewayCallsPerPlayer - outcome.calls - compact.calls - full.calls;
  const voice = await rewriteVoiceSlots(settled, facts, requests, deps, callsLeft, model);
  return assemble(compact.result, full.result, voice.narrative, sumUsage(outcome.usage, voice.usage), model);
}

/**
 * THE VOICE-RULE REWRITES (`narrative.ts`'s docblock): each slot refused only for a set phrase or an
 * aside is shown back to the writer and rewritten, up to `narrativeVoiceRewritesPerSlot` times and
 * never past the player's call ceiling, and the rewrite is graded exactly as the original was.
 */
async function rewriteVoiceSlots(
  settled: NarrativeResult,
  facts: PlayerFacts,
  requests: readonly NarrativeSlotRequest[],
  deps: CapsuleWriterDeps,
  callsLeft: number,
  model: string,
): Promise<{ readonly narrative: NarrativeResult; readonly usage: GatewayUsage | null }> {
  let narrative = settled;
  let usage: GatewayUsage | null = null;
  let calls = 0;
  const grounding = groundingOf(facts);
  for (const slot of settled.refused.filter(voiceRewritable)) {
    const request = requests.find((candidate) => candidate.key === slot.key);
    if (request === undefined) continue;
    let current = slot;
    for (let attempt = 0; attempt < CAPSULE_CONFIG.narrativeVoiceRewritesPerSlot && calls < callsLeft; attempt += 1) {
      calls += 1;
      const messages = [
        { role: "system", content: WRITER_RULES },
        { role: "user", content: slotRewritePrompt(request, current) },
      ];
      try {
        const answer = await postChatCompletion(messages, CAPSULE_CONFIG.bundle.maxTokens, deps, NARRATIVE_MIN_WORDS);
        usage = sumUsage(usage, answer.usage);
        const text = answer.content.trim();
        const result = validateNarrativeSlot(text, grounding, request.maxWords);
        if (result.ok) {
          narrative = withRewrittenSlot(narrative, slot.key, text, model);
          break;
        }
        current = { key: slot.key, text, violations: result.violations };
        if (!voiceRewritable(current)) break;
      } catch (error: unknown) {
        usage = sumUsage(usage, error instanceof CapsuleGenerationError ? error.billedUsage : null);
        break;
      }
    }
  }
  return { narrative, usage };
}
