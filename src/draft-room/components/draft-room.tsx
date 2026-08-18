"use client";

import { useMemo } from "react";
import type { ClientDraftAction } from "@/draft-engine";
import { Button, ErrorState, Skeleton, useToast } from "@/components/ui";
import { useDraftRoom } from "../hooks/use-draft-room";
import { ConnectionBanner } from "./connection-banner";
import { SnakeRoom } from "./snake-room";
import { AuctionRoom } from "./auction-room";

/**
 * The client entry point. Owns the three page-level states (loading / error / ready) and the
 * one place a rejected action becomes a toast — components below never talk to the server.
 */
export function DraftRoom({ draftId }: { readonly draftId: string }) {
  const room = useDraftRoom(draftId);
  const { show } = useToast();
  const playersById = useMemo(() => new Map(room.players.map((player) => [player.id, player])), [room.players]);

  const act = (action: ClientDraftAction): void => {
    void room.submit(action).then((outcome) => {
      if (!outcome.ok) show({ message: outcome.reason, tone: "error" });
    });
  };

  if (room.status === "loading") return <Skeleton lines={6} />;
  if (room.status === "error" || room.view === null) {
    return (
      <ErrorState
        title="We couldn't open this draft"
        description={room.error ?? "Something went wrong on our side."}
        action={<Button onClick={() => void room.refresh()}>Try again</Button>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ConnectionBanner connection={room.connection} />
      {room.view.format === "auction" ? (
        <AuctionRoom room={room} playersById={playersById} onAct={act} />
      ) : (
        <SnakeRoom room={room} playersById={playersById} onAct={act} />
      )}
    </div>
  );
}
