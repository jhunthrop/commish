import { rosterFor, type CompletedPick, type DraftState } from "./state";
import { roundForPick } from "./order";
import { assignSlot } from "./slotting";
import { draftedPlayerIds } from "./selectors";

export interface ApplyPickInput {
  readonly teamId: string;
  readonly playerId: string;
  /** Auction winning bid; null for a snake pick. */
  readonly price: number | null;
  readonly auto: boolean;
  readonly timestamp: string;
}

export type ApplyPickResult =
  | { readonly ok: true; readonly state: DraftState }
  | { readonly ok: false; readonly reason: string };

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
  if (!assignment.ok) return { ok: false, reason: assignment.reason };

  const round =
    state.config.format === "snake"
      ? roundForPick(state.draftOrder.length, state.pickNumber)
      : state.picks.filter((p) => p.teamId === input.teamId).length + 1;

  const pick: CompletedPick = {
    pickNumber: state.pickNumber,
    round,
    teamId: input.teamId,
    playerId: input.playerId,
    slot: assignment.slot,
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
