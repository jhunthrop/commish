import { describe, expect, it } from "vitest";
import { MONEY_REFUSALS } from "./config";
import { defaultPodiumPrizeTable, prizePotCents, prizeTableInvariant, type PrizeTable } from "./prize-table";

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

  it("refuses a table with a gap in the paid sequence, even when totals otherwise balance", () => {
    // fee 2000c x 12 seats = 24000c pot; rake 200c x 12 = 2400c; 18600 + 3000 = 21600, the exact
    // remainder — this table would balance if place 2 were allowed to be missing. It is not.
    const out = prizeTableInvariant(2000, 200, 12, [
      { place: 1, amountCents: 18_600 },
      { place: 3, amountCents: 3_000 },
    ]);
    expect(out).toEqual({ ok: false, reason: MONEY_REFUSALS.invalidPrizeTableEntry });
  });

  it("refuses a non-safe-integer entry fee", () => {
    const out = prizeTableInvariant(2 ** 60, 0, 1, []);
    expect(out).toEqual({ ok: false, reason: MONEY_REFUSALS.amountOverflow });
  });

  it("refuses a non-safe-integer rake", () => {
    const out = prizeTableInvariant(100, 2 ** 60, 1, []);
    expect(out).toEqual({ ok: false, reason: MONEY_REFUSALS.amountOverflow });
  });

  it("refuses a non-safe-integer seat count", () => {
    const out = prizeTableInvariant(100, 0, 2 ** 60, []);
    expect(out).toEqual({ ok: false, reason: MONEY_REFUSALS.amountOverflow });
  });

  it("refuses a prize table entry whose own amount is past the safe integer range", () => {
    const out = prizeTableInvariant(100, 0, 1, [{ place: 1, amountCents: Number.MAX_SAFE_INTEGER + 2 }]);
    expect(out).toEqual({ ok: false, reason: MONEY_REFUSALS.amountOverflow });
  });

  it("refuses a pot that overflows even though the entry fee and seat count are each individually safe", () => {
    // entryFeeCents * seats overflows — the exact case FINDING 1 names.
    const out = prizeTableInvariant(Number.MAX_SAFE_INTEGER, 0, 2, []);
    expect(out).toEqual({ ok: false, reason: MONEY_REFUSALS.amountOverflow });
  });

  it("refuses a rake total that overflows even though the pot does not", () => {
    const out = prizeTableInvariant(0, Number.MAX_SAFE_INTEGER, 2, []);
    expect(out).toEqual({ ok: false, reason: MONEY_REFUSALS.amountOverflow });
  });

  it("refuses individually-safe prize amounts whose sum overflows", () => {
    const out = prizeTableInvariant(0, 0, 1, [
      { place: 1, amountCents: Number.MAX_SAFE_INTEGER },
      { place: 2, amountCents: Number.MAX_SAFE_INTEGER },
    ]);
    expect(out).toEqual({ ok: false, reason: MONEY_REFUSALS.amountOverflow });
  });
});

describe("prizePotCents", () => {
  it("sums the published prizes — the one figure a shelf may call the pot", () => {
    expect(prizePotCents([{ place: 1, amountCents: 30000 }, { place: 2, amountCents: 20000 }, { place: 3, amountCents: 10000 }])).toBe(60000);
    expect(prizePotCents([])).toBe(0);
  });
});

describe("defaultPodiumPrizeTable", () => {
  it("splits the whole pot 50/30/20 with zero rake, and the invariant accepts it by construction", () => {
    const table = defaultPodiumPrizeTable(5000, 12);
    expect(table).toEqual([
      { place: 1, amountCents: 30000 },
      { place: 2, amountCents: 18000 },
      { place: 3, amountCents: 12000 },
    ]);
    expect(prizeTableInvariant(5000, 0, 12, table)).toEqual({ ok: true });
    expect(prizePotCents(table)).toBe(5000 * 12);
  });

  it("folds rounding remainders into 1st so the table still balances exactly", () => {
    const table = defaultPodiumPrizeTable(333, 7); // pot 2331, not divisible cleanly
    expect(prizeTableInvariant(333, 0, 7, table)).toEqual({ ok: true });
    expect(prizePotCents(table)).toBe(333 * 7);
    expect(table[0]!.place).toBe(1);
  });

  it("drops podium places whose share rounds to zero, keeping contiguity from 1st", () => {
    const table = defaultPodiumPrizeTable(1, 3); // pot 3 cents: 1/0/0
    expect(table.every((entry) => entry.amountCents > 0)).toBe(true);
    expect(table.map((entry) => entry.place)).toEqual(table.map((_, index) => index + 1));
    expect(prizeTableInvariant(1, 0, 3, table)).toEqual({ ok: true });
  });

  it("publishes no table at all for a free league — null in storage, never a zero-amount row", () => {
    expect(defaultPodiumPrizeTable(0, 12)).toEqual([]);
    expect(defaultPodiumPrizeTable(5000, 0)).toEqual([]);
  });
});
