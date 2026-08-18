"use client";

import { useMemo } from "react";
import { Avatar, Badge, Button, ErrorState, Skeleton } from "@/components/ui";
import { useDraftRoom } from "../hooks/use-draft-room";
import { playersById as buildPlayersById, teamsById } from "../lib/lookups";
import { ClockBanner } from "./clock-banner";
import { PickCelebration } from "./pick-celebration";
import { PickHistory } from "./pick-history";

/**
 * The draft-party board: one URL you open on the laptop plugged into the TV. Read-only by
 * construction — it renders no control of any kind — but still authenticated and still
 * league-authorized by the API behind it. It shares `useDraftRoom` with the real room, so it
 * inherits SSE, gap-refetch and reconnect rather than growing a second data path.
 */
export function TvBoard({ draftId }: { readonly draftId: string }) {
  const room = useDraftRoom(draftId);
  const playersById = useMemo(() => buildPlayersById(room.players), [room.players]);

  if (room.status === "loading") return <Skeleton lines={8} />;
  if (room.status === "error" || room.view === null) {
    return (
      <ErrorState
        title="We couldn't open this board"
        description={room.error ?? "Something went wrong on our side."}
        action={<Button onClick={() => void room.refresh()}>Try again</Button>}
      />
    );
  }

  const view = room.view;
  const teamsMap = teamsById(room.teams);
  const onClock = view.onClockTeamId === null ? null : (teamsMap.get(view.onClockTeamId) ?? null);

  return (
    <div className="flex flex-col gap-6 text-lg">
      <ClockBanner view={view} teams={room.teams} myTeamId={room.myTeamId} playersById={playersById} />
      <PickCelebration lastPick={room.lastPick} playersById={playersById} teams={room.teams} />

      {/* A plain <section>, not <Card>: `data-*` attributes are not part of `CardProps`, and
          the spotlight needs a stable test hook. */}
      <section data-testid="spotlight" className="flex items-center gap-4 rounded-lg border border-border bg-surface-elevated p-6">
        {onClock === null ? null : <Avatar name={onClock.ownerDisplayName} src={onClock.ownerAvatarUrl} size="lg" />}
        <div>
          <p className="text-sm uppercase tracking-wide text-text-muted">On the clock</p>
          <p className="text-3xl font-semibold text-text-primary">{onClock?.name ?? "Nobody"}</p>
          {onClock === null ? null : <Badge tone="neutral">{onClock.ownerDisplayName}</Badge>}
        </div>
      </section>

      <PickHistory
        view={view}
        teams={room.teams}
        playersById={playersById}
        variant="tv"
        emptyAction={<span className="text-text-muted">Waiting for the first pick</span>}
      />
    </div>
  );
}
