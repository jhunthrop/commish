import { CAPSULE_CONFIG, CAPSULE_MODEL } from "./config";
import type { PlayerFacts } from "./facts";
import { renderFactsForModel } from "./render";
import type { CapsuleSize } from "./validate";

/**
 * THE GATEWAY CLIENT — plain `fetch`, OpenAI chat-completions shape, against the Vercel AI
 * Gateway (`CAPSULE_CONFIG.gateway.baseUrl`), model `CAPSULE_MODEL`. A generation FAILURE here
 * (empty completion, an unparseable body, a 429/5xx that survives the one retry, a network
 * error) is a thrown `CapsuleGenerationError` — the caller (`generate.ts`) is the one place that
 * decides what a failure means (retry once with the violations quoted, then the template); this
 * module never falls back on its own.
 */
export class CapsuleGenerationError extends Error {
  readonly name = "CapsuleGenerationError";
  /** `true` for a transport-level failure (429/5xx, timeout, network error, unparseable body,
   *  empty completion) that already absorbed this module's own one retry — `false` for a
   *  request the gateway plainly refused (401/403/400), which retrying would never fix. */
  readonly retryable: boolean;
  /** Usage the gateway BILLED before this failure — a degenerate (near-empty) completion is a
   *  real charge even though its text is discarded, and that spend must reach the caller's
   *  ledger even when every retry exhausts. `null` when no attempt ever got a billable body. */
  readonly billedUsage: GatewayUsage | null;
  constructor(message: string, retryable: boolean, billedUsage: GatewayUsage | null = null) {
    super(message);
    this.retryable = retryable;
    this.billedUsage = billedUsage;
  }
}

export interface GatewayUsage {
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly totalTokens: number | null;
  /** The gateway's own `usage.cost` field, in dollars, when present — logged per generation by
   *  the sweep job's own step outcome; `null` when the gateway did not report one. */
  readonly costUsd: number | null;
}

export interface GeneratedCapsuleBody {
  readonly text: string;
  readonly usage: GatewayUsage;
}

function sumNullable(a: number | null, b: number | null): number | null {
  return a === null ? b : b === null ? a : a + b;
}

/** Sums two usage reports field by field, `null`-tolerant per field — the single source of truth
 *  for "the gateway billed twice, log the whole spend", used both here (a degenerate completion
 *  retried inside one call) and by `generate.ts` (a failed validation attempt plus its retry). */
export function addGatewayUsage(accumulated: GatewayUsage | null, next: GatewayUsage): GatewayUsage {
  if (accumulated === null) return next;
  return {
    promptTokens: sumNullable(accumulated.promptTokens, next.promptTokens),
    completionTokens: sumNullable(accumulated.completionTokens, next.completionTokens),
    totalTokens: sumNullable(accumulated.totalTokens, next.totalTokens),
    costUsd: sumNullable(accumulated.costUsd, next.costUsd),
  };
}

/** The two disable shapes the GLM family takes: Zhipu's own `thinking` object and the
 *  OpenAI-compatible `reasoning_effort` the gateway passes through for models that read it. */
const THINKING_DISABLED = { thinking: { type: "disabled" }, reasoning_effort: "none" } as const;

/** Under this many words, a completion is a reasoning model's own empty exhaust rather than the
 *  artifact that was asked for — the two long reads' floor. The narrative call passes its own,
 *  much lower floor: a JSON object of short sentences is legitimately short. */
export const DEGENERATE_COMPLETION_WORDS = 20;

export interface CapsuleWriterDeps {
  readonly apiKey: string;
  readonly fetch?: typeof globalThis.fetch;
  /**
   * The minimum gap between two gateway calls, `CAPSULE_CONFIG.gateway.minCallSpacingMs` when this
   * module is talking to the real gateway and zero when a caller injected its own `fetch` — a
   * fixture is not a rate-limited service, and a suite that slept three seconds a call would take
   * an hour. Pass it explicitly to exercise the limiter itself.
   */
  readonly callSpacingMs?: number;
  /**
   * WHICH MODEL WRITES (task 11) — `CAPSULE_MODEL` unless a caller names another. A parameter
   * rather than a constant read at the call site, so a comparison run can put two models through
   * the identical prompts, the identical validator and the identical rate limiter and have the
   * model be the only thing that differs. Production never sets it.
   */
  readonly model?: string;
  /** Per-call round-trip time, for a comparison that has to report latency as well as quality.
   *  Called once per HTTP attempt, whatever its outcome. */
  readonly onCallLatency?: (ms: number) => void;
  /**
   * `false` asks the model NOT to think before it writes (task 11). Sent as the two shapes the
   * Zhipu GLM family accepts through an OpenAI-compatible gateway, both at once, because the
   * gateway documents neither and an ignored extra field is harmless where a missing one is the
   * whole experiment. `undefined` sends nothing at all, which is production's own behaviour.
   */
  readonly thinking?: boolean;
}

/**
 * ONE GATEWAY, ONE PACE (acceptance round, task 10).
 *
 * THE MEASUREMENT: a live run threw 16 throttles in 100 players, and a second run spent three and
 * a half MINUTES a player, almost all of it in 429 backoff. The per-player pause was never the
 * shape of the problem: a player's three calls fire concurrently (`generateCapsule`'s own
 * `Promise.all`), so the gateway saw a burst of three, a pause, a burst of three. A per-minute
 * limit does not care about the average, it cares about the burst.
 *
 * This spaces EVERY call, wherever it was asked for, at the measured ceiling
 * (`gateway.callsPerMinute`). Module scope on purpose: the limit belongs to the gateway, not to
 * one sweep or one script, so two callers in one process queue behind each other rather than
 * discovering the limit separately.
 */
let nextCallAt = 0;

async function waitForGatewaySlot(spacingMs: number): Promise<void> {
  if (spacingMs <= 0) return;
  const now = Date.now();
  const waitMs = Math.max(0, nextCallAt - now);
  nextCallAt = Math.max(now, nextCallAt) + spacingMs;
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
}

/** The spacing this call runs under: a caller's own, or the gateway's measured ceiling when this
 *  module is using the real `fetch`. See `CapsuleWriterDeps.callSpacingMs`. */
function spacingFor(deps: CapsuleWriterDeps): number {
  return deps.callSpacingMs ?? (deps.fetch === undefined ? CAPSULE_CONFIG.gateway.minCallSpacingMs : 0);
}

/** A prior attempt's own violations, quoted verbatim into the retry's user message — "fix
 *  exactly this" reads far more reliably to a model than a bare "try again". */
export interface PriorAttempt {
  readonly body: string;
  readonly violations: readonly string[];
  /**
   * A LENGTH CORRECTION, NOT A REWRITE (capsule acceptance round, 2026-09-07). Set when the ONLY
   * thing wrong with `body` was its word count: nine of a thirty-player sample failed on the band
   * alone, most by a handful of words, and asking for a whole fresh attempt threw away prose that
   * was already grounded and already in voice, which then failed on something else. When this is
   * set the retry asks for the SAME text at the right length and nothing more.
   */
  readonly lengthCorrection?: { readonly words: number; readonly minWords: number; readonly maxWords: number };
  /**
   * A FRAMING CORRECTION (acceptance round, task 10) — set when every violation was about HOW
   * something was said rather than whether it was true. The retry keeps the prose and changes the
   * one clause, for the same reason the length correction does: a capsule that was grounded, in
   * voice and the right length is worth correcting, not discarding.
   */
  readonly softCorrections?: readonly string[];
}

/**
 * THE VOICE (spec's own founder requirement: "a fantasy football expert, not a scientist").
 * Confident, punchy analyst prose; every number and name traces to the supplied fact sheet and
 * NOTHING ELSE; an uncertain fact reads as an honest hedge, never a p-value. The hard rules below
 * are the mechanical ones `validate.ts` also enforces — stated here too because a model that is
 * TOLD the rule up front violates it far less often than one merely graded on it after the fact.
 *
 * THE CMC STRUCTURE (color v2, Task 3) — a founder benchmark against a competitor's own player
 * readout: "led the NFL with 413 touches, second in scrimmage yards behind only Bijan Robinson,
 * 21.3% target share leading backs, declining efficiency: 35th in explosive run rate among 49
 * qualifiers". That competitor's own charting stats (explosive run rate, missed tackles, YAC) are
 * NOT in this fact sheet and NEVER may be invented to fill their place — the structural lesson is
 * binding, the specific numbers are not. This engine's own honest analogues are the rank/qualifier/
 * neighbor triples on the fact sheet's own points, touches, receiving-yards and usage-share lines,
 * and the year-over-year trend where the fact sheet carries one. `SIZE_INSTRUCTIONS` below tells
 * each size how many beats of this shape it has room for.
 */
const VOICE_RULES = `You are a fantasy football analyst writing a short scouting note for a manager about to draft. Confident, punchy, opinionated prose, the register of a sharp analyst talking to a friend, never a lab report. Facts are CITED, never "proven": use strong verbs for your own call (he's a buy, he's the engine of that offense, the price is wrong), and honest verbs for the evidence itself (the number says, the market has him at, he averaged, the case for concern is). An uncertain or negative fact should read as an honest hesitation, not be hidden or apologized for.

Hard rules, no exceptions:
- Use ONLY the numbers and names in the fact sheet below. Never invent a stat, an injury, a teammate, a coach, or any other name or figure not printed there.
- Quote a number as the sheet gives it, or as a plain rounding of it. NEVER subtract, add, divide or otherwise combine two figures into a third one the sheet does not print: if you want to say how far our number is from his price, use the gap the sheet already states rather than working it out yourself.
- Never state that a risk, an injury, or a competitive threat is ABSENT unless the fact sheet says so explicitly. If the fact sheet is silent on something, stay silent on it too. Do not reassure the reader about a thing you have no fact for.
- Never make an all-time or historical-record claim ("best ever", "in NFL history", "all-time"). This engine holds no such data.
- Never write an em-dash and never write a semicolon. Use a period, a comma, or "and" instead. Two short sentences always beat one stitched one.
- Write like you talk. Contractions are welcome. Short sentences land harder than long ones. A reader should hear a person who watches football, not a system that processed it.
- Never name a rival fantasy product (ESPN, Yahoo, Sleeper, and so on).
- Never use the words: percentile, projection, evidence, measured, coefficient, "effect size", "standard deviation", p10, p90, implying, implied. Say "our number", "the case", "costs him" or "is worth" instead.
- If the fact sheet lists a real downside (a law that costs him points a game, or a color fact stating a year-over-year trend that fell), you must name that downside and its own number as an honest hesitation before your call. Never write a one-sided rave when the facts are mixed.
- The fact sheet gives you two ranges: a tighter "most seasons" band and the wider full tails. Lead with the "most seasons" band as the readable number. If you mention the wide tails, explain the low end in one short phrase as injury risk (games missed, not talent) and never call it "his floor" on its own. Never present the wide tails as what he is expected to score.
- If the fact sheet has a "The color" section, weave those facts into the story where they actually sharpen it, following your size's own guidance below for how many. Never recite the color section, or a run of rank numbers, as its own list or a comma-chain of stats. State a rank as a sentence you would say out loud ("he led every back in the league last year" or "one spot behind the guy taken ahead of him"), never a bare recitation of three or four numbers back to back. Pick the ones that argue FOR or AGAINST your call, not just whichever is most impressive, and lead with those. A props line or a Vegas win total is the sportsbooks' own number, something they returned or hung on him, never a claim this engine or you are making, so phrase it that way ("the books have him at", "they hang a line of") and never as an implication of what will happen.
- When you name the two outcomes the "most seasons" band points to, put them in your own words grounded in that band's own two numbers, never a bare number pair with no story. A shape like "league-winning at the top of that range and a team-crusher at the bottom" is the RIGHT IDEA, never words to copy verbatim: find your own two adjectives for the top and the bottom of his own real range.`;

const SIZE_INSTRUCTIONS: Record<CapsuleSize, string> = {
  compact: `Write ${CAPSULE_CONFIG.sizes.compact.minWords}-${CAPSULE_CONFIG.sizes.compact.maxWords} words, one flowing paragraph, no headers or bullet points. Cover, in this order of emphasis: the call, ONE rank from the fact sheet stated as a sentence (his best one, the one that most makes the case), and ONE honest worry if the facts carry one (whichever is stronger, a falling year-over-year trend or the fact sheet's own strongest law downside, told with its own number). That is the whole shape. Do not stack a second rank or a second worry on top, and do not reach for the two-outcomes close the full note uses, there is no room for it here.`,
  full: `Write ${CAPSULE_CONFIG.sizes.full.minWords}-${CAPSULE_CONFIG.sizes.full.maxWords} words, in flowing prose (no headers, no bullet points), moving through five beats in order, THE CMC STRUCTURE (see VOICE_RULES' own note on the benchmark this follows): (1) the volume or role case, leading with the fact sheet's own ranks (last season's points/touches/receiving-yards finish or a usage-share rank, whichever is strongest for him), stated as sentences, not a list, (2) the role depth in one or two sentences, WHY he carries that volume or share (the offense he plays in, what the evidence section says about his situation), (3) the honest worry, whichever the fact sheet actually gives you, a real falling year-over-year trend or the strongest law downside, told with its own number, before your call, (4) the call itself, one clear verb, (5) the two outcomes the "most seasons" band's own two tails point to, in your own words (VOICE_RULES' own "league-winning… team-crusher" example is the SHAPE of this beat, never words to reuse). Do not label the beats; write them as one continuous note. If "The color" section carries more facts than the five beats above already used, weave in one or two more, only the ones that sharpen the call.`,
};

function userMessageFor(facts: PlayerFacts, size: CapsuleSize, prior?: PriorAttempt): string {
  const sections = [`Fact sheet:\n${renderFactsForModel(facts)}`, SIZE_INSTRUCTIONS[size]];
  if (prior?.softCorrections !== undefined && prior.softCorrections.length > 0) {
    sections.push(
      `Here is your previous attempt:\n"""${prior.body}"""\n\nIt is nearly right. Make exactly these corrections and change nothing else, keeping the same facts, the same numbers, the same length and the same voice:\n${prior.softCorrections.map((correction) => `- ${correction}`).join("\n")}`,
    );
  } else if (prior?.lengthCorrection !== undefined) {
    const { words, minWords, maxWords } = prior.lengthCorrection;
    sections.push(
      `Here is your previous attempt:\n"""${prior.body}"""\n\nThis is ${words} words. Rewrite it to between ${minWords} and ${maxWords} words, changing nothing else: keep the same facts, the same numbers, the same order and the same voice. ${words > maxWords ? "Cut the least useful clauses." : "Add one more beat from the fact sheet rather than padding a sentence you already wrote."}`,
    );
  } else if (prior !== undefined) {
    sections.push(
      `Your previous attempt violated these rules:\n${prior.violations.map((v) => `- ${v}`).join("\n")}\n\nYour previous attempt was:\n"""${prior.body}"""\n\nRewrite the whole capsule from scratch, fixing every violation above.`,
    );
  }
  return sections.join("\n\n");
}

/** Strips the small set of C0 control characters (other than tab/newline/carriage-return) a live
 *  gateway sample was observed to embed in an otherwise-valid JSON string, which breaks a strict
 *  `JSON.parse`. Applied only as a SECOND attempt, after a plain parse has already failed. */
const CONTROL_CHARACTER_PATTERN = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]", "g");

function sanitizeControlCharacters(text: string): string {
  return text.replace(CONTROL_CHARACTER_PATTERN, "");
}

function parseGatewayResponse(raw: string): { readonly content: string; readonly usage: GatewayUsage } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    try {
      parsed = JSON.parse(sanitizeControlCharacters(raw));
    } catch (error: unknown) {
      throw new CapsuleGenerationError(`Gateway response was not parseable JSON: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new CapsuleGenerationError("Gateway response was not a JSON object.", true);
  }
  const body = parsed as Record<string, unknown>;
  const choices = body.choices;
  const firstChoice = Array.isArray(choices) ? (choices[0] as Record<string, unknown> | undefined) : undefined;
  const message = firstChoice?.message as Record<string, unknown> | undefined;
  const content = typeof message?.content === "string" ? message.content : "";

  const usageRaw = body.usage as Record<string, unknown> | undefined;
  const usage: GatewayUsage = {
    promptTokens: typeof usageRaw?.prompt_tokens === "number" ? usageRaw.prompt_tokens : null,
    completionTokens: typeof usageRaw?.completion_tokens === "number" ? usageRaw.completion_tokens : null,
    totalTokens: typeof usageRaw?.total_tokens === "number" ? usageRaw.total_tokens : null,
    costUsd: typeof usageRaw?.cost === "number" ? usageRaw.cost : null,
  };
  return { content, usage };
}

/**
 * `Retry-After`, in milliseconds, when the gateway sent one this reader can trust: seconds (the
 * common form) or an HTTP date. `null` for a missing, unparseable, negative or absurd header, and
 * for anything past the backoff track's own longest wait — a throttle that really needs an hour is
 * one this run should give up on and leave to the next sweep, not sleep through.
 */
function retryAfterMsOf(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  if (raw === null) return null;
  const ceiling = Math.max(...CAPSULE_CONFIG.gateway.retry.rateLimitBackoffMs);
  const seconds = Number(raw.trim());
  const ms = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(raw) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return ms > ceiling ? null : Math.round(ms);
}

/**
 * One HTTP round trip. TWO RETRY TRACKS, never confused with each other (sweep resilience, color
 * v2, Task 4): a 429 gets its OWN exponential backoff (`retry.rateLimitBackoffMs` — three retries,
 * doubling from twenty seconds), since a live sweep proved this gateway's throttle needs real
 * minutes to clear, not seconds. Every other transport failure (5xx, a network error, a timeout, an
 * unparseable body, an empty completion) keeps the ORIGINAL one-retry budget
 * (`retry.maxAttempts`/`baseDelayMs`) — ordinary transient weather, not a known throttle, so it
 * still fails fast rather than holding a sweep run hostage. A plain refusal (401/403/400) is never
 * retried on either track: nothing about waiting would change the gateway's answer.
 *
 * ONE SHARED ATTEMPT COUNTER drives both tracks: which budget applies is decided by what THIS
 * attempt's own failure actually was, not by a separately tracked "how many 429s have I seen"
 * count. The rare mixed case (a 500 on attempt one, a 429 on attempt two) reads the 429 backoff at
 * the SAME index as the attempt number it happened on — documented here as a deliberate
 * simplification, not an oversight: tracking two independent retry counters for a failure mode
 * this rare would be real complexity bought for a case that barely occurs in practice.
 */
export async function postChatCompletion(
  messages: readonly { readonly role: string; readonly content: string }[],
  maxTokens: number,
  deps: CapsuleWriterDeps,
  minUsableWords: number = DEGENERATE_COMPLETION_WORDS,
): Promise<{ readonly content: string; readonly usage: GatewayUsage }> {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const { baseUrl, timeoutMs, retry } = CAPSULE_CONFIG.gateway;
  // The outer loop's own ceiling is whichever track needs more attempts — today, always the
  // 429 track (three retries = four attempts) — with each branch below deciding independently,
  // from ITS OWN budget, whether this particular attempt may still retry.
  const maxAttemptsOverall = Math.max(retry.maxAttempts, retry.rateLimitBackoffMs.length + 1);
  // Usage billed by attempts whose text was DISCARDED (the degenerate-completion branch below) —
  // real spend either way, folded into the winning attempt's usage or carried out on the error.
  let billedUsage: GatewayUsage | null = null;

  for (let attempt = 1; attempt <= maxAttemptsOverall; attempt += 1) {
    await waitForGatewaySlot(spacingFor(deps));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const startedAt = Date.now();
      const response = await doFetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${deps.apiKey}` },
        body: JSON.stringify({ model: deps.model ?? CAPSULE_MODEL, messages, max_tokens: maxTokens, ...(deps.thinking === false ? THINKING_DISABLED : {}) }),
        signal: controller.signal,
      });
      deps.onCallLatency?.(Date.now() - startedAt);
      clearTimeout(timer);

      if (response.status === 429) {
        const backoffMs = attempt <= retry.rateLimitBackoffMs.length ? retry.rateLimitBackoffMs[attempt - 1] : undefined;
        if (backoffMs !== undefined) {
          // THE GATEWAY'S OWN NUMBER WINS (acceptance round, task 10). A `Retry-After` header is
          // the only statement anyone has about how long this throttle actually lasts, so waiting
          // our own guess instead of its answer either wastes a minute or walks straight back into
          // the limit. Capped at the backoff track's own longest step, so a header of an hour
          // cannot hold a sweep's whole tick hostage.
          await new Promise((resolve) => setTimeout(resolve, retryAfterMsOf(response) ?? backoffMs));
          continue;
        }
        throw new CapsuleGenerationError(`Gateway returned HTTP 429 after ${retry.rateLimitBackoffMs.length} backoff retries.`, true, billedUsage);
      }
      if (response.status >= 500) {
        if (attempt < retry.maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, retry.baseDelayMs * attempt));
          continue;
        }
        throw new CapsuleGenerationError(`Gateway returned HTTP ${response.status} after its retry.`, true, billedUsage);
      }
      if (!response.ok) {
        throw new CapsuleGenerationError(`Gateway refused the request: HTTP ${response.status}.`, false);
      }

      const raw = await response.text();
      const { content, usage } = parseGatewayResponse(raw);
      if (content.trim().split(/\s+/).filter(Boolean).length < minUsableWords) {
        // A REASONING model can spend its whole completion budget thinking and return empty
        // OR NEAR-EMPTY prose while still billing (live-fire 2026-09-05: a one-word "full"
        // completion slipped past the exact-empty check and read as a validation failure).
        // Anything under `minUsableWords` cannot be the artifact that was asked for, so it is
        // transport weather, retried, never returned for the validator to mistake for prose. The
        // gateway billed it all the same — that usage rides along, never dropped.
        billedUsage = addGatewayUsage(billedUsage, usage);
        if (attempt < retry.maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, retry.baseDelayMs * attempt));
          continue;
        }
        throw new CapsuleGenerationError("Gateway returned an empty completion after its retry.", true, billedUsage);
      }
      return { content, usage: addGatewayUsage(billedUsage, usage) };
    } catch (error: unknown) {
      clearTimeout(timer);
      if (error instanceof CapsuleGenerationError) throw error;
      // A network error or an aborted (timed-out) fetch: the same transient weather a 5xx is.
      if (attempt < retry.maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, retry.baseDelayMs * attempt));
        continue;
      }
      throw new CapsuleGenerationError(`Gateway request failed after its retry: ${error instanceof Error ? error.message : String(error)}`, true, billedUsage);
    }
  }
  // Unreachable: the loop above always either returns or throws before exhausting its attempts.
  throw new CapsuleGenerationError("Gateway request failed.", true);
}

/** One capsule-writing attempt at one size. Throws `CapsuleGenerationError` on any failure,
 *  `generate.ts` is the only caller, and it is the one place that decides what happens next
 *  (retry once with the violations quoted, then the template). */
export async function generateCapsuleBody(facts: PlayerFacts, size: CapsuleSize, deps: CapsuleWriterDeps, prior?: PriorAttempt): Promise<GeneratedCapsuleBody> {
  const messages = [
    { role: "system", content: VOICE_RULES },
    { role: "user", content: userMessageFor(facts, size, prior) },
  ];
  const { content, usage } = await postChatCompletion(messages, CAPSULE_CONFIG.sizes[size].maxTokens, deps);
  return { text: content.trim(), usage };
}
