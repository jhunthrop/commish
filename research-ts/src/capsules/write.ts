import { CAPSULE_CONFIG, CAPSULE_MODEL } from "./config";

/**
 * THE GATEWAY CLIENT — plain `fetch`, OpenAI chat-completions shape, against the Vercel AI
 * Gateway (`CAPSULE_CONFIG.gateway.baseUrl`), model `CAPSULE_MODEL`. Transport only: the prompts
 * live in `prompt.ts` and the orchestration in `generate.ts` (refrains round, 2026-09-07, when the
 * three calls a player became one). A generation FAILURE here (empty completion, an unparseable
 * body, a 429/5xx that survives the one retry, a network error) is a thrown
 * `CapsuleGenerationError` — the caller is the one place that decides what a failure means; this
 * module never falls back on its own.
 */
export class CapsuleGenerationError extends Error {
  override readonly name = "CapsuleGenerationError";
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

export interface GatewayResponseInfo {
  readonly status: number;
  readonly statusText: string;
  /** Only the headers that talk about limits, by name — `ratelimit`, `retry` or `limit`. */
  readonly limitHeaders: Readonly<Record<string, string>>;
  /** The body, for a 429 only: whose limit it was is usually stated there and nowhere else. */
  readonly body?: string;
}

export interface GatewayUsage {
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly totalTokens: number | null;
  /** The gateway's own `usage.cost` field, in dollars, when present — logged per generation by
   *  the sweep job's own step outcome; `null` when the gateway did not report one. */
  readonly costUsd: number | null;
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
   * EVERY RESPONSE'S OWN RATE-LIMIT STORY (founder, 2026-09-07: "which limit are we throttling
   * on?"). Called with the status, the status text, any header whose name mentions a rate limit or
   * a retry, and the body of a 429. A diagnostic seam: the acceptance script sets it, production
   * does not, and nothing here decides anything from what it reports.
   */
  readonly onGatewayResponse?: (info: GatewayResponseInfo) => void;
  /**
   * Whether the model may think before it writes. Defaults to `CAPSULE_CONFIG.gateway.thinking`,
   * which the task 11 measurement set to `false` — see that constant for the numbers. Sent as the
   * two shapes the Zhipu GLM family accepts through an OpenAI-compatible gateway, both at once,
   * because the gateway documents neither and an ignored extra field is harmless where a missing
   * one is the whole experiment.
   */
  readonly thinking?: boolean;
}

/**
 * ONE GATEWAY, ONE PACE (acceptance round, task 10).
 *
 * THE MEASUREMENT: a live run threw 16 throttles in 100 players, and a second run spent three and
 * a half MINUTES a player, almost all of it in 429 backoff. The per-player pause was never the
 * shape of the problem: a player's calls fired concurrently, so the gateway saw a burst, a pause,
 * a burst. A per-minute limit does not care about the average, it cares about the burst. (A player
 * is one call now, with a correction call only for a part that failed, but the pace still belongs
 * here: it is the gateway's limit, not any caller's.)
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

/** Any header whose NAME talks about a rate limit or a retry. The gateway documents none of them,
 *  so this reads what it actually sends rather than a list of expected names. */
function limitHeadersOf(response: Response): Readonly<Record<string, string>> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    if (/ratelimit|retry|limit/i.test(name)) headers[name] = value;
  });
  return headers;
}

/**
 * Hands one response to the diagnostic hook, if a caller set one. Extracted from
 * `postChatCompletion` (fix round) so the transport function keeps its own shape: the retry tracks
 * are the thing that is hard to read there, and a header-gathering block in the middle of them was
 * making it harder.
 *
 * A 429's BODY comes through `clone()`: the branch below this call reads the response too, and
 * consuming the stream here would leave it nothing.
 */
async function reportGatewayResponse(response: Response, deps: CapsuleWriterDeps): Promise<void> {
  if (deps.onGatewayResponse === undefined) return;
  deps.onGatewayResponse({
    status: response.status,
    statusText: response.statusText,
    limitHeaders: limitHeadersOf(response),
    ...(response.status === 429 ? { body: await response.clone().text() } : {}),
  });
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
        body: JSON.stringify({ model: deps.model ?? CAPSULE_MODEL, messages, max_tokens: maxTokens, ...((deps.thinking ?? CAPSULE_CONFIG.gateway.thinking) === false ? THINKING_DISABLED : {}) }),
        signal: controller.signal,
      });
      deps.onCallLatency?.(Date.now() - startedAt);
      clearTimeout(timer);
      await reportGatewayResponse(response, deps);

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
