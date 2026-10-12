import type { Clock } from "@research-ts/domain/timing";
import type { KycProvider, KycProviderStatus, KycSubmissionInput, KycSubmissionRef } from "../kyc-contract";

/**
 * The mock KYC bureau: an in-memory submission book on an injected `Clock`, moving no network
 * call and verifying no real identity — the implementation `./kyc-registry.ts` selects by
 * default, mirroring `createMockPaymentsProvider` (`./mock-payments-provider.ts`) by name.
 *
 * Every submission's outcome is decided ONCE, at `submitVerification` time, from data already in
 * hand (the fixed failing fixture, the age-of-majority check) — never re-derived later, so
 * `getStatus` only ever reports what was already decided. Two submissions settle immediately,
 * because both are facts the mock can already tell from the input: the reserved failing identity
 * (`MOCK_KYC_CONFIG.failingLegalName`, the same "magic value forces a decline" idiom the payments
 * mock's `declineAmountCents` uses) and an identity below the submitted `minAge`. Every OTHER
 * identity goes to `"pending"` — modeling a real vendor's manual-review queue for anything not on
 * the fast-fail list — and stays there until the harness calls `advance()`, the same shape
 * `MockPaymentsProvider.advance()` uses for settlement time passing.
 */
export const MOCK_KYC_CONFIG = {
  /** The one legal name the mock always fails identity verification for, the fixed test fixture
   *  the brief asks for — the same class of forced-failure sentinel the payments mock reserves a
   *  magic amount for. */
  failingLegalName: "Fail Fixture",
  /** Never surfaced through `getStatus` — the contract answers only a bare status (the module
   *  docblock's own point) — kept here for the mock's own tests to assert against internally. */
  identityFailureReason: "The identity on this submission could not be verified.",
  underageFailureReason: "The date of birth on this submission does not meet the minimum age required.",
} as const;

/** The mock's control surface, over and above the seam itself — what a harness (the contract
 *  suite's, a route test's) uses to play the outside world, the same split `MockPaymentsProvider`
 *  draws between the seam and its own extra methods. */
export interface MockKycProvider extends KycProvider {
  /** Manual-review time passes: every `"pending"` submission settles to `"verified"` — safe
   *  unconditionally, because the two ways a submission could fail (the fixed identity, being
   *  underage) were both already checked, and refused, at submission time. */
  advance(): void;
  /** The next submission is failed with `reason`, regardless of the identity supplied, then the
   *  tap closes — the injectable-failure control the brief asks for. */
  failNextSubmission(reason: string): void;
}

interface SubmissionRecord {
  readonly ref: KycSubmissionRef;
  readonly userId: string;
  readonly legalName: string;
  readonly dateOfBirth: string;
  readonly minAge: number;
  readonly idempotencyKey: string;
  readonly status: KycProviderStatus;
}

/** Whole years old as of `asOfIso`, accounting for whether this year's birthday has passed —
 *  a same-day birthday counts as having turned the age (`>=`, not `>`). */
function ageInYears(dateOfBirth: string, asOfIso: string): number {
  const dob = new Date(`${dateOfBirth}T00:00:00.000Z`);
  const asOf = new Date(asOfIso);
  let age = asOf.getUTCFullYear() - dob.getUTCFullYear();
  const hadBirthdayThisYear =
    asOf.getUTCMonth() > dob.getUTCMonth() || (asOf.getUTCMonth() === dob.getUTCMonth() && asOf.getUTCDate() >= dob.getUTCDate());
  if (!hadBirthdayThisYear) age -= 1;
  return age;
}

export function createMockKycProvider(clock: Clock): MockKycProvider {
  const submissions = new Map<KycSubmissionRef, SubmissionRecord>();
  const refByIdempotencyKey = new Map<string, KycSubmissionRef>();
  let injectedFailureReason: string | undefined;
  let nextRefSequence = 1;

  function requireSubmission(ref: KycSubmissionRef): SubmissionRecord {
    const record = submissions.get(ref);
    if (record === undefined) {
      throw new Error(`Unknown KYC submission ref "${ref}". The mock never issued it.`);
    }
    return record;
  }

  return {
    async submitVerification(input: KycSubmissionInput) {
      const existingRef = refByIdempotencyKey.get(input.idempotencyKey);
      if (existingRef !== undefined) {
        const existing = requireSubmission(existingRef);
        if (
          existing.userId !== input.userId ||
          existing.legalName !== input.legalName ||
          existing.dateOfBirth !== input.dateOfBirth ||
          existing.minAge !== input.minAge
        ) {
          throw new Error(
            `Replayed idempotency key "${input.idempotencyKey}" disagrees with the submission it created (${existing.legalName}, min age ${existing.minAge}).`,
          );
        }
        return existing.ref;
      }

      const failureReason =
        injectedFailureReason ??
        (input.legalName === MOCK_KYC_CONFIG.failingLegalName ? MOCK_KYC_CONFIG.identityFailureReason : undefined) ??
        (ageInYears(input.dateOfBirth, clock.now()) < input.minAge ? MOCK_KYC_CONFIG.underageFailureReason : undefined);
      injectedFailureReason = undefined;

      const record: SubmissionRecord = {
        ref: `mock-kyc-${nextRefSequence++}`,
        userId: input.userId,
        legalName: input.legalName,
        dateOfBirth: input.dateOfBirth,
        minAge: input.minAge,
        idempotencyKey: input.idempotencyKey,
        status: failureReason === undefined ? "pending" : "failed",
      };
      submissions.set(record.ref, record);
      refByIdempotencyKey.set(input.idempotencyKey, record.ref);
      return record.ref;
    },

    async getStatus(ref: KycSubmissionRef) {
      return requireSubmission(ref).status;
    },

    advance() {
      for (const record of submissions.values()) {
        if (record.status !== "pending") continue;
        submissions.set(record.ref, { ...record, status: "verified" });
      }
    },

    failNextSubmission(reason: string) {
      injectedFailureReason = reason;
    },
  };
}
