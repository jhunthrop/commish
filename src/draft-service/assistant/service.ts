/**
 * THE ADVISOR, WITH ITS DB READS — what the assistant route calls: the membership guard, the
 * replayed room state, the evidence board valued once, the room's odds table (memoised per room
 * state, computed on the first request for it), and `advisorCore` for the asking seat.
 *
 * MEMBERSHIP AND SEAT, ONE CONDITION: a stranger and a commissioner with no seat both read as
 * `teamId === null`, and there is nothing to advise.
 */
import type { Db } from "@/db/client";
import type { LeagueShape } from "@/projections/decide/replacement";
import { getDraftStore, resolveDraftActor } from "@/draft-service";
import { evidencePoolFor } from "../sim/evidence";
import { simulateRoomOdds, type RoomOddsInput, type RoomOddsTable } from "../sim/room-odds";
import { inferSeatDrivers } from "../sim/seat-model";
import { advisorCore, seedFor } from "./advisor";
import { ADVISOR_CONFIG } from "./config";
import { roomTableFor } from "./memo";
import { askingWindow, onClockShortlist, valuedEvidence } from "./recommend";
import type { AdvisorView } from "./view";

export interface AdvisorServiceDeps {
  /** The sim entry point, injectable so a test can count how often a room state simulates. */
  readonly simulate?: (input: RoomOddsInput) => RoomOddsTable;
}

/**
 * `null` when the caller has no seat to advise, the draft is not `in_progress`, or the seat has
 * no further turn.
 */
export async function advisorFor(db: Db, draftId: string, userId: string, deps: AdvisorServiceDeps = {}): Promise<AdvisorView | null> {
  const simulate = deps.simulate ?? simulateRoomOdds;
  const actorResult = await resolveDraftActor(db, draftId, userId);
  if (!actorResult.ok) return null;
  const teamId = actorResult.actor.teamId;
  if (teamId === null) return null;

  const state = await getDraftStore().getDraftState(draftId);
  if (state === null || state.phase !== "in_progress") return null;
  if (askingWindow(state, teamId) === null) return null;

  const shape: LeagueShape = { teamCount: state.draftOrder.length, rosterSlots: state.config.slotConfig };
  const { pool } = await evidencePoolFor(db);
  const valued = valuedEvidence(pool, shape);
  const table = roomTableFor(draftId, state.sequence, () =>
    simulate({ state, seed: seedFor(draftId, state.sequence), runs: ADVISOR_CONFIG.runs, drivers: inferSeatDrivers(state), excludeFromOnClockSeat: onClockShortlist(state, valued, shape) }),
  );
  return advisorCore({ state, askingTeamId: teamId, valued, shape, table });
}
