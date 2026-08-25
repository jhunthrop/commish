import { and, eq, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import type { AuditLogger } from "@/integrity-service/audit-logger";
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
  readonly clock: Clock;
  readonly audit: AuditLogger;
}

export type SubmitKycOutcome =
  | { readonly ok: true; readonly status: KycProviderStatus }
  | { readonly ok: false; readonly status: 403; readonly reason: MoneyRefusalReason };

/**
 * Looks up the submitted state's `minAge` from `deps.states.enabled` (empty in production until
 * the founder names a state — decision 7), submits to the provider, writes back whatever it
 * currently says, inside a `db.transaction`.
 *
 * `"verified"` IS the age attestation this platform holds (the seam's own module docblock): the
 * provider is handed `minAge` and is the one place a date of birth is ever checked against it.
 *
 * FIX ROUND (Task 7 review HIGH). The `users` UPDATE carries TWO guards in its `WHERE`, both load-
 * bearing:
 *
 *  1. `ne(kycStatus, "verified")` — ONE-WAY TOWARD VERIFIED, never a regression once there
 *     (`users.kyc_status`'s own docblock, `src/db/schema.ts`). The bug this fixes: a member can
 *     become `verified` by ANY submission that resolves that way while ANOTHER, earlier submission
 *     from the same member is still awaiting its own (slower) provider round trip. Without this
 *     guard, that earlier submission's write lands LAST and downgrades a already-verified member
 *     back to `pending` or `failed` — a stale async writer overwriting a true fact with a stale
 *     one. The guard makes `verified` an absorbing state at the database level, not just by
 *     application-code ordering, which is the only version of this promise that survives two
 *     requests actually racing.
 *  2. `ne(kycStatus, status)` — audits only a GENUINE change. A resubmission that lands on the
 *     SAME status the row already carries (an identical retry, a provider echoing its own prior
 *     answer) writes nothing and appends no `kyc_status_changed` event; the guard is one atomic
 *     statement, so "did anything change" and "is it safe to write" are answered together, with no
 *     read-then-write gap between them for a concurrent writer to land in.
 *
 * Deliberately NO early short-circuit for an already-verified caller (an earlier version of this
 * function had one): with an early check, a second call from an already-verified member never
 * reaches this guard at all, and the regression-prevention promise above rests entirely on the
 * early check instead — exactly the version of "prevented" that a genuine race defeats, because
 * the early check and this write are two separate round trips with a gap between them a concurrent
 * writer can land in. Every call reaches the SAME guarded write, so the guard is what protects the
 * fact, not an optimization that happens to make the common case look protected. The cost is one
 * avoidable provider call for an already-verified member re-submitting — not a money-safety
 * concern, and a small price for a promise that is actually true under concurrency.
 */
export async function submitKycVerification(db: Db, input: KycSubmissionRequest, deps: SubmitKycDeps): Promise<SubmitKycOutcome> {
  const entry = deps.states.enabled.find((candidate) => candidate.state === input.stateOfEntry);
  if (entry === undefined) return { ok: false, status: 403, reason: MONEY_REFUSALS.stateNotEnabled };

  const ref = await deps.provider.submitVerification({
    userId: input.userId,
    legalName: input.legalName,
    dateOfBirth: input.dateOfBirth,
    minAge: entry.minAge,
    idempotencyKey: `kyc:${input.userId}:${input.idempotencyKey}`,
  });
  const status = await deps.provider.getStatus(ref);

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(users)
      .set({ kycStatus: status })
      .where(and(eq(users.id, input.userId), ne(users.kycStatus, "verified"), ne(users.kycStatus, status)))
      .returning({ kycStatus: users.kycStatus });

    if (updated !== undefined) {
      await deps.audit.record(tx, {
        eventType: "kyc_status_changed",
        actorId: input.userId,
        actorType: "user",
        leagueId: null,
        payload: { status },
        occurredAt: deps.clock.now(),
      });
      return { ok: true, status };
    }

    // The guard above matched zero rows: either this user does not exist, they are already
    // `verified` (guard 1), or the write would have been a no-op (guard 2). Reading the row back
    // rather than assuming which, so the answer always matches what is actually stored.
    const [current] = await tx.select({ kycStatus: users.kycStatus }).from(users).where(eq(users.id, input.userId));
    if (current === undefined) throw new Error(`submitKycVerification: no user row for "${input.userId}".`);
    // Provably never "none" here: this branch is reached only because the guarded write above
    // found the row already `"verified"` (guard 1) or already equal to `status` (guard 2), and
    // `status` — the provider's own vocabulary, `KycProviderStatus` — never carries `"none"`.
    // Nothing in this codebase ever writes `kyc_status` back to `"none"` once it has left that
    // default, so both paths into this branch read a real `KycProviderStatus` value.
    return { ok: true, status: current.kycStatus as KycProviderStatus };
  });
}
