import { z } from "zod";
import { MONEY_CONFIG, MONEY_REFUSALS } from "@/money/config";
import { US_STATE_CODES } from "@/money/states";
import { DEPOSIT_METHODS } from "@/payments-provider/contract";

/**
 * The money doors' request boundary, the `@/league-service/schemas` idiom: every route under
 * `/api/wallet/**` parses its body through one of these via `parseJson` before any writer runs,
 * so a malformed request is a 400 naming the field and never an exception downstream.
 *
 * `strictObject`, the validate-hard rule: a body carrying keys this boundary does not understand
 * is refused whole. Bounds read `MONEY_CONFIG.deposit` and refuse with the `MONEY_REFUSALS`
 * sentences built FROM those same numbers, so the figure a refusal states and the figure the
 * server enforces cannot drift.
 */
export const depositRequestSchema = z.strictObject({
  /** Integer cents, inside `MONEY_CONFIG.deposit`'s bounds — the same whole-cents law as the book. */
  amountCents: z
    .number()
    .int(MONEY_REFUSALS.invalidAmount)
    .min(MONEY_CONFIG.deposit.minCents, MONEY_REFUSALS.depositBelowMinimum)
    .max(MONEY_CONFIG.deposit.maxPerTransferCents, MONEY_REFUSALS.depositAboveMaximum),
  /** Self-attested at the door this phase (Task 5 Step 2); Phase 5 replaces the producer. */
  stateOfEntry: z.enum(US_STATE_CODES),
  method: z.enum(DEPOSIT_METHODS),
  /**
   * Minted by the deposit form once per submission attempt, so a double-click and a retried
   * request become the SAME transfer at the provider (Seam A's replay law). Bounded because it
   * is untrusted input that becomes part of a provider-side key.
   */
  idempotencyKey: z.string().min(1).max(128),
});

export type DepositRequest = z.infer<typeof depositRequestSchema>;
