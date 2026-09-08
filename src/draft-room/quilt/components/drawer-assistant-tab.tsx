"use client";

import { useMemo } from "react";
import type { Player } from "@/domain/player";
import type { DraftStateView } from "@/draft-engine";
import { postPickBeat } from "../../advisor/beat";
import { NextPickCard } from "../../advisor/components/next-pick-card";
import type { UseAdvisorResult } from "../../advisor/use-advisor";
import type { RoomActs } from "./room-acts";

export interface DrawerAssistantTabProps extends Pick<RoomActs, "canDraft" | "submitting" | "onDraft" | "onQueueToggle"> {
  readonly view: DraftStateView;
  readonly myTeamId: string | null;
  /** The room's one advisor fetch (`useAdvisor`, held by the room so the pool rows share it). */
  readonly advisor: UseAdvisorResult;
  readonly playersById: ReadonlyMap<string, Player>;
  /** The manager's own queue, in order, so a queued card can say where it sits. */
  readonly queue: readonly string[];
  readonly byeWeeks: ReadonlyMap<string, number>;
}

const NO_SEAT_COPY = "You have no seat in this draft. The advisor argues for a seat.";
const EMPTY_COPY = "The advisor has nothing to say right now.";
const FETCH_FAILED_COPY = "We could not reach the advisor. It tries again on the next pick.";

/**
 * THE ADVISOR TAB — the one card (spec section 7) over the room's own state, recomputed on every
 * pick event. Draft rides the pool's own pick path (`onDraft` goes through the pick-safety window
 * on the desk and the confirm sheet on the phone, exactly like a pool row); Queue rides the queue
 * that already exists.
 */
export function DrawerAssistantTab({ view, myTeamId, advisor, playersById, queue, byeWeeks, canDraft, submitting, onDraft, onQueueToggle }: DrawerAssistantTabProps) {
  const { view: card, prePickView, recomputing, error } = advisor;
  const queueOrder = useMemo(() => new Map(queue.map((playerId, index) => [playerId, index + 1] as const)), [queue]);

  const beat = useMemo(() => {
    if (prePickView === null) return null;
    const pickedPick = view.picks.find((entry) => entry.pickNumber === prePickView.stamp.computedAtPick);
    if (pickedPick === undefined) return null;
    return postPickBeat({ pickedPlayerId: pickedPick.playerId, prePickView, playerName: (id) => playersById.get(id)?.name ?? id });
  }, [prePickView, view.picks, playersById]);

  if (myTeamId === null) return <p className="text-sm text-text-faint">{NO_SEAT_COPY}</p>;
  if (card === null) {
    const text = recomputing ? "Reading the board." : error !== null ? FETCH_FAILED_COPY : EMPTY_COPY;
    return <p className="text-sm text-text-faint">{text}</p>;
  }

  const player = card.pick === null ? null : (playersById.get(card.pick.playerId) ?? null);
  return (
    <NextPickCard
      view={card}
      acts={{ canDraft, submitting, queueOrder, onDraft, onQueueToggle }}
      player={player}
      byeWeek={player === null ? null : (byeWeeks.get(player.nflTeam) ?? null)}
      recomputing={recomputing}
      beat={beat}
    />
  );
}
