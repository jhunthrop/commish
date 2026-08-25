import { describe, expect, it } from "vitest";
import { KYC_PROVIDER_STATUSES } from "./kyc-contract";
import type { KycProvider, KycSubmissionRef } from "./kyc-contract";

/**
 * What a `KycProvider` implementation must give the suite so it can be driven through the
 * transitions the contract is really about — manual-review time passing, a bad identity, an
 * underage one — mirroring `PaymentsProviderHarness` (`./contract-suite.ts`) by name. The suite
 * only ever talks to `provider` through the `KycProvider` interface; the harness supplies the
 * OUTSIDE forces (review time elapsing) no product code can invoke.
 */
export interface KycProviderHarness {
  readonly provider: KycProvider;
  readonly userId: string;
  /** Submit an identity that will verify: settle it all the way to `"verified"`, return its ref. */
  verifying(minAge: number): Promise<KycSubmissionRef>;
  /** Submit an identity that meets `minAge`, WITHOUT settling it — still `"pending"`. */
  awaitingReview(minAge: number): Promise<KycSubmissionRef>;
  /** Submit the implementation's own fixed failing identity; the ref is already `"failed"`. */
  failingIdentity(minAge: number): Promise<KycSubmissionRef>;
  /** Submit an identity younger than `minAge`; the ref is already `"failed"`. */
  underage(minAge: number): Promise<KycSubmissionRef>;
  /** Let every pending submission resolve. */
  advance(): Promise<void>;
}

/**
 * The contract EVERY `KycProvider` implementation must satisfy, mock included — written against
 * the interface, never an implementation's internals, so a future real bureau (Persona/Alloy
 * class) is verified by this same suite unchanged, the `PaymentsProvider` contract suite's own
 * argument (`./contract-suite.ts`'s docblock) applied to this seam. `make` must answer a FRESH,
 * isolated harness per call.
 */
export function runKycProviderContractSuite(name: string, make: () => KycProviderHarness | Promise<KycProviderHarness>): void {
  describe(`KycProvider contract: ${name}`, () => {
    it("answers a non-empty reference for a submission", async () => {
      const h = await make();
      const ref = await h.awaitingReview(18);
      expect(ref).toMatch(/\S/);
    });

    it("closes the status vocabulary to pending, verified and failed", async () => {
      const h = await make();
      const ref = await h.awaitingReview(18);
      expect(KYC_PROVIDER_STATUSES).toContain(await h.provider.getStatus(ref));
    });

    it("moves a submission pending -> verified only once the harness advances it", async () => {
      const h = await make();
      const ref = await h.awaitingReview(18);
      await expect(h.provider.getStatus(ref)).resolves.toBe("pending");
      await h.advance();
      await expect(h.provider.getStatus(ref)).resolves.toBe("verified");
    });

    it("verified is terminal: advancing again changes nothing", async () => {
      const h = await make();
      const ref = await h.verifying(18);
      await h.advance();
      await expect(h.provider.getStatus(ref)).resolves.toBe("verified");
    });

    it("fails the fixed failing identity immediately, with no review wait", async () => {
      const h = await make();
      const ref = await h.failingIdentity(18);
      await expect(h.provider.getStatus(ref)).resolves.toBe("failed");
      // failed is terminal: no amount of advancing revives it.
      await h.advance();
      await expect(h.provider.getStatus(ref)).resolves.toBe("failed");
    });

    it("fails an identity below the state's minimum age, immediately", async () => {
      const h = await make();
      const ref = await h.underage(21);
      await expect(h.provider.getStatus(ref)).resolves.toBe("failed");
    });

    it("replays an idempotency key onto the same submission rather than creating a second one", async () => {
      const h = await make();
      const input = {
        userId: h.userId,
        legalName: "Replay Person",
        dateOfBirth: "1990-01-01",
        minAge: 18,
        idempotencyKey: "contract-kyc-replay",
      };
      const first = await h.provider.submitVerification(input);
      const second = await h.provider.submitVerification(input);
      expect(second).toBe(first);
    });

    it("rejects a replayed idempotency key that disagrees with the submission it created", async () => {
      const h = await make();
      const input = {
        userId: h.userId,
        legalName: "Disagree Person",
        dateOfBirth: "1990-01-01",
        minAge: 18,
        idempotencyKey: "contract-kyc-disagree",
      };
      await h.provider.submitVerification(input);
      await expect(h.provider.submitVerification({ ...input, legalName: "Someone Else" })).rejects.toThrow();
      await expect(h.provider.submitVerification({ ...input, dateOfBirth: "1985-01-01" })).rejects.toThrow();
      await expect(h.provider.submitVerification({ ...input, minAge: 21 })).rejects.toThrow();
    });

    it("rejects a status query for a reference it never issued, rather than inventing an answer", async () => {
      const h = await make();
      await expect(h.provider.getStatus("kyc-ref-never-issued")).rejects.toThrow();
    });

    /**
     * MEDIUM (Task 7 review): a terminal failure must not poison the member's NEXT attempt. A
     * failed submission and a resubmission with a FRESH idempotency key are two DIFFERENT
     * submissions under this contract — the failed one's own ref stays `"failed"` forever (proven
     * above), and the fresh one is a genuinely new, independently-resolvable submission, never a
     * collision with it. An implementation that let a prior failure taint a fresh key — refusing
     * the retry, or answering the OLD ref's status for the NEW key — would trap a member who typed
     * their name wrong once behind a dead end, exactly what the copy rulebook's "never a dead end"
     * rule forbids at the product layer; this is the seam-level guarantee that rule depends on.
     */
    it("lets a member resubmit with a fresh key after a terminal failure, as a genuinely new submission", async () => {
      const h = await make();
      const failed = await h.failingIdentity(18);
      await expect(h.provider.getStatus(failed)).resolves.toBe("failed");

      const retry = await h.provider.submitVerification({
        userId: h.userId,
        legalName: "Retry Person",
        dateOfBirth: "1990-01-01",
        minAge: 18,
        idempotencyKey: "contract-kyc-retry-fresh-key",
      });
      expect(retry).not.toBe(failed);
      await expect(h.provider.getStatus(retry)).resolves.toBe("pending");
      await h.advance();
      await expect(h.provider.getStatus(retry)).resolves.toBe("verified");
      // The original failure is untouched by the retry settling — two independent submissions.
      await expect(h.provider.getStatus(failed)).resolves.toBe("failed");
    });
  });
}
