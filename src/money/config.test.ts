import { describe, expect, it } from "vitest";
import { formatUsd, MONEY_CONFIG, MONEY_REFUSALS } from "./config";

describe("MONEY_CONFIG", () => {
  it("caps an entry fee at $500, founder decision 8, as config not a constant", () => {
    expect(MONEY_CONFIG.entryFeeCeilingCents).toBe(50_000);
  });

  it("versions the reporting threshold by tax year, $600 TY2025 and $2,000 TY2026+", () => {
    expect(MONEY_CONFIG.reportingThresholdCentsByTaxYear[2025]).toBe(60_000);
    expect(MONEY_CONFIG.reportingThresholdCentsByTaxYear[2026]).toBe(200_000);
  });

  it("tolerates zero drift between the ledger and the bank", () => {
    expect(MONEY_CONFIG.reconcileToleranceCents).toBe(0);
  });
});

describe("MONEY_REFUSALS", () => {
  it("is a closed set of plain-language sentences, not codes", () => {
    for (const reason of Object.values(MONEY_REFUSALS)) {
      expect(typeof reason).toBe("string");
      expect(reason.length).toBeGreaterThan(0);
    }
  });
});

describe("formatUsd", () => {
  it("renders whole cents as a dollar string", () => {
    expect(formatUsd(50_000)).toBe("$500.00");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(1)).toBe("$0.01");
  });

  it("refuses a non-integer number of cents", () => {
    expect(() => formatUsd(100.5)).toThrow(/whole number/);
  });
});
