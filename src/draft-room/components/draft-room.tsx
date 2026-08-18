"use client";

import { useMemo } from "react";
import type { ClientDraftAction } from "@/draft-engine";
import { Button, ErrorState, Skeleton, useToast } from "@/components/ui";
import { useDraftRoom } from "../hooks/use-draft-room";
import { playersById as buildPlayersById } from "../lib/lookups";
import { SnakeRoom } from "./snake-room";
import { AuctionRoom } from "./auction-room";

/**
 * The client entry point. Owns the three page-level states (loading / error / ready) and the
 * one place a rejected action becomes a toast — components below never talk to the server.
 */
export function DraftRoom({ draftId }: { readonly draftId: string }) {
  const room = useDraftRoom(draftId);
  const { show } = useToast();
  const playersById = useMemo(() => buildPlayersById(room.players), [room.players]);

  const act = (action: ClientDraftAction): void => {
    void room.submit(action).then((outcome) => {
      if (!outcome.ok) show({ message: outcome.reason, tone: "error" });
    });
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

  return room.view.format === "auction" ? (
    <AuctionRoom room={room} playersById={playersById} onAct={act} />
  ) : (
    <SnakeRoom room={room} playersById={playersById} onAct={act} />
  );
}
