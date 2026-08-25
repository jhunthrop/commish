/**
 * Seam A's sibling, ruling 4: `KycProvider` is its own interface, inside this same directory,
 * never folded into `PaymentsProvider` (`./contract.ts`). The KYC bureau (Persona/Alloy-class)
 * and the money rail (Aeropay/Column-class) are different vendors on different timelines, and
 * folding identity verification into `PaymentsProvider` would force every rails implementation
 * to pretend it is a KYC bureau too. Same directory because both are the "external compliance
 * vendor behind a registry" pattern — a third top-level seam directory would gate and
 * boundary-list a one-interface module for no benefit `./kyc-registry.ts`'s machinery doesn't
 * already give it.
 *
 * NARROW ON PURPOSE, the same discipline `PaymentsProvider` holds to: two calls, submit and poll.
 * Everything about WHO qualifies to hold a balance — identity, document quality, watchlist
 * screening — is the vendor's decision; this product never re-derives it from data it does not
 * store.
 *
 * AGE LIVES HERE (Task 5's carried ruling, `src/money-service/gates.ts`'s own docblock): this
 * product deliberately stores no date of birth, so `kyc_status === "verified"` is the only age
 * attestation the platform ever holds. `MONEY_STATES`'s enabled entries carry the `minAge` a
 * state requires (`src/money/states.ts`); the caller reads that number and hands it to
 * `submitVerification` as `minAge`, and the PROVIDER — the one place that ever sees a date of
 * birth — is what attests the submitted identity clears it. A gate-side age check would have
 * nothing of its own to read; this is where the answer is actually decided.
 */

/**
 * What the vendor currently says about ONE submission. Provider-agnostic, and deliberately a
 * different, smaller vocabulary than `users.kyc_status` (`src/db/schema.ts`'s `KYC_STATUSES`,
 * four values including `"none"` — the platform's own resting state before anyone has ever
 * submitted anything). This vocabulary has no `"none"`: a caller only ever asks a provider about a
 * submission that exists.
 */
export const KYC_PROVIDER_STATUSES = ["pending", "verified", "failed"] as const;
export type KycProviderStatus = (typeof KYC_PROVIDER_STATUSES)[number];

/** The provider's own reference for one submission. Opaque, the same law `TransferRef` follows —
 *  this product stores it, keys `getStatus` calls by it, and never parses or fabricates one. */
export type KycSubmissionRef = string;

export interface KycSubmissionInput {
  /** This product's user id, for the provider to bind the submission to. */
  readonly userId: string;
  /** The name on the identity document being verified. */
  readonly legalName: string;
  /** ISO 8601 calendar date, `YYYY-MM-DD`. The one place in this product a date of birth exists
   *  even transiently — it crosses this seam and is never stored on this product's own side. */
  readonly dateOfBirth: string;
  /** The age of majority the submitted state requires — `MONEY_STATES.enabled`'s `minAge` for the
   *  state this submission attests residency in, read by the caller and handed down here. See the
   *  module docblock: the provider is where this number is actually checked against a birth date. */
  readonly minAge: number;
  /**
   * Required, never optional — the same replay law `DepositInput.idempotencyKey` states: a
   * double-submitted form and a retried request must become the SAME submission. The provider
   * answers a replayed key with the original submission's own reference, never a second one.
   */
  readonly idempotencyKey: string;
}

/**
 * The seam itself. Two calls: submit, which answers only a reference (never a status alongside
 * it — a real vendor's verification is not instant, and this shape refuses to pretend otherwise),
 * and poll, which answers the vendor's current word on that reference. `"pending"` is a real,
 * steady, user-visible state under this contract, not a transient one a caller waits out
 * synchronously — the account room's KYC panel renders it as one of its four statuses
 * (`src/db/schema.ts`'s `KYC_STATUSES`, Task 12) precisely because a submission can sit there
 * for real review time before anything resolves it further.
 */
export interface KycProvider {
  submitVerification(input: KycSubmissionInput): Promise<KycSubmissionRef>;
  getStatus(ref: KycSubmissionRef): Promise<KycProviderStatus>;
}
