import type { Position } from "@/domain/player";
import type { ValuedPlayer } from "./fairness";

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

/**
 * The member-facing description of ONE asset. Structured (`{ label, position }`), not a bare
 * string: Task 8's `TradeCard`/`TradeInbox` render every asset through `PositionBadge` plus a
 * name, the two primitives that already own player display, and a string would force them to
 * re-parse a position back out of prose. `position` is `null` for anything that has none — a
 * Phase 9 draft-pick asset has no position, and a renderer that special-cases `null` rather than
 * guessing a badge is the honest default.
 */
export interface AssetDescription {
  /** What a member reads: a player's name today, a pick's own year/round text once Phase 9
   *  adds that arm. Never a raw id, because an id is not something anyone reads. */
  readonly label: string;
  /** `PositionBadge`'s input, or `null` when the asset has none. */
  readonly position: Position | null;
}

/**
 * Dispatches exhaustively over `TradeAssetKind`, the same "switched on exhaustively" role
 * `plannedTransfer` (`src/league-service`) plays on the execution side — these are the only two
 * places in the codebase allowed to switch on this union at all, so every other caller goes
 * through one of them instead of re-deriving the per-kind logic. The `switch` below has no
 * `default` arm, so Phase 9's `"pick"` arm is a compile error here ("not all code paths return a
 * value") until it is described too.
 *
 * `players` is supplied rather than looked up: `src/trades` is pure and has no roster to read,
 * so the caller (already holding one, from `AdvisorTeamContext` or a roster query) resolves
 * names and positions before calling this — the same dependency-injection shape `tradeBalance`
 * itself takes `ValuedPlayer[]` rather than reading a database. A `playerId` missing from the
 * lookup is a real input (a ghost player, the same failure mode Task 6's detector already has to
 * guard against), not a bug in this function, so it degrades to a neutral description rather
 * than throwing.
 */
export function describeAsset(asset: TradeAsset, players: Readonly<Record<string, ValuedPlayer>>): AssetDescription {
  switch (asset.kind) {
    case "player": {
      const player = players[asset.playerId];
      return player === undefined
        ? { label: "a player no longer on this roster", position: null }
        : { label: player.name, position: player.position };
    }
  }
}
