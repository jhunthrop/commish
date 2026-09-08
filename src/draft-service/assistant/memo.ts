/**
 * THE ROOM FACTS MEMO — everything about one room state that no seat owns (the odds table, the
 * tier standings and the tier collapses), remembered so twelve viewers of one room cost one simulation and a room
 * nobody has open costs nothing (the founder's cost ruling, simplification round). Keyed by
 * draft id: a request for a NEWER sequence of the same draft replaces the room's entry (the old
 * state can never be asked for again), and the least-recently computed room is evicted past
 * `ADVISOR_CONFIG.memoRooms`.
 *
 * A bounded, per-instance cache BY DESIGN (the immutability rule's one sanctioned shape): the
 * facts must outlive the request that computed them. A miss is a recompute, never a wrong answer.
 */
import type { Recommendation } from "@/projections/decide/draft";
import type { RoomOddsTable } from "../sim/room-odds";
import { ADVISOR_CONFIG } from "./config";
import type { TierCollapse, TierStandingView } from "./view";

export interface RoomFacts {
  readonly table: RoomOddsTable;
  readonly tiers: Readonly<Record<string, TierStandingView>>;
  /** The strip's tier collapses (`signals.ts`), a fact about the room, not the viewer. */
  readonly collapses: readonly TierCollapse[];
}

interface Entry {
  readonly sequence: number;
  readonly facts: RoomFacts;
  /** Each seat's own shortlist for this state, filled on that seat's first request (fix round:
   *  `recommendPick` measured 37 to 87 ms per viewer on the real board, and a viewer's
   *  recommendation changes only when the room state or the viewer's roster does, both of which
   *  are inside the sequence). */
  readonly shortlists: Map<string, readonly Recommendation[]>;
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
  remember(draftId, { sequence, facts, shortlists: new Map() });
  return facts;
}

/** One seat's shortlist for `draftId` at `sequence`, computed once per seat per room state. Asks
 *  for a state the room does not hold (the facts must be asked for first) compute every time. */
export function seatShortlistFor(draftId: string, sequence: number, teamId: string, compute: () => readonly Recommendation[]): readonly Recommendation[] {
  const held = rooms.get(draftId);
  if (held === undefined || held.sequence !== sequence) return compute();
  const known = held.shortlists.get(teamId);
  if (known !== undefined) return known;
  const shortlist = compute();
  held.shortlists.set(teamId, shortlist);
  return shortlist;
}

/** Test seam only. */
export function resetAdvisorMemoForTests(): void {
  rooms.clear();
}
