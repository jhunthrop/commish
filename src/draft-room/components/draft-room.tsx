"use client";

import { useMemo, useState } from "react";
import type { ClientDraftAction } from "@/draft-engine";
import { Button, ErrorState, Skeleton, useToast } from "@/components/ui";
import { LeagueChat } from "@/chat-room/components/league-chat";
import { useDraftRoom } from "../hooks/use-draft-room";
import { useDraftRoomDeps } from "../hooks/deps";
import { playersById as buildPlayersById } from "../lib/lookups";
import { RoomTour } from "./room-tour";
import { SnakeRoom } from "./snake-room";
import { AuctionRoom } from "./auction-room";

export interface DraftRoomProps {
  readonly draftId: string;
  /**
   * The signed-in caller's preference row, read server-side by `DraftRoomPage`
   * (`readPreferences`) before this component ever mounts — no client-side fetch sits on the
   * room's critical path just to decide whether to show `RoomTour`.
   */
  readonly dismissedAt: string | null;
}

/**
 * The client entry point. Owns the three page-level states (loading / error / ready) and the
 * one place a rejected action becomes a toast — components below never talk to the server.
 */
export function DraftRoom({ draftId, dismissedAt }: DraftRoomProps) {
  const room = useDraftRoom(draftId);
  const deps = useDraftRoomDeps();
  const { show } = useToast();
  const playersById = useMemo(() => buildPlayersById(room.players), [room.players]);
  const [chatOpen, setChatOpen] = useState(true);

  const act = (action: ClientDraftAction): void => {
    void room.submit(action).then((outcome) => {
      if (!outcome.ok) show({ message: outcome.reason, tone: "error" });
    });
  };

  /**
   * Fire-and-forget, by design: `RoomTour` closes on click no matter what this promise does,
   * and swallows even a synchronous throw from it. A failed preference write must never be the
   * thing standing between a manager and a live draft — see `RoomTour`'s own docblock.
   */
  const dismissTour = (): void => {
    void deps
      .fetchJson("/api/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dismissDraftTour: true }),
      })
      .catch(() => {});
  };

  // Loading and error are the only two states that are a PAGE rather than a room, so they are
  // the only two that carry their own padding — the room itself is full-bleed by construction.
  if (room.status === "loading") {
    return (
      <div className="p-4">
        <Skeleton lines={6} />
      </div>
    );
  }
  if (room.status === "error" || room.view === null) {
    return (
      <div className="p-4">
        <ErrorState
          title="We couldn't open this draft"
          description={room.error ?? "Something went wrong on our side."}
          action={<Button onClick={() => void room.refresh()}>Try again</Button>}
        />
      </div>
    );
  }

  // Built here, not inside RoomShell: DraftRoom is the one component that knows the league id
  // and the only one whose test renders a fully-loaded room, so the chat's dependencies enter
  // the tree in exactly one place — the same reason `bidConsole` and `poolFooter` are props.
  // Collapsible on the founder's ask: closed, the band shrinks to a slim reopen strip so the
  // board gets the width back; the closed chat unmounts (its SSE messages are server history,
  // nothing is lost) — reopening refetches, which is the hook's normal mount path.
  const chat = chatOpen ? (
    <div className="flex h-full min-h-0 flex-col lg:w-88">
      <div className="flex shrink-0 justify-end px-3 pt-2">
        <Button variant="ghost" size="sm" aria-expanded="true" onClick={() => setChatOpen(false)}>
          Hide chat
        </Button>
      </div>
      <div className="min-h-0 flex-1 px-3 pb-3">
        <LeagueChat leagueId={room.view.leagueId} />
      </div>
    </div>
  ) : (
    <div className="flex justify-center p-2 lg:h-full lg:w-12 lg:items-start">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded="false"
        onClick={() => setChatOpen(true)}
        className="lg:mt-2 lg:[writing-mode:vertical-rl]"
      >
        Show chat
      </Button>
    </div>
  );

  return (
    <>
      <RoomTour dismissedAt={dismissedAt} onDismiss={dismissTour} />
      {room.view.format === "auction" ? (
        <AuctionRoom room={room} playersById={playersById} onAct={act} aside={chat} />
      ) : (
        <SnakeRoom room={room} playersById={playersById} onAct={act} aside={chat} />
      )}
    </>
  );
}
