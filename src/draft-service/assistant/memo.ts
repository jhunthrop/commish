/**
 * THE ROOM TABLE MEMO — one odds table per room state, remembered so twelve viewers of one room
 * cost one simulation and a room nobody has open costs nothing (the founder's cost ruling,
 * simplification round). Keyed by draft id: a request for a NEWER sequence of the same draft
 * replaces the room's entry (the old state can never be asked for again), and the least-recently
 * computed room is evicted past `ADVISOR_CONFIG.memoRooms`.
 *
 * A bounded, per-instance cache BY DESIGN (the immutability rule's one sanctioned shape): the
 * table must outlive the request that computed it. A miss is a recompute, never a wrong answer.
 */
import type { RoomOddsTable } from "../sim/room-odds";
import { ADVISOR_CONFIG } from "./config";

interface Entry {
  readonly sequence: number;
  readonly table: RoomOddsTable;
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

/** The table for `draftId` at `sequence`, computed through `compute` only when it is not held. */
export function roomTableFor(draftId: string, sequence: number, compute: () => RoomOddsTable): RoomOddsTable {
  const held = rooms.get(draftId);
  if (held !== undefined && held.sequence === sequence) {
    remember(draftId, held);
    return held.table;
  }
  const table = compute();
  remember(draftId, { sequence, table });
  return table;
}

/** Test seam only. */
export function resetAdvisorMemoForTests(): void {
  rooms.clear();
}
