import { describe, expect, it } from "vitest";
import type { Clock } from "@research/domain/timing";
import type { PaymentsProviderHarness } from "../contract-suite";
import { runPaymentsProviderContractSuite } from "../contract-suite";
import { ingestProviderCallback, type PaymentsEvent } from "../ingest";
import { createMockPaymentsProvider, MOCK_PAYMENTS_CONFIG, type MockPaymentsProvider } from "./mock-payments-provider";

const START_ISO = "2026-09-01T12:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;
const USER_ID = "user-mock-payments";
const DESTINATION = { externalAccountRef: "ext-bank-account-1" } as const;

/** A fresh mock plus the movable clock that drives it. */
interface MockRig {
  readonly provider: MockPaymentsProvider;
  readonly clock: Clock;
  advanceDays(days: number): void;
  nowIso(): string;
}

function makeRig(options?: { surfaceCardFee?: boolean }): MockRig {
  let nowMs = Date.parse(START_ISO);
  const clock: Clock = { now: () => new Date(nowMs).toISOString() };
  return {
    provider: createMockPaymentsProvider(clock, options),
    clock,
    advanceDays: (days) => {
      nowMs += days * DAY_MS;
    },
    nowIso: () => new Date(nowMs).toISOString(),
  };
}

async function makeHarness(): Promise<PaymentsProviderHarness> {
  const rig = makeRig();
  const { provider } = rig;
  await provider.ensureAccount(USER_ID);
  let seq = 0;
  return {
    provider,
    userId: USER_ID,
    async depositCompleting(amountCents) {
      const intent = await provider.initiateDeposit({
        userId: USER_ID,
        amountCents,
        method: "bank",
        idempotencyKey: `harness-deposit-${seq++}`,
      });
      provider.advance();
      return intent.ref;
    },
    async depositDeclining(amountCents) {
      provider.failNextInitiation(MOCK_PAYMENTS_CONFIG.declineReason);
      return provider.initiateDeposit({
        userId: USER_ID,
        amountCents,
        method: "bank",
        idempotencyKey: `harness-decline-${seq++}`,
      });
    },
    async withdrawalCompleting(amountCents) {
      const intent = await provider.initiateWithdrawal({
        userId: USER_ID,
        amountCents,
        destination: DESTINATION,
        idempotencyKey: `harness-withdrawal-${seq++}`,
      });
      provider.advance();
      return intent.ref;
    },
    async advanceDays(days) {
      rig.advanceDays(days);
      provider.advance();
    },
    async triggerReturn(ref) {
      provider.triggerReturn(ref);
    },
  };
}

// The point of the whole file: the mock passes the SAME suite every real rail must pass.
runPaymentsProviderContractSuite("mock", makeHarness);

/** Drain the mock's queue through the real ingestion point, asserting every callback verifies. */
function drainEvents(provider: MockPaymentsProvider): readonly PaymentsEvent[] {
  return provider.drainCallbacks().map((callback) => {
    const outcome = ingestProviderCallback(callback);
    if (!outcome.ok) throw new Error(`mock queued a callback its own ingestion point refuses: ${outcome.reason}`);
    return outcome.event;
  });
}

describe("createMockPaymentsProvider", () => {
  describe("signed callbacks", () => {
    it("queues a deposit_completed callback that the real ingestion point verifies and translates", async () => {
      const { provider } = makeRig();
      await provider.ensureAccount(USER_ID);
      const intent = await provider.initiateDeposit({ userId: USER_ID, amountCents: 50_00, method: "bank", idempotencyKey: "cb-dep" });
      expect(provider.drainCallbacks()).toEqual([]); // nothing settled yet, nothing delivered
      provider.advance();
      expect(drainEvents(provider)).toEqual([{ type: "deposit_completed", ref: intent.ref, amountCents: 50_00 }]);
    });

    it("queues deposit_returned when a completed deposit comes back, for the same ref", async () => {
      const { provider } = makeRig();
      await provider.ensureAccount(USER_ID);
      const intent = await provider.initiateDeposit({ userId: USER_ID, amountCents: 10_00, method: "bank", idempotencyKey: "cb-ret" });
      provider.advance();
      provider.drainCallbacks();
      provider.triggerReturn(intent.ref);
      expect(drainEvents(provider)).toEqual([{ type: "deposit_returned", ref: intent.ref, amountCents: 10_00 }]);
    });

    it("queues withdrawal_completed, withdrawal_returned and withdrawal_failed for the outbound leg's three fates", async () => {
      const { provider } = makeRig();
      await provider.ensureAccount(USER_ID);
      const completing = await provider.initiateWithdrawal({ userId: USER_ID, amountCents: 20_00, destination: DESTINATION, idempotencyKey: "cb-wd-1" });
      provider.advance();
      provider.triggerReturn(completing.ref);
      const failing = await provider.initiateWithdrawal({ userId: USER_ID, amountCents: 7_00, destination: DESTINATION, idempotencyKey: "cb-wd-2" });
      provider.failPendingWithdrawal(failing.ref, "The destination account is closed.");
      expect(drainEvents(provider)).toEqual([
        { type: "withdrawal_completed", ref: completing.ref, amountCents: 20_00 },
        { type: "withdrawal_returned", ref: completing.ref, amountCents: 20_00 },
        { type: "withdrawal_failed", ref: failing.ref, amountCents: 7_00 },
      ]);
    });

    it("drains the queue: a second drain answers nothing", async () => {
      const { provider } = makeRig();
      await provider.ensureAccount(USER_ID);
      await provider.initiateDeposit({ userId: USER_ID, amountCents: 5_00, method: "bank", idempotencyKey: "cb-drain" });
      provider.advance();
      expect(provider.drainCallbacks().length).toBe(1);
      expect(provider.drainCallbacks()).toEqual([]);
    });

    it("queues no callback for a decline: a decline is answered inline, not delivered later", async () => {
      const { provider } = makeRig();
      await provider.ensureAccount(USER_ID);
      await provider.initiateDeposit({ userId: USER_ID, amountCents: MOCK_PAYMENTS_CONFIG.declineAmountCents, method: "bank", idempotencyKey: "cb-decline" });
      provider.advance();
      expect(provider.drainCallbacks()).toEqual([]);
    });
  });

  describe("failure injection", () => {
    it("declines the sentinel amount with the configured typed reason", async () => {
      const { provider } = makeRig();
      await provider.ensureAccount(USER_ID);
      const intent = await provider.initiateDeposit({
        userId: USER_ID,
        amountCents: MOCK_PAYMENTS_CONFIG.declineAmountCents,
        method: "bank",
        idempotencyKey: "sentinel",
      });
      expect(intent.status).toBe("failed");
      expect(intent.failureReason).toBe(MOCK_PAYMENTS_CONFIG.declineReason);
    });

    it("failNextInitiation declines exactly one initiation, then the tap closes", async () => {
      const { provider } = makeRig();
      await provider.ensureAccount(USER_ID);
      provider.failNextInitiation("No account on file at the bank.");
      const declined = await provider.initiateWithdrawal({ userId: USER_ID, amountCents: 9_00, destination: DESTINATION, idempotencyKey: "inj-1" });
      expect(declined.status).toBe("failed");
      expect(declined.failureReason).toBe("No account on file at the bank.");
      const next = await provider.initiateDeposit({ userId: USER_ID, amountCents: 9_00, method: "bank", idempotencyKey: "inj-2" });
      expect(next.status).toBe("pending");
    });

    it("failPendingWithdrawal flips a pending withdrawal to failed and refuses everything else", async () => {
      const { provider } = makeRig();
      await provider.ensureAccount(USER_ID);
      const withdrawal = await provider.initiateWithdrawal({ userId: USER_ID, amountCents: 11_00, destination: DESTINATION, idempotencyKey: "fpw-1" });
      provider.failPendingWithdrawal(withdrawal.ref, "The credit bounced.");
      await expect(provider.getTransferStatus(withdrawal.ref)).resolves.toBe("failed");
      // A deposit is never failed asynchronously: its late failure IS a return.
      const deposit = await provider.initiateDeposit({ userId: USER_ID, amountCents: 11_00, method: "bank", idempotencyKey: "fpw-2" });
      expect(() => provider.failPendingWithdrawal(deposit.ref, "nope")).toThrow("withdrawal");
      // And a settled withdrawal is past failing: that fate is triggerReturn's.
      const settled = await provider.initiateWithdrawal({ userId: USER_ID, amountCents: 12_00, destination: DESTINATION, idempotencyKey: "fpw-3" });
      provider.advance();
      expect(() => provider.failPendingWithdrawal(settled.ref, "late")).toThrow("pending");
    });
  });

  describe("clock discipline", () => {
    it("stamps initiatedAt from the injected clock, never from the wall", async () => {
      const rig = makeRig();
      await rig.provider.ensureAccount(USER_ID);
      rig.advanceDays(3);
      const intent = await rig.provider.initiateDeposit({ userId: USER_ID, amountCents: 8_00, method: "bank", idempotencyKey: "clock" });
      expect(intent.initiatedAt).toBe(rig.nowIso());
    });
  });

  describe("supported methods", () => {
    it("ships the card fee surfaced OFF: zeros reported, the model held back until the founder prices it", async () => {
      const { provider } = makeRig();
      expect(MOCK_PAYMENTS_CONFIG.surfaceCardFee).toBe(false);
      const card = provider.listSupportedMethods().find((m) => m.method === "card");
      expect(card).toEqual({ method: "card", feeCents: 0, feePercentBasisPoints: 0, etaDescription: MOCK_PAYMENTS_CONFIG.methods.card.etaDescription });
    });

    it("reports the modeled card fee when surfacing is switched on", async () => {
      const { provider } = makeRig({ surfaceCardFee: true });
      const card = provider.listSupportedMethods().find((m) => m.method === "card");
      expect(card).toEqual({
        method: "card",
        feeCents: MOCK_PAYMENTS_CONFIG.methods.card.feeCents,
        feePercentBasisPoints: MOCK_PAYMENTS_CONFIG.methods.card.feePercentBasisPoints,
        etaDescription: MOCK_PAYMENTS_CONFIG.methods.card.etaDescription,
      });
    });

    it("reports bank free under either answer, straight from the config", async () => {
      for (const surfaceCardFee of [false, true]) {
        const { provider } = makeRig({ surfaceCardFee });
        const bank = provider.listSupportedMethods().find((m) => m.method === "bank");
        expect(bank).toEqual({ method: "bank", ...MOCK_PAYMENTS_CONFIG.methods.bank });
      }
    });

    it("accepts a card deposit and settles it like any other", async () => {
      const { provider } = makeRig();
      await provider.ensureAccount(USER_ID);
      const intent = await provider.initiateDeposit({ userId: USER_ID, amountCents: 30_00, method: "card", idempotencyKey: "card-dep" });
      provider.advance();
      await expect(provider.getTransferStatus(intent.ref)).resolves.toBe("completed");
    });
  });

  describe("guards (caller bugs fail fast, they are not declines)", () => {
    it("refuses an initiation for a user with no provider account, naming ensureAccount", async () => {
      const { provider } = makeRig();
      await expect(provider.initiateDeposit({ userId: "user-unknown", amountCents: 5_00, method: "bank", idempotencyKey: "g1" })).rejects.toThrow("ensureAccount");
      await expect(provider.initiateWithdrawal({ userId: "user-unknown", amountCents: 5_00, destination: DESTINATION, idempotencyKey: "g2" })).rejects.toThrow("ensureAccount");
    });

    it("refuses a non-integer or non-positive amount", async () => {
      const { provider } = makeRig();
      await provider.ensureAccount(USER_ID);
      for (const amountCents of [0, -5_00, 10.5]) {
        await expect(provider.initiateDeposit({ userId: USER_ID, amountCents, method: "bank", idempotencyKey: `g-amt-${amountCents}` })).rejects.toThrow("integer");
      }
    });

    it("refuses a replayed idempotency key that disagrees with the original transfer", async () => {
      const { provider } = makeRig();
      await provider.ensureAccount(USER_ID);
      await provider.initiateDeposit({ userId: USER_ID, amountCents: 10_00, method: "bank", idempotencyKey: "same-key" });
      await expect(provider.initiateDeposit({ userId: USER_ID, amountCents: 20_00, method: "bank", idempotencyKey: "same-key" })).rejects.toThrow("idempotency");
      await expect(provider.initiateWithdrawal({ userId: USER_ID, amountCents: 10_00, destination: DESTINATION, idempotencyKey: "same-key" })).rejects.toThrow("idempotency");
    });

    it("replays a withdrawal idempotency key as the same transfer, like deposits", async () => {
      const { provider } = makeRig();
      await provider.ensureAccount(USER_ID);
      const input = { userId: USER_ID, amountCents: 15_00, destination: DESTINATION, idempotencyKey: "wd-replay" } as const;
      const first = await provider.initiateWithdrawal(input);
      provider.advance();
      const replay = await provider.initiateWithdrawal(input);
      expect(replay.ref).toBe(first.ref);
      expect(replay.status).toBe("completed");
    });

    it("refuses a status query for a ref it never issued", async () => {
      const { provider } = makeRig();
      await expect(provider.getTransferStatus("no-such-ref")).rejects.toThrow("no-such-ref");
    });

    it("refuses to return a transfer that is not completed", async () => {
      const { provider } = makeRig();
      await provider.ensureAccount(USER_ID);
      const pending = await provider.initiateDeposit({ userId: USER_ID, amountCents: 10_00, method: "bank", idempotencyKey: "ret-pending" });
      expect(() => provider.triggerReturn(pending.ref)).toThrow("completed");
      provider.failNextInitiation("declined");
      const failed = await provider.initiateDeposit({ userId: USER_ID, amountCents: 10_00, method: "bank", idempotencyKey: "ret-failed" });
      expect(() => provider.triggerReturn(failed.ref)).toThrow("completed");
      expect(() => provider.triggerReturn("no-such-ref")).toThrow("no-such-ref");
    });
  });
});
