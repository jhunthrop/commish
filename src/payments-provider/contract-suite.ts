import { describe, expect, it } from "vitest";
import { DEPOSIT_METHODS, TRANSFER_STATUSES } from "./contract";
import type { PaymentsProvider, TransferIntent, TransferRef } from "./contract";

/**
 * What a `PaymentsProvider` implementation must give the suite so it can be driven through the
 * transitions the contract is really about — time passing and money coming back. The suite
 * itself only ever talks to `provider` through the `PaymentsProvider` interface; the harness is
 * how each implementation supplies the OUTSIDE forces (settlement time elapsing, a bank issuing
 * a return) that no product code can invoke. The mock's harness moves a fake clock and calls
 * its own control methods; a real rail's harness drives that provider's sandbox controls.
 */
export interface PaymentsProviderHarness {
  readonly provider: PaymentsProvider;
  /** A user the harness has fully prepared: `ensureAccount` already called and settled. */
  readonly userId: string;
  /** Initiate a bank deposit that will succeed, drive it all the way to `completed`, return its ref. */
  depositCompleting(amountCents: number): Promise<TransferRef>;
  /** Initiate a bank deposit the provider will DECLINE, and answer the intent exactly as the provider did. */
  depositDeclining(amountCents: number): Promise<TransferIntent>;
  /** Initiate a withdrawal that will succeed, drive it all the way to `completed`, return its ref. */
  withdrawalCompleting(amountCents: number): Promise<TransferRef>;
  /** Let `days` days of provider time pass, settling whatever that much time settles. */
  advanceDays(days: number): Promise<void>;
  /** Make the bank RETURN a transfer that already completed — the R01/R10 event, from outside. */
  triggerReturn(ref: TransferRef): Promise<void>;
}

/**
 * The contract EVERY `PaymentsProvider` implementation must satisfy, mock included — written
 * against the interface and never against an implementation's internals, so the future
 * Column/Aeropay/Paysafe adapter is verified by this same suite unchanged rather than by a
 * second suite that agrees with it by coincidence (`src/stats/test-support.ts` precedent).
 * An implementation that cannot pass this suite cannot be named in the registry; that is the
 * whole arrangement.
 *
 * `make` must answer a FRESH, isolated harness per call: several cases reason about pooled
 * balance deltas from a baseline this suite reads, never assumes.
 */
export function runPaymentsProviderContractSuite(name: string, make: () => PaymentsProviderHarness | Promise<PaymentsProviderHarness>): void {
  describe(`PaymentsProvider contract: ${name}`, () => {
    it("answers the same account reference for the same user, creating nothing twice", async () => {
      const h = await make();
      const first = await h.provider.ensureAccount(h.userId);
      const second = await h.provider.ensureAccount(h.userId);
      expect(first).toMatch(/\S/);
      expect(second).toBe(first);
    });

    it("supports the bank method, and reports fee and ETA for every method, so the UI never invents either", async () => {
      const h = await make();
      const methods = h.provider.listSupportedMethods();
      expect(methods.length).toBeGreaterThan(0);
      // Pay-by-bank is the launch rail (founder decision 3); card is founder-gated. An
      // implementation without `bank` cannot serve the product at all.
      expect(methods.map((m) => m.method)).toContain("bank");
      const names = methods.map((m) => m.method);
      expect(new Set(names).size).toBe(names.length);
      for (const m of methods) {
        // The method vocabulary is closed: an implementation may support fewer rails than the
        // contract names, never invent one the product has no words for.
        expect(DEPOSIT_METHODS).toContain(m.method);
        expect(Number.isInteger(m.feeCents)).toBe(true);
        expect(m.feeCents).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(m.feePercentBasisPoints)).toBe(true);
        expect(m.feePercentBasisPoints).toBeGreaterThanOrEqual(0);
        expect(m.etaDescription).toMatch(/\S/);
      }
    });

    it("moves a deposit pending -> completed with the exact requested amount", async () => {
      const h = await make();
      const intent = await h.provider.initiateDeposit({
        userId: h.userId,
        amountCents: 25_00,
        method: "bank",
        idempotencyKey: "contract-deposit-lifecycle",
      });
      expect(intent.direction).toBe("deposit");
      expect(intent.amountCents).toBe(25_00);
      // The status vocabulary is closed too — asserted once before the specific expectations,
      // so an implementation leaking its upstream's spelling fails HERE, not downstream.
      expect(TRANSFER_STATUSES).toContain(intent.status);
      expect(intent.status).toBe("pending");
      expect(intent.initiatedAt).toMatch(/\S/);
      await expect(h.provider.getTransferStatus(intent.ref)).resolves.toBe("pending");
      await h.advanceDays(4);
      await expect(h.provider.getTransferStatus(intent.ref)).resolves.toBe("completed");
    });

    it("replays an idempotency key without creating a second transfer", async () => {
      const h = await make();
      const baseline = await h.provider.getPooledBalanceCents();
      const input = {
        userId: h.userId,
        amountCents: 40_00,
        method: "bank",
        idempotencyKey: "contract-replayed-key",
      } as const;
      const first = await h.provider.initiateDeposit(input);
      await h.advanceDays(4);
      // The double-click and the webhook redelivery are the same non-event: the replay answers
      // the SAME transfer (same ref, at its current status), and only one transfer's worth of
      // money ever reaches the pool.
      const replay = await h.provider.initiateDeposit(input);
      expect(replay.ref).toBe(first.ref);
      expect(replay.amountCents).toBe(40_00);
      expect(replay.status).toBe("completed");
      await expect(h.provider.getPooledBalanceCents()).resolves.toBe(baseline + 40_00);
    });

    it("surfaces a decline as a typed failed status, never a thrown string", async () => {
      const h = await make();
      const intent = await h.depositDeclining(15_00);
      expect(intent.status).toBe("failed");
      expect(intent.failureReason).toMatch(/\S/);
      await expect(h.provider.getTransferStatus(intent.ref)).resolves.toBe("failed");
      // failed is terminal: no amount of settlement time revives a declined transfer.
      await h.advanceDays(4);
      await expect(h.provider.getTransferStatus(intent.ref)).resolves.toBe("failed");
    });

    it("models a deposit that COMPLETES and then RETURNS days later, emitting a returned status for the same ref", async () => {
      // The R01/R10 class. Any implementation that cannot represent this cannot be wired in.
      const h = await make();
      const ref = await h.depositCompleting(10_00);
      await expect(h.provider.getTransferStatus(ref)).resolves.toBe("completed");
      await h.advanceDays(4);
      await h.triggerReturn(ref);
      await expect(h.provider.getTransferStatus(ref)).resolves.toBe("returned");
      // returned is terminal too: the money left and stays gone.
      await h.advanceDays(4);
      await expect(h.provider.getTransferStatus(ref)).resolves.toBe("returned");
    });

    it("refuses to return a transfer that has not completed: returned is reachable only from completed", async () => {
      // The transition, not just the state: a return is settled money coming back, so an
      // implementation that lets a PENDING or FAILED transfer become returned is inventing a
      // clawback of money that never moved — and the ledger downstream would post the reversal
      // of a deposit it never credited. Review HIGH: this was asserted only against the mock's
      // internals; it is a property of the SEAM, so every implementation proves it here.
      const h = await make();
      const pending = await h.provider.initiateDeposit({
        userId: h.userId,
        amountCents: 21_00,
        method: "bank",
        idempotencyKey: "contract-return-of-pending",
      });
      await expect(h.triggerReturn(pending.ref)).rejects.toThrow();
      const declined = await h.depositDeclining(17_00);
      await expect(h.triggerReturn(declined.ref)).rejects.toThrow();
      // Neither refusal moved anything: both transfers still answer their own status.
      await expect(h.provider.getTransferStatus(pending.ref)).resolves.toBe("pending");
      await expect(h.provider.getTransferStatus(declined.ref)).resolves.toBe("failed");
    });

    it("rejects a status query for a reference it never issued, rather than inventing an answer", async () => {
      // A ref reaches getTransferStatus from stored ledger rows and from callbacks. If a
      // corrupted or foreign ref quietly answered some status, the mistake would post money;
      // the only safe answer for an unknown reference is a loud rejection. (Review HIGH: was
      // mock-only, and a real adapter mapping its upstream's 404 to a default status would
      // have passed the suite.)
      const h = await make();
      await expect(h.provider.getTransferStatus("contract-ref-never-issued")).rejects.toThrow();
    });

    it("rejects a replayed idempotency key that disagrees with the transfer it created", async () => {
      // The replay case above proves the same input is the same transfer. This proves the
      // complement: the SAME key with a DIFFERENT amount or direction is a caller bug the
      // provider must refuse loudly — honoring it double-moves money, and answering the
      // original would silently ship a number the caller did not ask for.
      const h = await make();
      const input = {
        userId: h.userId,
        amountCents: 10_00,
        method: "bank",
        idempotencyKey: "contract-replay-disagreement",
      } as const;
      await h.provider.initiateDeposit(input);
      await expect(h.provider.initiateDeposit({ ...input, amountCents: 20_00 })).rejects.toThrow();
      await expect(
        h.provider.initiateWithdrawal({
          userId: h.userId,
          amountCents: input.amountCents,
          destination: { externalAccountRef: "contract-ext-account" },
          idempotencyKey: input.idempotencyKey,
        }),
      ).rejects.toThrow();
      // And the original is untouched by the refused attempts.
      await expect(h.provider.getTransferStatus((await h.provider.initiateDeposit(input)).ref)).resolves.toBe("pending");
    });

    it("models a withdrawal that completes and then returns, the same class on the outbound leg", async () => {
      // A withdrawal's credit can bounce after settling (closed account, R02 family). The seam
      // must represent it for the same reason it must represent deposit returns: the ledger has
      // already recorded the money as gone, and the return is the fact that it came back.
      const h = await make();
      const ref = await h.withdrawalCompleting(20_00);
      await expect(h.provider.getTransferStatus(ref)).resolves.toBe("completed");
      await h.advanceDays(2);
      await h.triggerReturn(ref);
      await expect(h.provider.getTransferStatus(ref)).resolves.toBe("returned");
    });

    it("answers getPooledBalanceCents consistently with its own completed transfers", async () => {
      const h = await make();
      const baseline = await h.provider.getPooledBalanceCents();
      const depositRef = await h.depositCompleting(30_00);
      await expect(h.provider.getPooledBalanceCents()).resolves.toBe(baseline + 30_00);
      await h.withdrawalCompleting(10_00);
      await expect(h.provider.getPooledBalanceCents()).resolves.toBe(baseline + 20_00);
      // The return claws the deposit back OUT of the pool: this is the arithmetic the daily
      // reconcile job (ledger aggregate vs pooled balance, zero tolerance) depends on.
      await h.triggerReturn(depositRef);
      await expect(h.provider.getPooledBalanceCents()).resolves.toBe(baseline - 10_00);
    });

    it("does not count a pending or failed transfer in the pooled balance", async () => {
      const h = await make();
      const baseline = await h.provider.getPooledBalanceCents();
      await h.provider.initiateDeposit({
        userId: h.userId,
        amountCents: 12_00,
        method: "bank",
        idempotencyKey: "contract-pending-not-pooled",
      });
      await h.depositDeclining(18_00);
      // Nothing settled, so nothing is in the pool: pooled money is money that MOVED.
      await expect(h.provider.getPooledBalanceCents()).resolves.toBe(baseline);
    });
  });
}
