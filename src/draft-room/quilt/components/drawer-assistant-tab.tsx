"use client";

import { useMemo } from "react";
import type { TeamCard } from "@/domain/league";
import type { Player } from "@/domain/player";
import type { DraftStateView } from "@/draft-engine";
import type { SeatAhead } from "@/draft-service/assistant/view";
import type { Law } from "@/projections/laws/types";
import { PlayerName } from "@/league-room/components/player-peek";
import { postPickBeat } from "../../advisor/beat";
import { AdvisorPanel } from "../../advisor/components/advisor-panel";
import { changedSinceLines } from "../../advisor/format";
import { planDelta } from "../../advisor/plan-delta";
import { advisorRoomKey, useAdvisor } from "../../advisor/use-advisor";
import { byeCollisionFor, stackNoteFor, type StackCandidate } from "../../assistant/roster-fit";
import type { RoomActs } from "./room-acts";

export interface DrawerAssistantTabProps extends Pick<RoomActs, "canDraft" | "submitting" | "queuedPlayerIds" | "onDraft" | "onQueueToggle"> {
  readonly draftId: string;
  readonly view: DraftStateView;
  readonly myTeamId: string | null;
  readonly teams: readonly TeamCard[];
  readonly playersById: ReadonlyMap<string, Player>;
  /** The manager's own queue, in order, so a queued row can say where it sits. */
  readonly queue: readonly string[];
  readonly byeWeeks: ReadonlyMap<string, number>;
  readonly laws: readonly Law[];
}

const NO_SEAT_COPY = "You have no seat in this draft. The advisor argues for a seat.";
const EMPTY_COPY = "The advisor has nothing to say right now.";
const FETCH_FAILED_COPY = "We could not reach the advisor. It tries again on the next pick.";

function rosterStackCandidates(view: DraftStateView, teamId: string, playersById: ReadonlyMap<string, Player>): readonly StackCandidate[] {
  return (view.rosters[teamId] ?? []).flatMap((slot) => {
    if (slot.playerId === null) return [];
    const player = playersById.get(slot.playerId);
    return player === undefined ? [] : [{ playerId: player.id, name: player.name, position: player.position, nflTeam: player.nflTeam }];
  });
}

/** The bye-cluster and stack notes for the top candidate, kept from the assistant round. */
function rosterFitNotes(top: Player | null, view: DraftStateView, myTeamId: string, playersById: ReadonlyMap<string, Player>, byeWeeks: ReadonlyMap<string, number>, laws: readonly Law[]): readonly string[] {
  if (top === null) return [];
  const roster = rosterStackCandidates(view, myTeamId, playersById);
  const bye = byeCollisionFor(top.nflTeam, byeWeeks, roster.map((player) => player.nflTeam));
  const byeNote = bye === null ? null : `${top.name} shares Bye ${bye.week} with ${bye.count} rostered ${bye.count === 1 ? "player" : "players"}. Drafting him would make it ${bye.wouldMake}.`;
  const stack = stackNoteFor({ playerId: top.id, name: top.name, position: top.position, nflTeam: top.nflTeam }, roster, laws);
  return [byeNote, stack].filter((note): note is string => note !== null);
}

/**
 * THE ADVISOR TAB — the live strategist in the drawer (spec 3.6): three bands over the room's
 * own state, recomputed on every pick event. Draft rides the pool's own pick path (`onDraft`
 * goes through the pick-safety window on the desk and the confirm sheet on the phone, exactly
 * like a pool row); Queue rides the queue that already exists.
 */
export function DrawerAssistantTab({ draftId, view, myTeamId, teams, playersById, queue, byeWeeks, laws, canDraft, submitting, onDraft, onQueueToggle }: DrawerAssistantTabProps) {
  const { view: advisor, previousPlan, prePickView, recomputing, error } = useAdvisor(draftId, advisorRoomKey(view.picks.length, view.pickNumber), myTeamId);

  const queueOrder = useMemo(() => new Map(queue.map((playerId, index) => [playerId, index + 1] as const)), [queue]);
  const teamName = useMemo(() => new Map(teams.map((team) => [team.id, team.name] as const)), [teams]);

  const beat = useMemo(() => {
    if (prePickView === null) return null;
    const pickedPick = view.picks.find((entry) => entry.pickNumber === prePickView.stamp.computedAtPick);
    if (pickedPick === undefined) return null;
    return postPickBeat({ pickedPlayerId: pickedPick.playerId, prePickView, playerName: (id) => playersById.get(id)?.name ?? id });
  }, [prePickView, view.picks, playersById]);

  const changedSince = useMemo(() => {
    if (advisor === null || previousPlan === null) return [];
    const nameOf = (id: string): string => advisor.names[id] ?? id;
    return changedSinceLines(planDelta(previousPlan, advisor.plan), nameOf, advisor.teamCount, (turn) => advisor.plan.turns[turn - 1]?.pickNumber ?? null);
  }, [advisor, previousPlan]);

  if (myTeamId === null) return <p className="text-sm text-text-faint">{NO_SEAT_COPY}</p>;
  if (advisor === null) {
    const text = recomputing ? "Reading the board." : error !== null ? FETCH_FAILED_COPY : EMPTY_COPY;
    return <p className="text-sm text-text-faint">{text}</p>;
  }

  const top = advisor.now[0] === undefined ? null : (playersById.get(advisor.now[0].playerId) ?? null);
  return (
    <AdvisorPanel
      view={advisor}
      acts={{ canDraft, submitting, queueOrder, onDraft, onQueueToggle }}
      renderName={(playerId, name) => <PlayerName leagueId={view.leagueId} playerId={playerId} name={name} className="font-display text-md font-semibold text-text-primary" />}
      seatLabel={(seat: SeatAhead) => teamName.get(seat.teamId) ?? `Seat ${seat.seat}`}
      changedSince={changedSince}
      changedSincePick={previousPlan?.computedAtPick ?? null}
      recomputing={recomputing}
      beat={beat}
      notes={rosterFitNotes(top, view, myTeamId, playersById, byeWeeks, laws)}
    />
  );
}
