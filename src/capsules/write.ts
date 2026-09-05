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
  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
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

export interface CapsuleWriterDeps {
  readonly apiKey: string;
  readonly fetch?: typeof globalThis.fetch;
}

/** A prior attempt's own violations, quoted verbatim into the retry's user message — "fix
 *  exactly this" reads far more reliably to a model than a bare "try again". */
export interface PriorAttempt {
  readonly body: string;
  readonly violations: readonly string[];
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
  if (prior !== undefined) {
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

/** One HTTP round trip, with one retry on a 429/5xx or a transport error (timeout, network
 *  failure, unparseable body, empty completion) — never on a plain refusal (401/403/400), which
 *  a retry would only repeat. */
async function postChatCompletion(
  messages: readonly { readonly role: string; readonly content: string }[],
  maxTokens: number,
  deps: CapsuleWriterDeps,
): Promise<{ readonly content: string; readonly usage: GatewayUsage }> {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const { baseUrl, timeoutMs, retry } = CAPSULE_CONFIG.gateway;

  for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${deps.apiKey}` },
        body: JSON.stringify({ model: CAPSULE_MODEL, messages, max_tokens: maxTokens }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (response.status === 429 || response.status >= 500) {
        if (attempt < retry.maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, retry.baseDelayMs * attempt));
          continue;
        }
        throw new CapsuleGenerationError(`Gateway returned HTTP ${response.status} after its retry.`, true);
      }
      if (!response.ok) {
        throw new CapsuleGenerationError(`Gateway refused the request: HTTP ${response.status}.`, false);
      }

      const raw = await response.text();
      const { content, usage } = parseGatewayResponse(raw);
      if (content.trim() === "") {
        // A REASONING model can spend its whole completion budget thinking and return empty
        // prose while still billing. Treated as a generation failure, retried once like any
        // other transport weather, never returned as a blank capsule.
        if (attempt < retry.maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, retry.baseDelayMs * attempt));
          continue;
        }
        throw new CapsuleGenerationError("Gateway returned an empty completion after its retry.", true);
      }
      return { content, usage };
    } catch (error: unknown) {
      clearTimeout(timer);
      if (error instanceof CapsuleGenerationError) throw error;
      // A network error or an aborted (timed-out) fetch: the same transient weather a 5xx is.
      if (attempt < retry.maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, retry.baseDelayMs * attempt));
        continue;
      }
      throw new CapsuleGenerationError(`Gateway request failed after its retry: ${error instanceof Error ? error.message : String(error)}`, true);
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
