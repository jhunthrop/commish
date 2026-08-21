import { describe, expect, it } from "vitest";
import type { ValuedPlayer } from "./fairness";
import { assetPlayerIds, assetsAreDistinct, describeAsset, TRADE_ASSET_KINDS, type AssetDescription, type TradeAsset } from "./assets";

function playerAsset(playerId: string): TradeAsset {
  return { kind: "player", playerId };
}

function valuedPlayer(playerId: string, name: string, position: ValuedPlayer["position"]): ValuedPlayer {
  return { playerId, name, position, averagePoints: 10 };
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

// TS-level exhaustiveness proof, the same "compile error, not a runtime guess" discipline
// `src/draft-room/state/payloads.ts`'s `ClockShapesMatch` uses. `describeAsset`'s own switch has
// no `default` arm and an annotated return type, so if `TRADE_ASSET_KINDS` ever gains a member
// (Phase 9's `"pick"`) `assets.ts` stops typechecking with "not all code paths return a value"
// until the new arm is handled — the same "an added member without a decision is a compile
// error" discipline `TERMINAL_STATUSES` and `TARGET_OF` (`./lifecycle.ts`) get from being
// exhaustive `Record`s. Assigning the function to its own declared signature here is what pins
// the guarantee to a line a reader (and a reviewer) can see, not just to a fact that happens to
// be true of `assets.ts` today.
type DescribeAssetSignature = (asset: TradeAsset, players: Readonly<Record<string, ValuedPlayer>>) => AssetDescription;
const _describeAssetIsExhaustive: DescribeAssetSignature = describeAsset;
void _describeAssetIsExhaustive;

describe("describeAsset", () => {
  it("describes a player asset by name and position, resolved from the supplied lookup", () => {
    const players = { p1: valuedPlayer("p1", "Marcus Mariota", "QB") };
    expect(describeAsset(playerAsset("p1"), players)).toEqual({ label: "Marcus Mariota", position: "QB" });
  });

  it("falls back to a neutral description rather than a raw id when the player is not in the lookup", () => {
    // src/trades is pure and has no roster to read, so a caller-supplied lookup can be
    // incomplete — a ghost player id is a real input, not a bug in this function.
    expect(describeAsset(playerAsset("ghost"), {})).toEqual({ label: "a player no longer on this roster", position: null });
  });
});
