import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import { MONEY_REFUSALS, type MoneyRefusalReason } from "@/money/config";
import type { MoneyStatesConfig, StateCode } from "@/money/states";
import type { KycProvider, KycProviderStatus } from "@/payments-provider/kyc-contract";

/**
 * The KYC submit door's writer — the ONE function that ever writes `users.kyc_status`
 * (`src/money-service/gates.ts`'s own docblock calls this "Task 7's callback path"). A future
 * asynchronous callback from a real bureau is the same call, made later; nothing about the
 * one-writer discipline changes with when it runs.
 */
export interface KycSubmissionRequest {
  readonly userId: string;
  readonly legalName: string;
  readonly dateOfBirth: string;
  /** Self-attested at the door (`kycSubmissionRequestSchema`, `./schemas.ts`) — the same producer
   *  Phase 5 replaces, the deposit and withdrawal doors' own law (Task 5 Step 2). */
  readonly stateOfEntry: StateCode;
  readonly idempotencyKey: string;
}

export interface SubmitKycDeps {
  readonly provider: KycProvider;
  readonly states: MoneyStatesConfig;
}

export type SubmitKycOutcome =
  | { readonly ok: true; readonly status: KycProviderStatus }
  | { readonly ok: false; readonly status: 403; readonly reason: MoneyRefusalReason };

/**
 * Looks up the submitted state's `minAge` from `deps.states.enabled` (empty in production until
 * the founder names a state — decision 7), submits to the provider, writes back whatever it
 * currently says.
 *
 * `"verified"` IS the age attestation this platform holds (the seam's own module docblock): the
 * provider is handed `minAge` and is the one place a date of birth is ever checked against it.
 *
 * ONE-WAY TOWARD VERIFIED, never a regression once there (`users.kyc_status`'s own docblock,
 * `src/db/schema.ts`): a member already verified is answered `"verified"` straight from the
 * current row, WITHOUT re-submitting to the provider — both an honest early exit (nothing this
 * call could learn changes an already-settled verification) and good stewardship of a vendor call
 * budget. This is a plain read-then-write, not a locked transaction: two submissions racing from
 * the SAME user is not a scenario this product's own UI can produce (one form, one submit button),
 * and the worst a genuine race could do is have a stale `"pending"`/`"failed"` write land after a
 * concurrent `"verified"` one — recoverable by resubmitting, never a money-safety issue, so it
 * does not carry the row-lock discipline `postMoneyTransaction` holds its callers to.
 */
export async function submitKycVerification(db: Db, input: KycSubmissionRequest, deps: SubmitKycDeps): Promise<SubmitKycOutcome> {
  const entry = deps.states.enabled.find((candidate) => candidate.state === input.stateOfEntry);
  if (entry === undefined) return { ok: false, status: 403, reason: MONEY_REFUSALS.stateNotEnabled };

  const [before] = await db.select({ kycStatus: users.kycStatus }).from(users).where(eq(users.id, input.userId));
  if (before === undefined) throw new Error(`submitKycVerification: no user row for "${input.userId}".`);
  if (before.kycStatus === "verified") return { ok: true, status: "verified" };

  const ref = await deps.provider.submitVerification({
    userId: input.userId,
    legalName: input.legalName,
    dateOfBirth: input.dateOfBirth,
    minAge: entry.minAge,
    idempotencyKey: `kyc:${input.userId}:${input.idempotencyKey}`,
  });
  const status = await deps.provider.getStatus(ref);

  await db.update(users).set({ kycStatus: status }).where(eq(users.id, input.userId));
  return { ok: true, status };
}
