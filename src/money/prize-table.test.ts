import { describe, expect, it } from "vitest";
import { MONEY_REFUSALS } from "./config";
import { prizeTableInvariant, type PrizeTable } from "./prize-table";

describe("prizeTableInvariant", () => {
  it("accepts only a table where prizes plus rake equal the pot exactly, never approximately", () => {
    // fee 2000c x 12 seats = 24000c pot; rake 200c x 12 = 2400c; prizes must sum to 21600c.
    const table: PrizeTable = [
      { place: 1, amountCents: 12_000 },
      { place: 2, amountCents: 6_600 },
      { place: 3, amountCents: 3_000 },
    ];
    expect(prizeTableInvariant(2000, 200, 12, table)).toEqual({ ok: true });
    expect(prizeTableInvariant(2000, 200, 12, [{ place: 1, amountCents: 21_601 }]).ok).toBe(false);
  });

  it("refuses a mismatched table with the exact reason", () => {
    const out = prizeTableInvariant(2000, 200, 12, [{ place: 1, amountCents: 1 }]);
    expect(out).toEqual({ ok: false, reason: MONEY_REFUSALS.prizeTableMismatch });
  });

  it("refuses a non-integer entry fee", () => {
    const out = prizeTableInvariant(2000.5, 200, 12, []);
    expect(out).toEqual({ ok: false, reason: MONEY_REFUSALS.invalidPrizeTableInputs });
  });

  it("refuses a negative rake", () => {
    const out = prizeTableInvariant(2000, -1, 12, []);
    expect(out).toEqual({ ok: false, reason: MONEY_REFUSALS.invalidPrizeTableInputs });
  });

  it("refuses a non-positive seat count", () => {
    const out = prizeTableInvariant(2000, 200, 0, []);
    expect(out).toEqual({ ok: false, reason: MONEY_REFUSALS.invalidPrizeTableInputs });
  });

  it("refuses a non-positive place", () => {
    const out = prizeTableInvariant(2000, 200, 12, [{ place: 0, amountCents: 100 }]);
    expect(out).toEqual({ ok: false, reason: MONEY_REFUSALS.invalidPrizeTableEntry });
  });

  it("refuses a repeated place", () => {
    const out = prizeTableInvariant(2000, 200, 12, [
      { place: 1, amountCents: 100 },
      { place: 1, amountCents: 200 },
    ]);
    expect(out).toEqual({ ok: false, reason: MONEY_REFUSALS.invalidPrizeTableEntry });
  });

  it("refuses a non-positive prize amount", () => {
    const out = prizeTableInvariant(2000, 200, 12, [{ place: 1, amountCents: 0 }]);
    expect(out).toEqual({ ok: false, reason: MONEY_REFUSALS.invalidPrizeTableEntry });
  });

  it("accepts an empty table only when the whole pot is rake — nothing left for prizes", () => {
    expect(prizeTableInvariant(200, 200, 12, [])).toEqual({ ok: true });
  });
});
