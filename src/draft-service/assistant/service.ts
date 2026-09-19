/**
 * THE ADVISOR, WITH ITS DB READS — what the assistant route calls: the membership guard, the
 * replayed room state, the evidence board valued once, the room's odds table (memoised per room
 * state, computed on the first request for it), and `advisorCore` for the asking seat.
 *
 * MEMBERSHIP AND SEAT, ONE CONDITION: a stranger and a commissioner with no seat both read as
 * `teamId === null`, and there is nothing to advise.
 *
 * THE WARM (founder report 2026-09-08, the hang): the memo is keyed by the log sequence, so
 * every pick used to leave the next viewer's request a cold compute on the request path. The
 * room's SSE advance loop now calls `warmAdvisorRoom` on every sequence it observes, so the
 * facts for a new state are computed once, in the background, as the pick lands — and the
 * human's own request at their turn reads a warm memo. Both entry points share
 * `roomFactsForState`, so there is exactly one definition of "the room's facts".
 */
import type { Db } from "@/db/client";
import type { DraftState } from "@/draft-engine";
import type { Recommendation } from "@/projections/decide/draft";
import type { LeagueShape } from "@/projections/decide/replacement";
import { getDraftStore, resolveDraftActor } from "@/draft-service";
import { leagueBoardFormat } from "@/league-service/board-format";
import { pickPath } from "@/lib/timing/pick-path";
import { evidencePoolFor } from "../sim/evidence";
import { simulateRoomOdds, type RoomOddsInput, type RoomOddsTable } from "../sim/room-odds";
import { inferSeatDrivers } from "../sim/seat-model";
import { advisorCore, seedFor } from "./advisor";
import { ADVISOR_CONFIG } from "./config";
import { roomFactsFor, seatShortlistFor, type RoomFacts } from "./memo";
import { askingWindow, onClockShortlist, recommendNow, valuedEvidence, type RecommendInput, type ValuedEntry } from "./recommend";
import { tierCollapses } from "./signals";
import { tierStandings } from "./tiers";
import type { AdvisorView } from "./view";

export interface AdvisorServiceDeps {
  /** The sim entry point, injectable so a test can count how often a room state simulates. */
  readonly simulate?: (input: RoomOddsInput) => RoomOddsTable;
  /** The recommendation entry point, injectable for the same reason. */
  readonly recommend?: (input: RecommendInput) => readonly Recommendation[];
}

interface ValuedRoom {
  readonly shape: LeagueShape;
  readonly valued: ReadonlyMap<string, ValuedEntry>;
  readonly facts: RoomFacts;
}

/** The evidence board valued under this room's shape, and the room's facts for exactly this
 *  state — from the memo when held, computed (and remembered) otherwise.
 *
 *  THE LEAGUE'S OWN BOARD (the scoring-formats round, 2026-09-08): the pool is the board the
 *  league's scoring row resolves to (`leagueBoardFormat`; a half-PPR room values the half board),
 *  read here so the warm and the request path value the same board, and no memo ever holds facts
 *  computed on one format and served for another. */
async function roomFactsForState(db: Db, draftId: string, state: DraftState, simulate: (input: RoomOddsInput) => RoomOddsTable): Promise<ValuedRoom> {
  const shape: LeagueShape = { teamCount: state.draftOrder.length, rosterSlots: state.config.slotConfig };
  const board = await leagueBoardFormat(db, state.config.leagueId);
  const { pool } = await evidencePoolFor(db, new Date(), board.source);
  const valued = valuedEvidence(pool, shape);
  const facts = roomFactsFor(draftId, state.sequence, () => ({
    table: simulate({ state, seed: seedFor(draftId, state.sequence), runs: ADVISOR_CONFIG.runs, drivers: inferSeatDrivers(state), excludeFromOnClockSeat: onClockShortlist(state, valued, shape) }),
    tiers: tierStandings(state, valued),
    collapses: tierCollapses(state, valued),
  }));
  return { shape, valued, facts };
}

/**
 * `null` when the caller has no seat to advise, the draft is not `in_progress`, or the seat has
 * no further turn.
 */
export async function advisorFor(db: Db, draftId: string, userId: string, deps: AdvisorServiceDeps = {}): Promise<AdvisorView | null> {
  const simulate = deps.simulate ?? simulateRoomOdds;
  const recommend = deps.recommend ?? recommendNow;
  const actorResult = await resolveDraftActor(db, draftId, userId);
  if (!actorResult.ok) return null;
  const teamId = actorResult.actor.teamId;
  if (teamId === null) return null;

  const state = await getDraftStore().getDraftState(draftId);
  if (state === null || state.phase !== "in_progress") return null;
  if (askingWindow(state, teamId) === null) return null;

  const { shape, valued, facts } = await roomFactsForState(db, draftId, state, simulate);
  const shortlist = seatShortlistFor(draftId, state.sequence, teamId, () => recommend({ state, askingTeamId: teamId, valued, shape, shortlistSize: ADVISOR_CONFIG.shortlistSize }));
  return advisorCore({ state, askingTeamId: teamId, valued, shape, table: facts.table, tiers: facts.tiers, collapses: facts.collapses, shortlist });
}

/**
 * The background warm (module docblock): the room's facts for its CURRENT state, computed into
 * the memo if not already held. No seat, no membership — nothing here is answered to anyone.
 * A draft that is gone or not running is a no-op.
 */
export async function warmAdvisorRoom(db: Db, draftId: string, deps: AdvisorServiceDeps = {}): Promise<void> {
  const state = await getDraftStore().getDraftState(draftId);
  if (state === null || state.phase !== "in_progress") return;
  await pickPath.time("advisor.warm", () => roomFactsForState(db, draftId, state, deps.simulate ?? simulateRoomOdds), { draftId, sequence: state.sequence });
}
