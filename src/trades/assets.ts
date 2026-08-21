/**
 * What one side of a trade sends. A UNION with one arm today, not a bare `playerId`, because
 * `plans/phase-9-dynasty-and-keeper-depth.md` adds draft-pick assets and the founder rule is
 * that nothing ships in a form a later phase throws away. Phase 9 adds
 * `{ kind: "pick"; draftId: string; round: number }` as a second arm; every `switch` in this
 * plan is exhaustive over `TradeAssetKind`, so that arm is a compile error until it is handled
 * everywhere rather than a silent default somewhere.
 */
export const TRADE_ASSET_KINDS = ["player"] as const;
export type TradeAssetKind = (typeof TRADE_ASSET_KINDS)[number];

export type TradeAsset = { readonly kind: "player"; readonly playerId: string };

/** Every player id an asset list touches. The one place a caller turns assets into roster rows. */
export function assetPlayerIds(assets: readonly TradeAsset[]): readonly string[] {
  return assets.filter((asset) => asset.kind === "player").map((asset) => asset.playerId);
}

/**
 * No asset appears twice across BOTH sides. A proposal naming the same player on both sides is
 * not a trade; a proposal naming the same player twice on one side would double-count him in
 * `tradeBalance` and produce a confident verdict about an impossible offer.
 */
export function assetsAreDistinct(from: readonly TradeAsset[], to: readonly TradeAsset[]): boolean {
  const ids = [...assetPlayerIds(from), ...assetPlayerIds(to)];
  return new Set(ids).size === ids.length;
}
