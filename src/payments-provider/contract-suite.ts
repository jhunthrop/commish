import { describe, expect, it } from "vitest";
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
