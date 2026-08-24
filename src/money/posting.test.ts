import { describe, expect, it } from "vitest";
import { MONEY_REFUSALS } from "./config";
import { balancedOrRefuse, type MoneyPosting } from "./posting";

describe("balancedOrRefuse", () => {
  it("accepts a posting set whose debits and credits match to the cent", () => {
    const postings: readonly MoneyPosting[] = [
      { accountId: "user_available:u1", direction: "debit", amountCents: 1000 },
      { accountId: "league_escrow:lg1", direction: "credit", amountCents: 1000 },
    ];
    expect(balancedOrRefuse(postings)).toEqual({ ok: true });
  });

  it("refuses any posting set whose debits and credits do not match to the cent", () => {
    const out = balancedOrRefuse([
      { accountId: "user_available:u1", direction: "debit", amountCents: 1000 },
      { accountId: "league_escrow:lg1", direction: "credit", amountCents: 999 },
    ]);
    expect(out).toEqual({ ok: false, reason: MONEY_REFUSALS.unbalanced });
  });

  it("refuses a zero amount before it ever reaches Postgres", () => {
    expect(balancedOrRefuse([{ accountId: "user_available:u1", direction: "debit", amountCents: 0 }]).ok).toBe(false);
  });

  it("refuses a negative amount", () => {
    const out = balancedOrRefuse([{ accountId: "user_available:u1", direction: "debit", amountCents: -500 }]);
    expect(out).toEqual({ ok: false, reason: MONEY_REFUSALS.invalidAmount });
  });

  it("refuses a non-integer amount", () => {
    const out = balancedOrRefuse([{ accountId: "user_available:u1", direction: "debit", amountCents: 10.5 }]);
    expect(out).toEqual({ ok: false, reason: MONEY_REFUSALS.invalidAmount });
  });

  it("refuses an empty posting set — nothing to balance is not a transaction", () => {
    expect(balancedOrRefuse([])).toEqual({ ok: false, reason: MONEY_REFUSALS.emptyPostingSet });
  });

  it("checks per-posting validity before the balance sum, so a lone zero-amount posting cannot slip through as trivially balanced", () => {
    const out = balancedOrRefuse([{ accountId: "user_available:u1", direction: "debit", amountCents: 0 }]);
    expect(out).toEqual({ ok: false, reason: MONEY_REFUSALS.invalidAmount });
  });

  it("refuses a single posting whose own amount is past the safe integer range", () => {
    const out = balancedOrRefuse([
      { accountId: "user_available:u1", direction: "debit", amountCents: Number.MAX_SAFE_INTEGER + 2 },
    ]);
    expect(out).toEqual({ ok: false, reason: MONEY_REFUSALS.amountOverflow });
  });

  it("refuses a posting set whose individually-safe amounts sum past the safe integer range", () => {
    // Each amount alone is Number.MAX_SAFE_INTEGER, which is itself safe — this is the "an
    // individually-valid pair whose sum crosses 2^53" case: only the SUM overflows.
    const half = Number.MAX_SAFE_INTEGER;
    const out = balancedOrRefuse([
      { accountId: "user_available:u1", direction: "debit", amountCents: half },
      { accountId: "user_available:u1", direction: "debit", amountCents: half },
      { accountId: "league_escrow:lg1", direction: "credit", amountCents: half },
      { accountId: "league_escrow:lg1", direction: "credit", amountCents: half },
    ]);
    expect(out).toEqual({ ok: false, reason: MONEY_REFUSALS.amountOverflow });
  });
});
