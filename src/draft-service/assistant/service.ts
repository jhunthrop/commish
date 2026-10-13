/**
 * THE ADVISOR, WITH ITS DB READS — what the assistant route calls: the membership guard, the
 * replayed room state, the evidence board valued once, the room's odds table (memoised per room
 * state, computed on the first request for it), and `advisorCore` for the asking seat.
 *
 * MEMBERSHIP AND SEAT, ONE CONDITION: a stranger and a commissioner with no seat both read as
 * `teamId === null`, and there is nothing to advise.
 *
 * WHERE THE FACTS COME FROM (the batched bots round, 2026-09-25). The room's facts for a
 * sequence are computed on the invocation that landed the action (`publishRoomFacts`, fired by
 * the store's post-commit hook after the response has gone) and written to the draft's own row
 * (`facts-store.ts`, one row per draft in Postgres) as well as the process memo; a viewer's
 * `/assistant` request reads the memo, then the row, and computes only when neither holds the
 * sequence it asks for, single-flight per process (`memo.ts`). A pick that batches the bots
 * computes the facts once, for the post-batch state the next human faces, so her dock has its
 * answer the moment her turn is revealed. The simulation itself yields between chunks
 * (`simulateRoomOddsInChunks`), so no invocation holds its loop for a whole table. Both entry
 * points share `roomFactsForState`, so there is exactly one definition of "the room's facts".
 */
import type { Db } from "@research-ts/db/client";
import type { DraftState } from "@/draft-engine";
import type { Recommendation } from "@research-ts/projections/decide/draft";
import type { LeagueShape } from "@research-ts/projections/decide/replacement";
import { getDraftStore, resolveDraftActor } from "@/draft-service";
import { leagueBoardFormat } from "@/league-service/board-format";
import { pickPath } from "@/lib/timing/pick-path";
import { evidencePoolFor } from "../sim/evidence";
import { simulateRoomOddsInChunks, type RoomOddsInput, type RoomOddsTable } from "../sim/room-odds";
import { inferSeatDriversInChunks } from "../sim/seat-model";
import { advisorCore, seedFor } from "./advisor";
import { ADVISOR_CONFIG } from "./config";
import { createDbRoomFactsStore, type FactsKey, type RoomFactsStore } from "./facts-store";
import { roomFactsFor, seatShortlistFor, type RoomFacts } from "./memo";
import { askingWindow, onClockShortlistInChunks, recommendNowInChunks, valuedEvidence, type RecommendInput, type ValuedEntry } from "./recommend";
import { tierCollapses } from "./signals";
import { tierStandings } from "./tiers";
import type { AdvisorView } from "./view";

export interface AdvisorServiceDeps {
  /** The sim entry point, injectable so a test can count how often a room state simulates. Sync
   *  or async: the production one yields between chunks. */
  readonly simulate?: (input: RoomOddsInput) => RoomOddsTable | Promise<RoomOddsTable>;
  /** The recommendation entry point, injectable for the same reason. Sync or async: the
   *  production one scores a chunk of candidates at a time. */
  readonly recommend?: (input: RecommendInput) => readonly Recommendation[] | Promise<readonly Recommendation[]>;
  /** The cross-function facts store (the draft's own row). Defaults to Postgres; tests hand in memory. */
  readonly facts?: RoomFactsStore;
}

let sharedFacts: RoomFactsStore | undefined;

function factsStore(db: Db, deps: AdvisorServiceDeps): RoomFactsStore {
  if (deps.facts !== undefined) return deps.facts;
  sharedFacts ??= createDbRoomFactsStore(db);
  return sharedFacts;
}

/** The facts held for this key in the store, else computed and written for the next reader. */
async function roomFactsStoredOrComputed(store: RoomFactsStore, key: FactsKey, compute: () => Promise<RoomFacts>): Promise<RoomFacts> {
  const held = await store.read(key);
  if (held !== null) return held;
  const facts = await compute();
  await store.write(key, facts);
  return facts;
}

interface ValuedRoom {
  readonly shape: LeagueShape;
  readonly valued: ReadonlyMap<string, ValuedEntry>;
  readonly facts: RoomFacts;
}

const simulateInChunks = (input: RoomOddsInput): Promise<RoomOddsTable> => simulateRoomOddsInChunks(input, { chunkRuns: ADVISOR_CONFIG.simChunkRuns });

/** The evidence board valued under this room's shape, and the room's facts for exactly this
 *  state — from the memo when held (or in flight), computed (and remembered) otherwise.
 *
 *  THE LEAGUE'S OWN BOARD (the scoring-formats round, 2026-09-08): the pool is the board the
 *  league's scoring row resolves to (`leagueBoardFormat`; a half-PPR room values the half board),
 *  read here so every path values the same board, and no memo ever holds facts computed on one
 *  format and served for another. */
async function roomFactsForState(db: Db, draftId: string, state: DraftState, deps: AdvisorServiceDeps): Promise<ValuedRoom> {
  const simulate = deps.simulate ?? simulateInChunks;
  const shape: LeagueShape = { teamCount: state.draftOrder.length, rosterSlots: state.config.slotConfig };
  const board = await leagueBoardFormat(db, state.config.leagueId);
  const { pool } = await evidencePoolFor(db, new Date(), board.source);
  const valued = valuedEvidence(pool, shape);
  // Two levels, one compute: the process memo (single-flight) in front of the draft's own row
  // (read, else compute and write) — a viewer on another function reads what the pick's own
  // invocation wrote, and simulates only when nothing has.
  const key: FactsKey = { draftId, sequence: state.sequence, draftOrder: state.draftOrder };
  // EVERY STAGE YIELDS: the seat drivers one seat at a time, the on-clock shortlist a few
  // candidates at a time, the simulation a few runs at a time, so no stretch of this compute
  // holds the event loop past a chunk, and a request sharing the instance answers between them.
  const facts = await roomFactsFor(draftId, state.sequence, () =>
    roomFactsStoredOrComputed(factsStore(db, deps), key, async () => {
      const drivers = await inferSeatDriversInChunks(state);
      const excludeFromOnClockSeat = await onClockShortlistInChunks(state, valued, shape);
      return {
        table: await simulate({ state, seed: seedFor(draftId, state.sequence), runs: ADVISOR_CONFIG.runs, drivers, excludeFromOnClockSeat }),
        tiers: tierStandings(state, valued),
        collapses: tierCollapses(state, valued),
      };
    }),
  );
  return { shape, valued, facts };
}

/**
 * `null` when the caller has no seat to advise, the draft is not `in_progress`, or the seat has
 * no further turn.
 */
export async function advisorFor(db: Db, draftId: string, userId: string, deps: AdvisorServiceDeps = {}): Promise<AdvisorView | null> {
  const recommend = deps.recommend ?? recommendNowInChunks;
  const actorResult = await resolveDraftActor(db, draftId, userId);
  if (!actorResult.ok) return null;
  const teamId = actorResult.actor.teamId;
  if (teamId === null) return null;

  const state = await getDraftStore().getDraftState(draftId);
  if (state === null || state.phase !== "in_progress") return null;
  if (askingWindow(state, teamId) === null) return null;

  const { shape, valued, facts } = await roomFactsForState(db, draftId, state, deps);
  const shortlist = await seatShortlistFor(draftId, state.sequence, teamId, async () => recommend({ state, askingTeamId: teamId, valued, shape, shortlistSize: ADVISOR_CONFIG.shortlistSize }));
  return advisorCore({ state, askingTeamId: teamId, valued, shape, table: facts.table, tiers: facts.tiers, collapses: facts.collapses, shortlist });
}

/**
 * THE PICK'S OWN COMPUTE (module docblock): the room's facts for `state` — the state the pick
 * just produced, handed in by the store's post-commit hook so nothing is re-read — computed into
 * the memo if not already held. No seat, no membership: nothing here is answered to anyone.
 * Runs after the response has gone (`runAfterResponse`), never on a request's critical path and
 * never on the stream's process. A state that is not running is a no-op.
 */
export async function publishRoomFacts(db: Db, state: DraftState, deps: AdvisorServiceDeps = {}): Promise<void> {
  if (state.phase !== "in_progress") return;
  await pickPath.time("facts.publish", () => roomFactsForState(db, state.config.draftId, state, deps), { draftId: state.config.draftId, sequence: state.sequence });
}

/** `publishRoomFacts` for a draft whose current state is not in hand (tooling, tests). A draft
 *  that is gone is a no-op. */
export async function warmAdvisorRoom(db: Db, draftId: string, deps: AdvisorServiceDeps = {}): Promise<void> {
  const state = await getDraftStore().getDraftState(draftId);
  if (state === null) return;
  await publishRoomFacts(db, state, deps);
}
