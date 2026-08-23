"use client";

import { useMemo } from "react";
import { Avatar, Badge, Button, ErrorState, Skeleton } from "@/components/ui";
import { useDraftRoom } from "../hooks/use-draft-room";
import { playersById as buildPlayersById, teamsById } from "../lib/lookups";
import { DraftBoard } from "./draft-board";
import { PickCelebration } from "./pick-celebration";
import { RoomRail } from "./room-rail";

/**
 * The draft-party board: one URL you open on the laptop plugged into the TV. Read-only by
 * construction — it renders no control of any kind — but still authenticated and still
 * league-authorized by the API behind it. It shares `useDraftRoom` with the real room, so it
 * inherits SSE, gap-refetch and reconnect rather than growing a second data path.
 *
 * It is the room's stage, alone: the rail (without a shred of personal chrome — no team chip,
 * no my-turn heat) and the board. No pool, no dock, because nobody acts from across a room.
 */
export function TvBoard({ draftId }: { readonly draftId: string }) {
  const room = useDraftRoom(draftId);
  const playersById = useMemo(() => buildPlayersById(room.players), [room.players]);

  if (room.status === "loading") {
    return (
      <div className="p-6">
        <Skeleton lines={8} />
      </div>
    );
  }
  if (room.status === "error" || room.view === null) {
    return (
      <div className="p-6">
        <ErrorState
          title="We couldn't open this board"
          description={room.error ?? "Something went wrong on our side."}
          action={<Button onClick={() => void room.refresh()}>Try again</Button>}
        />
      </div>
    );
  }

  const view = room.view;
  const teamsMap = teamsById(room.teams);
  const onClock = view.onClockTeamId === null ? null : (teamsMap.get(view.onClockTeamId) ?? null);

  return (
    <div className="flex min-h-dvh flex-col text-lg lg:h-dvh lg:min-h-0 lg:overflow-hidden">
      <RoomRail
        leagueName={room.leagueName}
        view={view}
        teams={room.teams}
        myTeamId={room.myTeamId}
        playersById={playersById}
        connection={room.connection}
        variant="tv"
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-6 lg:overflow-hidden">
        <PickCelebration lastPick={room.lastPick} playersById={playersById} teams={room.teams} />

        {/* A plain <section>, not <Card>: `data-*` attributes are not part of `CardProps`, and
            the spotlight needs a stable test hook. Its label is "Now picking", not "On the
            clock": the rail above already carries that phrase and the countdown, and saying
            the same thing twice on one screen is what made the old room feel confusing. What
            this panel adds is the FACE — the owner's portrait, readable across a room. */}
        <section data-testid="spotlight" className="flex shrink-0 items-center gap-4 rounded-lg border border-line bg-surface-elevated p-6 shadow-card">
          {onClock === null ? null : <Avatar name={onClock.ownerDisplayName} avatar={onClock.ownerAvatarUrl} size="lg" />}
          <div>
            <p className="font-display text-sm uppercase tracking-wide text-text-muted">Now picking</p>
            <p className="font-display text-display-lg font-bold leading-display text-text-primary">{onClock?.name ?? "Nobody"}</p>
            {onClock === null ? null : <Badge tone="neutral">{onClock.ownerDisplayName}</Badge>}
          </div>
        </section>

        <DraftBoard
          view={view}
          teams={room.teams}
          playersById={playersById}
          myTeamId={room.myTeamId}
          landedPickNumber={room.lastPick?.pick.pickNumber ?? null}
          variant="tv"
        />
      </div>
    </div>
  );
}
