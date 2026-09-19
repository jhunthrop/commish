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
 *
 * ASYNC, AND SINGLE-FLIGHT (draft-room performance round, item 1). The compute now yields to the
 * event loop between simulation chunks, which opens a real window in which a second ask for the
 * same state can arrive; the entry holds the in-flight promise from the moment the compute
 * starts, so every ask during that window awaits the one compute rather than starting another.
 * A compute that fails is forgotten, so the next ask computes again.
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
  /** The facts, or the compute still producing them. */
  readonly facts: Promise<RoomFacts>;
  /** Set once the compute has resolved, for the synchronous `heldRoomFacts` read. */
  settled: RoomFacts | null;
  /** Each seat's own shortlist for this state, filled on that seat's first request (fix round:
   *  `recommendPick` measured 37 to 87 ms per viewer on the real board, and a viewer's
   *  recommendation changes only when the room state or the viewer's roster does, both of which
   *  are inside the sequence). Held as the compute's promise from the moment it starts, so a
   *  second ask for the same seat during its chunked compute awaits the one in flight. */
  readonly shortlists: Map<string, Promise<readonly Recommendation[]>>;
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

function entryFor(draftId: string, sequence: number): Entry | null {
  const held = rooms.get(draftId);
  return held !== undefined && held.sequence === sequence ? held : null;
}

/** The SETTLED facts held for `draftId` at exactly `sequence`, or null: any other sequence, or a
 *  compute still in flight, is a miss for this synchronous read. */
export function heldRoomFacts(draftId: string, sequence: number): RoomFacts | null {
  const held = entryFor(draftId, sequence);
  if (held === null || held.settled === null) return null;
  remember(draftId, held);
  return held.settled;
}

/** Holds facts that were computed elsewhere (a cross-process store read) as this process's own. */
export function rememberRoomFacts(draftId: string, sequence: number, facts: RoomFacts): void {
  remember(draftId, { sequence, facts: Promise.resolve(facts), settled: facts, shortlists: new Map() });
}

/** The facts for `draftId` at `sequence`: held, in flight, or computed once through `compute`. */
export function roomFactsFor(draftId: string, sequence: number, compute: () => Promise<RoomFacts>): Promise<RoomFacts> {
  const held = entryFor(draftId, sequence);
  if (held !== null) {
    remember(draftId, held);
    return held.facts;
  }
  const entry: Entry = { sequence, facts: compute(), settled: null, shortlists: new Map() };
  remember(draftId, entry);
  return entry.facts.then(
    (facts) => {
      entry.settled = facts;
      return facts;
    },
    (error: unknown) => {
      if (rooms.get(draftId) === entry) rooms.delete(draftId);
      throw error;
    },
  );
}

/** One seat's shortlist for `draftId` at `sequence`, computed once per seat per room state and
 *  single-flight while it computes. Asks for a state the room does not hold (the facts must be
 *  asked for first) compute every time. A compute that fails is forgotten. */
export function seatShortlistFor(draftId: string, sequence: number, teamId: string, compute: () => Promise<readonly Recommendation[]>): Promise<readonly Recommendation[]> {
  const held = entryFor(draftId, sequence);
  if (held === null) return compute();
  const known = held.shortlists.get(teamId);
  if (known !== undefined) return known;
  const shortlist = compute().catch((error: unknown) => {
    if (held.shortlists.get(teamId) === shortlist) held.shortlists.delete(teamId);
    throw error;
  });
  held.shortlists.set(teamId, shortlist);
  return shortlist;
}

/** Test seam only. */
export function resetAdvisorMemoForTests(): void {
  rooms.clear();
}
