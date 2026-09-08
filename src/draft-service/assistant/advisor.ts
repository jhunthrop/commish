/**
 * THE ADVISOR CORE — one seat's view over an already-valued board, a replayed `DraftState` and
 * the room's own odds table (`sim/room-odds.ts`, computed once per room state and shared by
 * every seat). The next pick the manager should make and why, the odds for every undrafted
 * player at that manager's next turn, and the tier each of them stands in.
 *
 * Pure, so the Draft HQ demo computes REAL advisor views over its replayed room the same way a
 * live room does — one function, never a second implementation of "what the advisor says".
 */
import { assignSlot, rosterFor, teamOnClock, type DraftState } from "@/draft-engine";
import type { Recommendation } from "@/projections/decide/draft";
import type { LeagueShape } from "@/projections/decide/replacement";
import { seatsAheadFor, survivalFor, type RoomOddsTable, type SeatSurvival } from "../sim/room-odds";
import { askingWindow, recommendNow, type ValuedEntry } from "./recommend";
import { detectRun } from "./signals";
import type { AdvisorView, NextPick, OddsCell, SurvivalOdds, TierStandingView } from "./view";
import { buildWhy } from "./why";

export interface AdvisorCoreInput {
  readonly state: DraftState;
  readonly askingTeamId: string;
  readonly valued: ReadonlyMap<string, ValuedEntry>;
  readonly shape: LeagueShape;
  /** The room's odds table for exactly this `state`. */
  readonly table: RoomOddsTable;
  /** The room's tier standings for exactly this `state` (`tiers.ts`), computed once per state. */
  readonly tiers: Readonly<Record<string, TierStandingView>>;
}

function oddsCellFor(survival: SeatSurvival | null, playerId: string): OddsCell | null {
  if (survival === null || survival.runsReached === 0) return null;
  const survived = survival.survived.get(playerId);
  return survived === undefined ? null : { survival: survived / survival.runsReached, runs: survival.runsReached };
}

function oddsView(survival: SeatSurvival | null): SurvivalOdds | null {
  if (survival === null || survival.runsReached === 0) return null;
  return { pickNumber: survival.pickNumber, runs: survival.runsReached, survived: Object.fromEntries(survival.survived) };
}

function nextPickFor(input: AdvisorCoreInput, top: Recommendation, survival: SeatSurvival | null): NextPick {
  const { state, askingTeamId, valued, table } = input;
  const entry = valued.get(top.playerId);
  const assigned = assignSlot({ position: top.position, roster: rosterFor(state, askingTeamId), slotConfig: state.config.slotConfig });
  const fillsSlot = assigned.ok ? assigned.slot : null;
  const why = buildWhy(
    { position: top.position, positionRank: entry?.positionRank ?? 0, fillsSlot, reasons: top.reasons, run: detectRun(state), ahead: seatsAheadFor(table, state, askingTeamId), runs: table.runs },
    state.pickNumber,
  );
  return {
    playerId: top.playerId,
    position: top.position,
    positionRank: entry?.positionRank ?? 0,
    valueOverReplacement: entry?.valueOverReplacement ?? 0,
    fillsSlot,
    makeItBack: oddsCellFor(survival, top.playerId),
    why: why.text,
    whyShape: why.shape,
  };
}

/** `null` only when the asking seat has no further turn to advise. */
export function advisorCore(input: AdvisorCoreInput): AdvisorView | null {
  const { state, askingTeamId, table, tiers } = input;
  const window = askingWindow(state, askingTeamId);
  if (window === null) return null;
  const top = recommendNow(input)[0] ?? null;
  const survival = survivalFor(table, state, askingTeamId);
  return {
    pickNumber: window.pickNumber,
    onTheClock: teamOnClock(state) === askingTeamId,
    picksUntilYourTurn: Math.max(0, window.pickNumber - state.pickNumber),
    teamCount: state.draftOrder.length,
    stamp: { computedAtPick: state.pickNumber, sequence: state.sequence },
    runs: table.runs,
    pick: top === null ? null : nextPickFor(input, top, survival),
    odds: oddsView(survival),
    tiers,
  };
}

/** A small deterministic seed from the room's namespace and sequence: the same room state
 *  simulates the same way on every recompute, and a new pick is a new draw. */
export function seedFor(namespace: string, sequence: number): number {
  let hash = 2166136261;
  for (const char of `${namespace}:${sequence}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash;
}
