/**
 * THE TRADE SHEET'S ARITHMETIC — law 3's hardest homework, done by the app.
 *
 * Both sides priced with what the services actually produce (each player's current-week
 * projection; the fairness engine's side values arrive separately through the existing
 * assessment endpoint), the viewer's roster shape counted before and after, and byes checked
 * against the real NFL schedule. No rest-of-season splits are invented: nothing in the
 * platform computes one, so nothing here renders one.
 */
import type { Position } from "@research-ts/domain/player";
import type { TradeProposalView } from "@/trades/contract";
import { assetPlayerIds } from "@/trades/assets";
import type { TradeRosterPlayer } from "../contract";

export interface PricedAsset {
  readonly playerId: string;
  readonly name: string;
  readonly position: Position | null;
  readonly nflTeam: string | null;
  /** This week's projection, or null when the snapshot has no row for him. */
  readonly weekProjection: number | null;
  /** His NFL team's bye week, or null when it is unknown or already behind us. */
  readonly byeWeek: number | null;
}

/** Which byes the trade changes for the viewer, forward-looking only. */
export interface ByeCheck {
  /** Byes arriving and leaving in the same week: nothing new to cover. */
  readonly shared: readonly number[];
  /** Bye weeks the incoming players add that no outgoing player already had. */
  readonly gained: readonly number[];
  /** Bye weeks the trade clears off the roster's calendar. */
  readonly cleared: readonly number[];
}

export interface TradeSheetMath {
  /** What the viewer receives / sends, priced. Orientation is resolved from `meTeamId`. */
  readonly receive: readonly PricedAsset[];
  readonly send: readonly PricedAsset[];
  /** Viewer roster counts by position, before and after the swap. */
  readonly depthBefore: Readonly<Partial<Record<Position, number>>>;
  readonly depthAfter: Readonly<Partial<Record<Position, number>>>;
  readonly byes: ByeCheck;
}

export interface TradeMathInput {
  readonly trade: TradeProposalView;
  readonly meTeamId: string;
  readonly rostersByTeamId: Readonly<Record<string, readonly TradeRosterPlayer[]>>;
  readonly projectionsByPlayerId: ReadonlyMap<string, number>;
  readonly byeWeeksByNflTeam: ReadonlyMap<string, number>;
  readonly currentWeek: number;
}

function playersById(
  rosters: Readonly<Record<string, readonly TradeRosterPlayer[]>>,
): ReadonlyMap<string, TradeRosterPlayer> {
  const map = new Map<string, TradeRosterPlayer>();
  for (const roster of Object.values(rosters)) {
    for (const player of roster) map.set(player.playerId, player);
  }
  return map;
}

function price(playerId: string, input: TradeMathInput, lookup: ReadonlyMap<string, TradeRosterPlayer>): PricedAsset {
  const player = lookup.get(playerId);
  const nflTeam = player?.nflTeam ?? null;
  const bye = nflTeam === null ? null : (input.byeWeeksByNflTeam.get(nflTeam) ?? null);
  return {
    playerId,
    name: player?.name ?? "a player no longer on this roster",
    position: player?.position ?? null,
    nflTeam,
    weekProjection: input.projectionsByPlayerId.get(playerId) ?? null,
    // A bye already played is not a cost to weigh.
    byeWeek: bye !== null && bye >= input.currentWeek ? bye : null,
  };
}

function countByPosition(players: readonly { readonly position: Position | null }[]): Partial<Record<Position, number>> {
  const counts: Partial<Record<Position, number>> = {};
  for (const player of players) {
    if (player.position === null) continue;
    counts[player.position] = (counts[player.position] ?? 0) + 1;
  }
  return counts;
}

function byeCheck(receive: readonly PricedAsset[], send: readonly PricedAsset[]): ByeCheck {
  const incoming = new Set(receive.flatMap((asset) => (asset.byeWeek === null ? [] : [asset.byeWeek])));
  const outgoing = new Set(send.flatMap((asset) => (asset.byeWeek === null ? [] : [asset.byeWeek])));
  const ascending = (a: number, b: number): number => a - b;
  return {
    shared: [...incoming].filter((week) => outgoing.has(week)).slice().sort(ascending),
    gained: [...incoming].filter((week) => !outgoing.has(week)).slice().sort(ascending),
    cleared: [...outgoing].filter((week) => !incoming.has(week)).slice().sort(ascending),
  };
}

/**
 * The whole sheet, oriented to the viewer. When the viewer is the counterparty (`trade.to`),
 * they receive `from.assets` and send `to.assets`; when they proposed, the reverse.
 */
export function tradeSheetMath(input: TradeMathInput): TradeSheetMath {
  const lookup = playersById(input.rostersByTeamId);
  const viewerProposed = input.trade.from.teamId === input.meTeamId;
  const receiveIds = assetPlayerIds(viewerProposed ? input.trade.to.assets : input.trade.from.assets);
  const sendIds = assetPlayerIds(viewerProposed ? input.trade.from.assets : input.trade.to.assets);
  const receive = receiveIds.map((id) => price(id, input, lookup));
  const send = sendIds.map((id) => price(id, input, lookup));

  const myRoster = input.rostersByTeamId[input.meTeamId] ?? [];
  const sending = new Set(sendIds);
  const after = [...myRoster.filter((player) => !sending.has(player.playerId)), ...receive];

  return {
    receive,
    send,
    depthBefore: countByPosition(myRoster),
    depthAfter: countByPosition(after),
    byes: byeCheck(receive, send),
  };
}
