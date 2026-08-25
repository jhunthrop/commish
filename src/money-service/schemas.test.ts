import { describe, expect, it } from "vitest";
import { MONEY_CONFIG, MONEY_REFUSALS } from "@/money/config";
import { depositRequestSchema } from "./schemas";

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
