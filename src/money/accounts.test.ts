import { describe, expect, it } from "vitest";
import {
  accountIdFor,
  accountSide,
  MONEY_ACCOUNT_KINDS,
  parseAccountId,
  signedBalance,
  type MoneyAccountKind,
} from "./accounts";

describe("MONEY_ACCOUNT_KINDS", () => {
  it("is the closed set of eight kinds the ledger ever posts against", () => {
    expect(MONEY_ACCOUNT_KINDS).toEqual([
      "fbo_pool",
      "provider_clearing",
      "platform_receivable",
      "user_available",
      "league_escrow",
      "held_for_review",
      "platform_rake",
      "platform_forfeiture",
    ]);
  });
});

describe("accountSide", () => {
  it("classifies fbo_pool and platform_receivable as assets", () => {
    expect(accountSide("fbo_pool")).toBe("asset");
    expect(accountSide("platform_receivable")).toBe("asset");
  });

  it("classifies every other kind as a liability", () => {
    const liabilityKinds: readonly MoneyAccountKind[] = [
      "provider_clearing",
      "user_available",
      "league_escrow",
      "held_for_review",
      "platform_rake",
      "platform_forfeiture",
    ];
    for (const kind of liabilityKinds) {
      expect(accountSide(kind)).toBe("liability");
    }
  });
});

describe("signedBalance", () => {
  it("is debits minus credits for an asset account", () => {
    expect(signedBalance("fbo_pool", 1_000, 400)).toBe(600);
  });

  it("is credits minus debits for a liability account", () => {
    expect(signedBalance("user_available", 400, 1_000)).toBe(600);
  });
});

describe("accountIdFor / parseAccountId round trip", () => {
  it("builds and parses each owner-scoped kind", () => {
    const ownerScoped: readonly ["user_available" | "league_escrow" | "held_for_review" | "platform_receivable", string][] = [
      ["user_available", "user_1"],
      ["league_escrow", "league_1"],
      ["held_for_review", "user_2"],
      ["platform_receivable", "user_3"],
    ];
    for (const [kind, ownerId] of ownerScoped) {
      const id = accountIdFor(kind, ownerId);
      expect(id).toBe(`${kind}:${ownerId}`);
      expect(parseAccountId(id)).toEqual({ kind, ownerId });
    }
  });

  it("builds and parses each singleton kind with no owner id", () => {
    const singletons: readonly ("fbo_pool" | "provider_clearing" | "platform_rake" | "platform_forfeiture")[] = [
      "fbo_pool",
      "provider_clearing",
      "platform_rake",
      "platform_forfeiture",
    ];
    for (const kind of singletons) {
      const id = accountIdFor(kind);
      expect(id).toBe(kind);
      expect(parseAccountId(id)).toEqual({ kind, ownerId: null });
    }
  });

  it("refuses to build an owner-scoped id with no owner id", () => {
    expect(() => accountIdFor("user_available", "")).toThrow(/requires an owner id/);
  });

  it("refuses to build a singleton id carrying an owner id", () => {
    const buildWithOwnerId = accountIdFor as (kind: MoneyAccountKind, ownerId?: string) => string;
    expect(() => buildWithOwnerId("fbo_pool", "user_1")).toThrow(/takes no owner id/);
  });

  it("refuses to parse an id naming an unknown kind", () => {
    expect(() => parseAccountId("not_a_real_kind:user_1")).toThrow(/does not name a known money account kind/);
  });

  it("refuses to parse an owner-scoped id missing its owner id", () => {
    expect(() => parseAccountId("user_available")).toThrow(/missing the owner id/);
  });

  it("refuses to parse a singleton id carrying an owner id", () => {
    expect(() => parseAccountId("fbo_pool:user_1")).toThrow(/carries an owner id/);
  });
});
