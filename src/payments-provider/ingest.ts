import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { envOr } from "@research/lib/env";
import { PAYMENTS_PROVIDER_CONFIG } from "./config";
import type { TransferRef } from "./contract";

/**
 * The ONE ingestion point: every provider callback (webhook delivery, the mock's queued
 * callbacks — same shape) enters the product here and nowhere else. It verifies the HMAC
 * signature over the RAW body, parses the untrusted payload hard (Zod, strict), and answers a
 * typed `PaymentsEvent` — so Task 5/6's money postings consume OUR vocabulary and never read
 * provider-shaped JSON. One translator, the stats worker's shape: when a real rail's payload
 * looks nothing like the mock's, ITS adapter grows a translation to this same event union and
 * nothing downstream moves.
 *
 * Server-only on arrival: `node:crypto` lives here, which is one of the reasons
 * `@/payments-provider` sits on the banned value-import list (`eslint.config.mjs`).
 */

/**
 * The closed set of internal money events an external callback can become. Deposits have no
 * `deposit_failed` member on purpose: a deposit that the provider declines fails AT INITIATION
 * (a typed `failed` `TransferIntent`, no callback needed), and a deposit that goes bad AFTER
 * completing comes back as `deposit_returned` — the R01/R10 class this seam exists to model.
 * Withdrawals can fail asynchronously (the credit leg bounces before settling), so they carry
 * all three fates.
 */
export const PAYMENTS_EVENT_TYPES = [
  "deposit_completed",
  "deposit_returned",
  "withdrawal_completed",
  "withdrawal_returned",
  "withdrawal_failed",
] as const;
export type PaymentsEventType = (typeof PAYMENTS_EVENT_TYPES)[number];

/** What the translator hands downstream: our words, the provider's ref, integer cents. */
export interface PaymentsEvent {
  readonly type: PaymentsEventType;
  readonly ref: TransferRef;
  readonly amountCents: number;
}

/**
 * A callback exactly as the wire delivered it: the raw body (the signature covers these exact
 * bytes — parse NOTHING before verifying) and the value of the
 * `PAYMENTS_PROVIDER_CONFIG.webhookSignatureHeader` header, if the caller presented one.
 */
export interface RawProviderCallback {
  readonly body: string;
  readonly signature: string | undefined;
}

/**
 * The closed set of reasons this boundary refuses a callback, one sentence each — the
 * `MONEY_REFUSALS` discipline (`src/money/config.ts`): the reason a test checks and the reason
 * a refusal actually carries can never drift apart. Operator-facing (webhook route logs and
 * responses), never player copy.
 */
export const INGEST_REFUSALS = {
  /** No signature header at all. Distinct from a wrong one: it usually means misconfiguration. */
  missingSignature: "Callback refused. No signature header was presented.",
  /** A signature that does not verify against the raw body under the shared secret. */
  invalidSignature: "Callback refused. The signature does not match the payload.",
  /** Verified, but the body is not one well-formed payments event. */
  malformedPayload: "Callback refused. The payload is not a well-formed payments event.",
} as const;
export type IngestRefusalReason = (typeof INGEST_REFUSALS)[keyof typeof INGEST_REFUSALS];

export type IngestOutcome =
  | { readonly ok: true; readonly event: PaymentsEvent }
  | { readonly ok: false; readonly reason: IngestRefusalReason };

/**
 * `z.strictObject`, not `z.object`: a payload carrying keys this boundary does not fully
 * understand is refused whole, the validate-hard rule for untrusted input. `.lte` on the
 * amount is the same safe-integer ceiling `MONEY_REFUSALS.amountOverflow` enforces on the
 * ledger side — a callback may not smuggle in an amount the ledger could not represent.
 */
const callbackPayloadSchema = z.strictObject({
  type: z.enum(PAYMENTS_EVENT_TYPES),
  ref: z.string().min(1),
  amountCents: z.number().int().positive().lte(Number.MAX_SAFE_INTEGER),
});

/**
 * Read per call, never cached at module load: `.env.local` is loaded by the runtime before
 * routes execute, but tests legitimately vary it, and a cached secret is a stale secret after
 * rotation. `envOr`, not `??`, because `.env.example` documents the var and an empty line must
 * mean unset (`src/lib/env.ts`).
 */
function webhookSecret(): string {
  return envOr(PAYMENTS_PROVIDER_CONFIG.envVars.webhookSecret, PAYMENTS_PROVIDER_CONFIG.mockWebhookSecret);
}

/**
 * Lowercase hex HMAC-SHA256 of the raw body under the shared webhook secret
 * (`PAYMENTS_WEBHOOK_SECRET`, falling back to the mock's dev constant — see
 * `PAYMENTS_PROVIDER_CONFIG.mockWebhookSecret` for why that fallback is mock-only). Exported
 * because the mock signs its queued callbacks with exactly this, so the mock's deliveries and
 * this verifier can never disagree about the algorithm.
 */
export function signProviderCallback(body: string): string {
  return createHmac("sha256", webhookSecret()).update(body).digest("hex");
}

/**
 * Constant-time comparison against the expected digest. `Buffer.from(x, "hex")` never throws —
 * it silently truncates at the first non-hex character — so the length check is not an
 * optimization: it is what makes a malformed signature a mismatch instead of a
 * `timingSafeEqual` crash on unequal lengths.
 */
function signatureVerifies(body: string, signature: string): boolean {
  const expected = createHmac("sha256", webhookSecret()).update(body).digest();
  const presented = Buffer.from(signature, "hex");
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}

/** See the module docblock: verify, then parse, then translate — refusing typed, never throwing. */
export function ingestProviderCallback(raw: RawProviderCallback): IngestOutcome {
  if (raw.signature === undefined) return { ok: false, reason: INGEST_REFUSALS.missingSignature };
  if (!signatureVerifies(raw.body, raw.signature)) return { ok: false, reason: INGEST_REFUSALS.invalidSignature };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.body);
  } catch {
    return { ok: false, reason: INGEST_REFUSALS.malformedPayload };
  }
  const payload = callbackPayloadSchema.safeParse(parsed);
  if (!payload.success) return { ok: false, reason: INGEST_REFUSALS.malformedPayload };
  return { ok: true, event: payload.data };
}
