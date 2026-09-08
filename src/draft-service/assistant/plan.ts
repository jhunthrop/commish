/**
 * THE PLAN: YOUR NEXT THREE TURNS — spec 3.1 and 3.1a. For each of the asking seat's next
 * `horizon` turns: the position the plan targets (roster need under the league's shape, the same
 * need term the autopick scores with, times the value curve), two or three named targets with
 * their survival at every turn the simulator reached, and the fallback if they go.
 *
 * ODDS ARE THE SIMULATOR'S OWN FREQUENCIES. `horizonOdds` runs seeded continuations of the live
 * room once for the whole candidate pool; nothing here estimates survival any other way. A
 * target under `reachFloor` at a turn is a REACH there: the plan places him at the earliest turn
 * he clears it, or leaves him out. A turn beyond the draft's end does not exist.
 *
 * `planDelta` is the "changed since" line: what moved between the plan the manager last saw and
 * this one, by a stated band.
 */
import type { Position } from "@/domain/player";
import type { RosterSlot } from "@/domain/roster";
import { AUTOPICK_CONFIG, assignSlot, needMultiplier, roundForPick, rosterFor, type DraftAutopickPolicy, type DraftState } from "@/draft-engine";
import { deferredLateRoundPosition } from "@/draft-engine/scoring";
import { compareBoardOrder } from "@/projections/decide/board-order-compare";
import { draftedPlayerIds } from "@/draft-engine";
import { horizonOdds, type HorizonOddsResult, type TurnOdds } from "../sim/horizon-odds";
import type { SeatDrivers } from "../sim/seat-model";
import type { ValuedEntry } from "./call";
import { ADVISOR_CONFIG } from "./config";
import type { DraftPlan, OddsCell, PlanTarget, PlanTurn } from "./view";

export interface PlanInput {
  readonly state: DraftState;
  readonly askingTeamId: string;
  readonly valued: ReadonlyMap<string, ValuedEntry>;
  readonly seed: number;
  readonly drivers?: SeatDrivers;
  readonly runs?: number;
  readonly horizon?: number;
}

export interface PlanResult {
  readonly plan: DraftPlan;
  /** The runs behind the plan, so the signals strip reads the seats ahead from the SAME runs. */
  readonly odds: HorizonOddsResult;
}

/** The undrafted board in the one order every board is served in, capped to the plan's pool. */
function candidatePool(state: DraftState, valued: ReadonlyMap<string, ValuedEntry>): readonly ValuedEntry[] {
  const drafted = draftedPlayerIds(state);
  return [...valued.values()]
    .filter((entry) => !drafted.has(entry.playerId))
    .sort((a, b) =>
      compareBoardOrder(
        { playerId: a.playerId, valueOverReplacement: a.valueOverReplacement, marketAdp: a.averageDraftPosition, rank: a.positionRank },
        { playerId: b.playerId, valueOverReplacement: b.valueOverReplacement, marketAdp: b.averageDraftPosition, rank: b.positionRank },
      ),
    )
    .slice(0, ADVISOR_CONFIG.plan.candidatePoolSize);
}

function oddsCell(turn: TurnOdds | undefined, playerId: string): OddsCell | null {
  const survival = turn?.survival.get(playerId);
  return turn === undefined || survival === undefined ? null : { survival, runs: turn.runsReached };
}

function targetFor(entry: ValuedEntry, turns: readonly TurnOdds[], reachFloor: number): PlanTarget {
  const oddsByTurn = turns.map((turn) => oddsCell(turn, entry.playerId));
  const reachIndex = oddsByTurn.findIndex((cell) => cell !== null && cell.survival < reachFloor);
  return {
    playerId: entry.playerId,
    position: entry.position,
    valueOverReplacement: entry.valueOverReplacement,
    positionRank: entry.positionRank,
    oddsByTurn,
    reachFromTurn: reachIndex === -1 ? null : reachIndex + 1,
  };
}

function rosteredCountsByPosition(roster: readonly RosterSlot[], state: DraftState): ReadonlyMap<Position, number> {
  const positionOf = new Map(state.pool.map((entry) => [entry.playerId, entry.position] as const));
  const counts = new Map<Position, number>();
  for (const slot of roster) {
    const position = slot.playerId === null ? undefined : positionOf.get(slot.playerId);
    if (position !== undefined) counts.set(position, (counts.get(position) ?? 0) + 1);
  }
  return counts;
}

/** The autopick's own need term for `position` against a projected roster, at full ramp. */
function needFor(position: Position, roster: readonly RosterSlot[], state: DraftState, policy: DraftAutopickPolicy, planned: ReadonlyMap<Position, number>): number {
  const rostered = (rosteredCountsByPosition(roster, state).get(position) ?? 0) + (planned.get(position) ?? 0);
  return needMultiplier(position, roster, state.config.slotConfig, {
    openSlotBoost: policy.needPerOpenStartingSlot,
    filledDamp: policy.startersFilledDamp,
    surplusDamp: policy.surplusDamp,
    rosteredAtPosition: rostered,
  });
}

interface TurnChoice {
  readonly position: Position;
  readonly targets: readonly ValuedEntry[];
  readonly fallback: ValuedEntry | null;
}

function surviving(turn: TurnOdds, floor: number, pool: readonly ValuedEntry[]): readonly ValuedEntry[] {
  return pool.filter((entry) => (turn.survival.get(entry.playerId) ?? 0) >= floor);
}

/** The position with the best need-times-value among candidates that clear the reach floor at
 *  this turn, and its targets and fallback. Null when nothing legal clears the floor. */
function chooseTurn(
  state: DraftState,
  turn: TurnOdds,
  pool: readonly ValuedEntry[],
  taken: ReadonlySet<string>,
  roster: readonly RosterSlot[],
  policy: DraftAutopickPolicy,
  planned: ReadonlyMap<Position, number>,
): TurnChoice | null {
  const { reachFloor, fallbackFloor, targetsPerTurn } = ADVISOR_CONFIG.plan;
  const open = pool.filter((entry) => !taken.has(entry.playerId));
  const eligible = surviving(turn, reachFloor, open);
  let best: { readonly score: number; readonly choice: TurnChoice } | null = null;
  for (const position of new Set(eligible.map((entry) => entry.position))) {
    if (!assignSlot({ position, roster, slotConfig: state.config.slotConfig }).ok) continue;
    if (deferredLateRoundPosition(position, roster, state.config.slotConfig, policy.lateRoundOnlyRoundsFromEnd)) continue;
    const atPosition = eligible.filter((entry) => entry.position === position);
    const score = needFor(position, roster, state, policy, planned) * Math.max(0, atPosition[0]!.valueOverReplacement);
    if (best !== null && score <= best.score) continue;
    const targets = atPosition.slice(0, targetsPerTurn);
    const fallback = surviving(turn, fallbackFloor, open.filter((entry) => entry.position === position && !targets.includes(entry)))[0] ?? null;
    best = { score, choice: { position, targets, fallback } };
  }
  return best?.choice ?? null;
}

function projectRoster(roster: readonly RosterSlot[], position: Position, state: DraftState): readonly RosterSlot[] {
  const assigned = assignSlot({ position, roster, slotConfig: state.config.slotConfig });
  return assigned.ok ? [...roster, { slot: assigned.slot, slotIndex: assigned.slotIndex, playerId: null }] : roster;
}

/** See the module docblock. `odds` is returned beside the plan so the signals strip reads the
 *  seats ahead from the same runs rather than paying for a second simulation. */
export function computePlan(input: PlanInput): PlanResult {
  const { state, askingTeamId, valued, seed, drivers } = input;
  const runs = input.runs ?? ADVISOR_CONFIG.plan.runs;
  const horizon = input.horizon ?? ADVISOR_CONFIG.plan.horizon;
  const { reachFloor } = ADVISOR_CONFIG.plan;
  const pool = candidatePool(state, valued);
  const odds = horizonOdds({ state, askingTeamId, targetIds: pool.map((entry) => entry.playerId), seed, runs, horizon, drivers });
  const policy = state.config.autopick ?? AUTOPICK_CONFIG;

  const turns: PlanTurn[] = [];
  let roster = rosterFor(state, askingTeamId);
  let taken: ReadonlySet<string> = new Set();
  let planned: ReadonlyMap<Position, number> = new Map();
  for (const turn of odds.turns) {
    const choice = chooseTurn(state, turn, pool, taken, roster, policy, planned);
    if (choice === null) break;
    turns.push({
      turn: turn.turn,
      pickNumber: turn.pickNumber,
      round: roundForPick(state.draftOrder.length, turn.pickNumber),
      position: choice.position,
      targets: choice.targets.map((entry) => targetFor(entry, odds.turns, reachFloor)),
      fallback: choice.fallback === null ? null : targetFor(choice.fallback, odds.turns, reachFloor),
    });
    roster = projectRoster(roster, choice.position, state);
    taken = new Set([...taken, ...choice.targets.map((entry) => entry.playerId)]);
    planned = new Map([...planned, [choice.position, (planned.get(choice.position) ?? 0) + 1]]);
  }

  return { plan: { computedAtPick: state.pickNumber, runs, horizon, reachFloor, turns }, odds };
}

export type PlanChange =
  | { readonly kind: "odds_moved"; readonly playerId: string; readonly turn: number; readonly from: number; readonly to: number }
  | { readonly kind: "left_plan"; readonly playerId: string; readonly turn: number };

function targetsByTurn(plan: DraftPlan): ReadonlyMap<string, { readonly turn: number; readonly target: PlanTarget }> {
  return new Map(plan.turns.flatMap((turn) => turn.targets.map((target) => [target.playerId, { turn: turn.turn, target }] as const)));
}

/** What changed between the plan the manager last saw and the current one: a named target
 *  whose odds at his own turn moved by more than the band, or one no longer on the plan. */
export function planDelta(previous: DraftPlan, current: DraftPlan): readonly PlanChange[] {
  const band = ADVISOR_CONFIG.plan.changedOddsBand;
  const now = targetsByTurn(current);
  const changes: PlanChange[] = [];
  for (const [playerId, { turn, target }] of targetsByTurn(previous)) {
    const latest = now.get(playerId);
    if (latest === undefined) {
      changes.push({ kind: "left_plan", playerId, turn });
      continue;
    }
    const from = target.oddsByTurn[turn - 1]?.survival;
    const to = latest.target.oddsByTurn[latest.turn - 1]?.survival;
    if (from !== undefined && to !== undefined && Math.abs(to - from) > band) changes.push({ kind: "odds_moved", playerId, turn: latest.turn, from, to });
  }
  return changes;
}
