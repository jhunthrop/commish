import type { Position } from "@research-ts/domain/player";
import type { TradeProposalView } from "@/trades/contract";
import { assetPlayerIds } from "@/trades/assets";
import type { LeagueHomeBody, TradeRoomContext, TradeRosterPlayer } from "../contract";
import { formatWeekdayClock } from "./format";
import { slotLabelFor, type LineupFixPlan } from "./lineup-problems";

/**
 * THE WORDS THE MOMENT SPEAKS (P7: the way a friend in the group chat would). Second person,
 * concrete, in fantasy words. Pure, so the front page's one verb card and any notice can share
 * a sentence rather than each writing its own.
 */
const POSITION_WORD: Readonly<Record<Position, string>> = {
  QB: "quarterbacks",
  RB: "running backs",
  WR: "receivers",
  TE: "tight ends",
  K: "kickers",
  DEF: "defenses",
};

export function problemHeadline(plan: LineupFixPlan, home: Pick<LeagueHomeBody, "rosterSlots">): string {
  const label = slotLabelFor(plan.problem, home.rosterSlots);
  if (plan.problem.reason === "empty") return `Your ${label} slot is empty`;
  if (plan.problem.reason === "bye") return `Your ${label} slot starts a player on bye`;
  return `Your ${label} slot starts a player ruled out`;
}

export function problemEvidence(plan: LineupFixPlan): string {
  const playable = plan.candidates.filter((candidate) => (candidate.projection ?? 0) > 0).length;
  const opening =
    plan.problem.reason === "empty"
      ? "Nobody is in the slot."
      : plan.problem.reason === "bye"
        ? `${plan.problem.playerName ?? "Your starter"} sits this week.`
        : `${plan.problem.playerName ?? "Your starter"} is ruled out.`;
  if (plan.candidates.length === 0) return `${opening} No bench player fits the slot, so the wire has your options.`;
  if (playable === 0) return `${opening} ${plan.candidates.length} bench ${plan.candidates.length === 1 ? "player" : "players"} can fill it.`;
  return `${opening} ${playable} bench ${playable === 1 ? "player projects" : "players project"} higher than an empty slot.`;
}

function playerNamed(playerId: string | undefined, context: TradeRoomContext | null): TradeRosterPlayer | null {
  if (playerId === undefined || context === null) return null;
  for (const roster of Object.values(context.rostersByTeamId)) {
    const player = roster.find((entry) => entry.playerId === playerId);
    if (player !== undefined) return player;
  }
  return null;
}

function nameOf(playerId: string | undefined, context: TradeRoomContext | null): string {
  return playerNamed(playerId, context)?.name ?? "a player";
}

function positionCount(roster: readonly TradeRosterPlayer[] | undefined, position: Position): number {
  return roster === undefined ? 0 : roster.filter((player) => player.position === position).length;
}

/** The first player coming to you in this trade, when the room's rosters know him. */
export function primaryIncoming(trade: TradeProposalView, context: TradeRoomContext | null): TradeRosterPlayer | null {
  if (context === null) return null;
  const incoming = trade.from.teamId === context.myTeamId ? trade.to.assets : trade.from.assets;
  return playerNamed(assetPlayerIds(incoming)[0], context);
}

export function tradeHeadline(trade: TradeProposalView, context: TradeRoomContext | null): string {
  const iProposed = context !== null && trade.from.teamId === context.myTeamId;
  const otherName = iProposed ? trade.to.teamName : trade.from.teamName;
  const incoming = assetPlayerIds(iProposed ? trade.to.assets : trade.from.assets);
  const outgoing = assetPlayerIds(iProposed ? trade.from.assets : trade.to.assets);
  const incomingName = nameOf(incoming[0], context) + (incoming.length > 1 ? " and more" : "");
  const outgoingName = nameOf(outgoing[0], context) + (outgoing.length > 1 ? " and more" : "");
  return iProposed ? `Your offer to ${otherName}: ${outgoingName} for ${incomingName}` : `${otherName} offer ${incomingName} for ${outgoingName}`;
}

export function tradeEvidence(trade: TradeProposalView, context: TradeRoomContext | null): string {
  const expiry = `The offer expires ${formatWeekdayClock(trade.expiresAt)}`;
  const incoming = primaryIncoming(trade, context);
  if (context === null || incoming === null) return `${expiry}.`;
  const otherTeamId = trade.from.teamId === context.myTeamId ? trade.to.teamId : trade.from.teamId;
  const mine = positionCount(context.rostersByTeamId[context.myTeamId], incoming.position);
  const theirs = positionCount(context.rostersByTeamId[otherTeamId], incoming.position);
  if (mine === 0 && theirs === 0) return `${expiry}.`;
  return `${expiry}. You carry ${mine} ${POSITION_WORD[incoming.position]}, they carry ${theirs}.`;
}
