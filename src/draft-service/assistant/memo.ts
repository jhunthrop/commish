/**
 * THE ROOM FACTS MEMO — everything about one room state that no seat owns (the odds table and
 * the tier standings), remembered so twelve viewers of one room cost one simulation and a room
 * nobody has open costs nothing (the founder's cost ruling, simplification round). Keyed by
 * draft id: a request for a NEWER sequence of the same draft replaces the room's entry (the old
 * state can never be asked for again), and the least-recently computed room is evicted past
 * `ADVISOR_CONFIG.memoRooms`.
 *
 * A bounded, per-instance cache BY DESIGN (the immutability rule's one sanctioned shape): the
 * facts must outlive the request that computed them. A miss is a recompute, never a wrong answer.
 */
import type { RoomOddsTable } from "../sim/room-odds";
import { ADVISOR_CONFIG } from "./config";
import type { TierStandingView } from "./view";

export interface RoomFacts {
  readonly table: RoomOddsTable;
  readonly tiers: Readonly<Record<string, TierStandingView>>;
}

interface Entry {
  readonly sequence: number;
  readonly facts: RoomFacts;
}

const rooms = new Map<string, Entry>();

function remember(draftId: string, entry: Entry): void {
  rooms.delete(draftId);
  rooms.set(draftId, entry);
  while (rooms.size > ADVISOR_CONFIG.memoRooms) {
    const oldest = rooms.keys().next().value;
    if (oldest === undefined) break;
    rooms.delete(oldest);
  }
}

/** The facts for `draftId` at `sequence`, computed through `compute` only when they are not held. */
export function roomFactsFor(draftId: string, sequence: number, compute: () => RoomFacts): RoomFacts {
  const held = rooms.get(draftId);
  if (held !== undefined && held.sequence === sequence) {
    remember(draftId, held);
    return held.facts;
  }
  const facts = compute();
  remember(draftId, { sequence, facts });
  return facts;
}

/** Test seam only. */
export function resetAdvisorMemoForTests(): void {
  rooms.clear();
}
