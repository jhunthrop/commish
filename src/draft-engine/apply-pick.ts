import { mustPickLine } from "@/domain/must-pick";
import type { RosterSlot } from "@research/domain/roster";
import { restrictedPositions } from "@research/domain/roster-eligibility";
import { rosterFor, type CompletedPick, type DraftReduceResult, type DraftState } from "./state";
import { roundForPick } from "@research/draft-engine/order";
import { assignSlot } from "@research/draft-engine/slotting";
import { draftedPlayerIds } from "./selectors";

/**
 * The room's line when a pick does not fit (the 2026-09-12 round, founder report: a bench-full
 * roster read "no room on your bench" when the honest sentence names what it CAN still take).
 * With the bench full and starters open, the league says which positions are owed
 * (`mustPickLine`, one sentence shared with the advisor's card and the clock's notice); any other
 * refusal keeps the slotting oracle's own words.
 */
function refusalFor(state: DraftState, roster: readonly RosterSlot[], slottingReason: string): string {
  const owed = restrictedPositions(state.config.slotConfig, roster);
  return owed === null || owed.length === 0 ? slottingReason : mustPickLine(owed);
}

export interface ApplyPickInput {
  readonly teamId: string;
  readonly playerId: string;
  /** Auction winning bid; null for a snake pick. */
  readonly price: number | null;
  readonly auto: boolean;
  readonly timestamp: string;
  /**
   * Overrides `state.pickNumber` (Task 5): a redeemed owed pick fills the SLOT the team was
   * skipped at, never whatever pick is currently on the clock. Absent for every ordinary pick,
   * where the current pick number IS the one being filled — `redeemOwedPick` below is the one
   * caller that ever sets it.
   */
  readonly pickNumber?: number;
}

export type ApplyPickResult =
  | { readonly ok: true; readonly state: DraftState }
  | { readonly ok: false; readonly reason: string };

/**
 * Unwraps an `ApplyPickResult` the caller has already proven can only be `ok`, by an
 * argument specific to that call site (stated in `invariant`) — not a defensive re-check.
 * If the invariant is ever violated (a future regression in `assignSlot`, `bestAvailableFor`,
 * or `checkAffordable` desyncing from this), this throws loudly instead of silently lying to
 * the type system with an unsound cast.
 */
export function expectApplied(result: ApplyPickResult, invariant: string): DraftState {
  if (!result.ok) throw new Error(`Draft engine invariant violated (${invariant}): ${result.reason}`);
  return result.state;
}

/**
 * The one place a player becomes a pick: validates the player is real and undrafted, asks
 * `assignSlot` (which delegates to domain roster rules) where they land, and records both the
 * pick and the roster slot. It does NOT advance the turn — snake and auction advance differently.
 */
export function applyPick(state: DraftState, input: ApplyPickInput): ApplyPickResult {
  const entry = state.pool.find((p) => p.playerId === input.playerId);
  if (entry === undefined) return { ok: false, reason: "That player isn't in this draft's player pool." };
  if (draftedPlayerIds(state).has(input.playerId)) return { ok: false, reason: "That player has already been drafted." };

  const roster = rosterFor(state, input.teamId);
  const assignment = assignSlot({ position: entry.position, roster, slotConfig: state.config.slotConfig });
  if (!assignment.ok) return { ok: false, reason: refusalFor(state, roster, assignment.reason) };

  const pickNumber = input.pickNumber ?? state.pickNumber;
  const round =
    state.config.format === "snake"
      ? roundForPick(state.draftOrder.length, pickNumber)
      : state.picks.filter((p) => p.teamId === input.teamId).length + 1;

  const pick: CompletedPick = {
    pickNumber,
    round,
    teamId: input.teamId,
    playerId: input.playerId,
    slot: assignment.slot,
    slotIndex: assignment.slotIndex,
    price: input.price,
    timestamp: input.timestamp,
    auto: input.auto,
  };

  return {
    ok: true,
    state: {
      ...state,
      picks: [...state.picks, pick],
      rosters: {
        ...state.rosters,
        [input.teamId]: [...roster, { slot: assignment.slot, slotIndex: assignment.slotIndex, playerId: input.playerId }],
      },
    },
  };
}

export interface RedeemOwedPickInput {
  readonly teamId: string;
  readonly playerId: string;
  /** True only when the CATCH-UP clock made this pick, not the owing manager themselves. */
  readonly auto: boolean;
  readonly timestamp: string;
}

/**
 * Fills the EARLIEST pick number `teamId` was skipped at (FIFO — Task 5's answer to "how do
 * multiple owed picks order": whichever one they missed first). Delegates to `applyPick` with
 * that pick number instead of `state.pickNumber`, and drops the redeemed number from
 * `owedPicks` — removing the team's key entirely once its list is empty, never leaving one
 * mapped to `[]`, the invariant `hasOwedPicks`/`catchUpTeamId` (`selectors.ts`) both lean on.
 *
 * Never touches `pickNumber` or `turnStartedAt`: whether this redemption also settles the
 * current turn (a catch-up turn resolving) or leaves it alone entirely (redeeming on somebody
 * else's turn, mid-draft) is `snake.ts`'s call to make, not this function's.
 */
export function redeemOwedPick(state: DraftState, input: RedeemOwedPickInput): DraftReduceResult {
  const owed = state.owedPicks[input.teamId] ?? [];
  const pickNumber = owed[0];
  if (pickNumber === undefined) return { ok: false, reason: "This team doesn't owe a pick." };
  // A friendlier, redemption-specific message: the ordinary "That player has already been
  // drafted." reads as a race against the CURRENT turn, which this pick is never on.
  if (draftedPlayerIds(state).has(input.playerId)) {
    return { ok: false, reason: "Somebody already drafted that player. Pick another." };
  }
  const applied = applyPick(state, { teamId: input.teamId, playerId: input.playerId, price: null, auto: input.auto, timestamp: input.timestamp, pickNumber });
  if (!applied.ok) return applied;

  const remaining = owed.slice(1);
  const owedPicks =
    remaining.length === 0
      ? Object.fromEntries(Object.entries(state.owedPicks).filter(([teamId]) => teamId !== input.teamId))
      : { ...state.owedPicks, [input.teamId]: remaining };

  return { ok: true, state: { ...applied.state, owedPicks } };
}
