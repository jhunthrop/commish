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
 * Lowercase hex HMAC-SHA256 of the raw body under the shared webhook secret
 * (`PAYMENTS_WEBHOOK_SECRET`, falling back to the mock's dev constant — see
 * `PAYMENTS_PROVIDER_CONFIG.mockWebhookSecret` for why that fallback is mock-only). Exported
 * because the mock signs its queued callbacks with exactly this, so the mock's deliveries and
 * this verifier can never disagree about the algorithm.
 */
export function signProviderCallback(body: string): string {
  throw new Error(`Task 4 Step 5 implements signProviderCallback. (${body.length})`);
}

/** See the module docblock: verify, then parse, then translate — refusing typed, never throwing. */
export function ingestProviderCallback(raw: RawProviderCallback): IngestOutcome {
  throw new Error(`Task 4 Step 5 implements ingestProviderCallback. (${raw.body.length})`);
}

/** Referenced so the red stub compiles with `PAYMENTS_PROVIDER_CONFIG` imported for Step 5. */
export const WEBHOOK_SIGNATURE_HEADER = PAYMENTS_PROVIDER_CONFIG.webhookSignatureHeader;
