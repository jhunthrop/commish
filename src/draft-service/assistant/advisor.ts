/**
 * THE ADVISOR CORE — one seat's view over an already-valued board, a replayed `DraftState` and
 * the room's own odds table (`sim/room-odds.ts`, computed once per room state and shared by
 * every seat). The next pick the manager should make and why, the odds for every undrafted
 * player at that manager's next turn, and the tier each of them stands in.
 *
 * Pure, so the Draft HQ demo computes REAL advisor views over its replayed room the same way a
 * live room does — one function, never a second implementation of "what the advisor says".
 */
import { SURVIVAL_BANDS } from "@/domain/draft-odds";
import { restrictedPositions } from "@research-ts/domain/roster-eligibility";
import { assignSlot, rosterFor, teamOnClock, type DraftState } from "@/draft-engine";
import type { Recommendation } from "@research-ts/projections/decide/draft";
import type { LeagueShape } from "@research-ts/projections/decide/replacement";
import { seatsAheadFor, survivalFor, type RoomOddsTable, type SeatSurvival } from "../sim/room-odds";
import { ADVISOR_CONFIG } from "./config";
import { askingWindow, recommendNow, type ValuedEntry } from "./recommend";
import { detectRun } from "./signals";
import type { AdvisorView, Candidate, NextPick, OddsCell, SurvivalOdds, TierCollapse, TierStandingView } from "./view";
import type { PositionRun } from "@research-ts/advisor/why";
import { buildWhy } from "@research-ts/advisor/why";

export interface AdvisorCoreInput {
  readonly state: DraftState;
  readonly askingTeamId: string;
  readonly valued: ReadonlyMap<string, ValuedEntry>;
  readonly shape: LeagueShape;
  /** The room's odds table for exactly this `state`. */
  readonly table: RoomOddsTable;
  /** The room's tier standings for exactly this `state` (`tiers.ts`), computed once per state. */
  readonly tiers: Readonly<Record<string, TierStandingView>>;
  /** The room's tier collapses for exactly this `state` (`signals.ts`), computed once per state. */
  readonly collapses: readonly TierCollapse[];
  /** The seat's shortlist, `ADVISOR_CONFIG.shortlistSize` deep, when the caller holds it (the
   *  service memoises it per seat and state); absent, computed here. */
  readonly shortlist?: readonly Recommendation[];
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

function nextPickFor(input: AdvisorCoreInput, top: Recommendation, survival: SeatSurvival | null, run: PositionRun | null): NextPick {
  const { state, askingTeamId, valued, table } = input;
  const entry = valued.get(top.playerId);
  const roster = rosterFor(state, askingTeamId);
  const assigned = assignSlot({ position: top.position, roster, slotConfig: state.config.slotConfig });
  const fillsSlot = assigned.ok ? assigned.slot : null;
  const why = buildWhy(
    {
      position: top.position,
      positionRank: entry?.positionRank ?? 0,
      fillsSlot,
      reasons: top.reasons,
      run,
      ahead: seatsAheadFor(table, state, askingTeamId),
      runs: table.runs,
      mustPick: restrictedPositions(state.config.slotConfig, roster),
    },
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

/**
 * THE PICK THE CARD NAMES. On the clock, the shortlist's first: the odds beside him say what
 * passing costs. Off the clock, the first of the shortlist the runs leave on the board at your
 * turn more often than the reach floor, because a pick you cannot make is not one you should
 * make (persona pass, simplification round: the card kept naming a man at 2 of 100). When every
 * one of them is a reach, the first stands and the number says so.
 */
function pickToName(recommendations: readonly Recommendation[], onTheClock: boolean, survival: SeatSurvival | null): Recommendation | null {
  const first = recommendations[0] ?? null;
  if (first === null || onTheClock || survival === null || survival.runsReached === 0) return first;
  const reachable = recommendations.find((rec) => (survival.survived.get(rec.playerId) ?? 0) / survival.runsReached >= SURVIVAL_BANDS.reach);
  return reachable ?? first;
}

/** The shortlist as the tab shows it: the card's pick first, the rest in the engine's order, at
 *  most `ADVISOR_CONFIG.shortlistSize` (the depth the tab's selector can ask for). */
function candidatesFor(shortlist: readonly Recommendation[], top: Recommendation | null, valued: ReadonlyMap<string, ValuedEntry>): readonly Candidate[] {
  if (top === null) return [];
  const ordered = [top, ...shortlist.filter((rec) => rec.playerId !== top.playerId)].slice(0, ADVISOR_CONFIG.shortlistSize);
  return ordered.map((rec) => {
    const entry = valued.get(rec.playerId);
    return { playerId: rec.playerId, position: rec.position, positionRank: entry?.positionRank ?? 0, valueOverReplacement: entry?.valueOverReplacement ?? 0 };
  });
}

/** `null` only when the asking seat has no further turn to advise. */
export function advisorCore(input: AdvisorCoreInput): AdvisorView | null {
  const { state, askingTeamId, table, tiers, collapses } = input;
  const window = askingWindow(state, askingTeamId);
  if (window === null) return null;
  const onTheClock = teamOnClock(state) === askingTeamId;
  const survival = survivalFor(table, state, askingTeamId);
  const shortlist = input.shortlist ?? recommendNow(input);
  const top = pickToName(shortlist, onTheClock, survival);
  const run = detectRun(state);
  return {
    pickNumber: window.pickNumber,
    onTheClock,
    picksUntilYourTurn: Math.max(0, window.pickNumber - state.pickNumber),
    teamCount: state.draftOrder.length,
    stamp: { computedAtPick: state.pickNumber, sequence: state.sequence },
    runs: table.runs,
    pick: top === null ? null : nextPickFor(input, top, survival, run),
    candidates: candidatesFor(shortlist, top, input.valued),
    signals: { run, collapses },
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
