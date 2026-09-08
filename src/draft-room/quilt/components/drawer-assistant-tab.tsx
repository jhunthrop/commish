"use client";

import { useMemo } from "react";
import type { Player } from "@/domain/player";
import { AdvisorPanel } from "../../advisor/components/advisor-panel";
import type { UseAdvisorResult } from "../../advisor/use-advisor";
import type { RoomActs } from "./room-acts";

export interface DrawerAssistantTabProps extends Pick<RoomActs, "canDraft" | "submitting" | "onDraft" | "onQueueToggle"> {
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
 * THE ADVISOR TAB — the advisor panel (spec section 7, the pick count round) over the room's own
 * state, recomputed on every pick event. Draft rides the pool's own pick path (`onDraft` goes
 * through the pick-safety window on the desk and the confirm sheet on the phone, exactly like a
 * pool row); Queue rides the queue that already exists. The tab is its own scroll area, so the
 * lead card's verb can stick to its bottom edge on a screen too short for the card.
 */
export function DrawerAssistantTab({ myTeamId, advisor, playersById, queue, byeWeeks, canDraft, submitting, onDraft, onQueueToggle }: DrawerAssistantTabProps) {
  const { view, recomputing, error } = advisor;
  const queueOrder = useMemo(() => new Map(queue.map((playerId, index) => [playerId, index + 1] as const)), [queue]);

  if (myTeamId === null) return <p className="text-sm text-text-faint">{NO_SEAT_COPY}</p>;
  if (view === null) {
    const text = recomputing ? "Reading the board." : error !== null ? FETCH_FAILED_COPY : EMPTY_COPY;
    return <p className="text-sm text-text-faint">{text}</p>;
  }

  return (
    <div data-testid="assistant-tab" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <AdvisorPanel view={view} acts={{ canDraft, submitting, queueOrder, onDraft, onQueueToggle }} playersById={playersById} byeWeeks={byeWeeks} recomputing={recomputing} />
    </div>
  );
}
