import { describe, expect, it } from "vitest";
import { assetPlayerIds, assetsAreDistinct, TRADE_ASSET_KINDS, type TradeAsset } from "./assets";

function playerAsset(playerId: string): TradeAsset {
  return { kind: "player", playerId };
}

describe("TRADE_ASSET_KINDS", () => {
  it("has exactly one arm today — Phase 9 adds a second", () => {
    expect(TRADE_ASSET_KINDS).toEqual(["player"]);
  });
});

describe("assetPlayerIds", () => {
  it("extracts every player id from a list of player assets", () => {
    expect(assetPlayerIds([playerAsset("p1"), playerAsset("p2")])).toEqual(["p1", "p2"]);
  });

  it("returns an empty list for an empty asset list", () => {
    expect(assetPlayerIds([])).toEqual([]);
  });
});

describe("assetsAreDistinct", () => {
  it("accepts two sides with no player in common", () => {
    expect(assetsAreDistinct([playerAsset("p1")], [playerAsset("p2")])).toBe(true);
  });

  it("refuses the same player on both sides", () => {
    expect(assetsAreDistinct([playerAsset("p1")], [playerAsset("p1")])).toBe(false);
  });

  it("refuses the same player twice on one side, which tradeBalance would double-count", () => {
    expect(assetsAreDistinct([playerAsset("p1"), playerAsset("p1")], [])).toBe(false);
  });

  it("accepts two empty sides — not a real trade, but not a duplicate one either", () => {
    expect(assetsAreDistinct([], [])).toBe(true);
  });
});
