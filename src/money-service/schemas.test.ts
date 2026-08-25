import { describe, expect, it } from "vitest";
import { MONEY_CONFIG, MONEY_REFUSALS } from "@/money/config";
import { depositRequestSchema, withdrawalRequestSchema } from "./schemas";

const valid = { amountCents: 50_00, stateOfEntry: "TN", method: "bank", idempotencyKey: "form_1" };

describe("depositRequestSchema", () => {
  it("accepts a well-formed request at both bound edges", () => {
    expect(depositRequestSchema.safeParse(valid).success).toBe(true);
    expect(depositRequestSchema.safeParse({ ...valid, amountCents: MONEY_CONFIG.deposit.minCents }).success).toBe(true);
    expect(depositRequestSchema.safeParse({ ...valid, amountCents: MONEY_CONFIG.deposit.maxPerTransferCents }).success).toBe(true);
  });

  it("refuses below the minimum with the money-first sentence built from the config itself", () => {
    const out = depositRequestSchema.safeParse({ ...valid, amountCents: MONEY_CONFIG.deposit.minCents - 1 });
    expect(out.success).toBe(false);
    expect(out.success ? "" : out.error.issues[0]!.message).toBe(MONEY_REFUSALS.depositBelowMinimum);
    expect(MONEY_REFUSALS.depositBelowMinimum).toContain("$5.00");
  });

  it("refuses above the per-transfer maximum the same way", () => {
    const out = depositRequestSchema.safeParse({ ...valid, amountCents: MONEY_CONFIG.deposit.maxPerTransferCents + 1 });
    expect(out.success).toBe(false);
    expect(out.success ? "" : out.error.issues[0]!.message).toBe(MONEY_REFUSALS.depositAboveMaximum);
    expect(MONEY_REFUSALS.depositAboveMaximum).toContain("$1,000.00");
  });

  it("refuses fractional cents, unknown states, unknown methods, and unknown keys", () => {
    expect(depositRequestSchema.safeParse({ ...valid, amountCents: 50_00.5 }).success).toBe(false);
    expect(depositRequestSchema.safeParse({ ...valid, stateOfEntry: "ZZ" }).success).toBe(false);
    expect(depositRequestSchema.safeParse({ ...valid, method: "paypal" }).success).toBe(false);
    expect(depositRequestSchema.safeParse({ ...valid, extra: true }).success).toBe(false);
    expect(depositRequestSchema.safeParse({ ...valid, idempotencyKey: "" }).success).toBe(false);
  });
});

const validWithdrawal = { amountCents: 50_00, stateOfEntry: "TN", destination: { externalAccountRef: "ext_1" }, idempotencyKey: "form_1" };

describe("withdrawalRequestSchema", () => {
  it("accepts a well-formed request at the minimum bound, and with no upper bound at all", () => {
    expect(withdrawalRequestSchema.safeParse(validWithdrawal).success).toBe(true);
    expect(withdrawalRequestSchema.safeParse({ ...validWithdrawal, amountCents: MONEY_CONFIG.withdrawal.minCents }).success).toBe(true);
    expect(withdrawalRequestSchema.safeParse({ ...validWithdrawal, amountCents: 1_000_000_00 }).success).toBe(true);
  });

  it("refuses below the minimum with the money-first sentence built from the config itself", () => {
    const out = withdrawalRequestSchema.safeParse({ ...validWithdrawal, amountCents: MONEY_CONFIG.withdrawal.minCents - 1 });
    expect(out.success).toBe(false);
    expect(out.success ? "" : out.error.issues[0]!.message).toBe(MONEY_REFUSALS.withdrawalBelowMinimum);
    expect(MONEY_REFUSALS.withdrawalBelowMinimum).toContain("$5.00");
  });

  it("refuses fractional cents, unknown states, an empty destination ref, and unknown keys", () => {
    expect(withdrawalRequestSchema.safeParse({ ...validWithdrawal, amountCents: 50_00.5 }).success).toBe(false);
    expect(withdrawalRequestSchema.safeParse({ ...validWithdrawal, stateOfEntry: "ZZ" }).success).toBe(false);
    expect(withdrawalRequestSchema.safeParse({ ...validWithdrawal, destination: { externalAccountRef: "" } }).success).toBe(false);
    expect(withdrawalRequestSchema.safeParse({ ...validWithdrawal, destination: { externalAccountRef: "ext_1", method: "bank" } }).success).toBe(false);
    expect(withdrawalRequestSchema.safeParse({ ...validWithdrawal, extra: true }).success).toBe(false);
    expect(withdrawalRequestSchema.safeParse({ ...validWithdrawal, idempotencyKey: "" }).success).toBe(false);
  });
});
