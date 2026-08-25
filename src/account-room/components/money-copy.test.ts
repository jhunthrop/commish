import { describe, expect, it } from "vitest";
import type { MethodDescriptor } from "@/payments-provider/contract";
import { describeMethodFee } from "./money-copy";

describe("describeMethodFee — the fee and ETA a deposit or withdrawal form shows before commit", () => {
  it("says there is no fee when both components are zero", () => {
    const bank: MethodDescriptor = { method: "bank", feeCents: 0, feePercentBasisPoints: 0, etaDescription: "1-3 business days" };
    expect(describeMethodFee(bank)).toBe("No fee. 1-3 business days.");
  });

  it("states a flat-plus-percent fee through formatUsd, never a raw cents number", () => {
    const card: MethodDescriptor = { method: "card", feeCents: 30, feePercentBasisPoints: 325, etaDescription: "Within minutes" };
    expect(describeMethodFee(card)).toBe("$0.30 plus 3.25% fee. Within minutes.");
  });

  it("states a flat-only fee with no percent clause", () => {
    const flat: MethodDescriptor = { method: "card", feeCents: 50, feePercentBasisPoints: 0, etaDescription: "Within minutes" };
    expect(describeMethodFee(flat)).toBe("$0.50 fee. Within minutes.");
  });
});
