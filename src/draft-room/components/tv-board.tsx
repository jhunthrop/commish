"use client";

import { useMemo } from "react";
import type { CountdownTone } from "@/components/ui/countdown";
import { Avatar, Badge, Button, ErrorState, PositionBadge, Skeleton } from "@/components/ui";
import { Countdown, useCountdown } from "@/components/ui/countdown";
import { DRAFT_ROOM_CONFIG } from "../state/config";
import { useDraftRoom } from "../hooks/use-draft-room";
import { playersById as buildPlayersById, teamsById } from "../lib/lookups";
import { DraftBoard } from "./draft-board";
import { PickCelebration } from "./pick-celebration";
import { PickWire } from "./pick-wire";
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
/**
 * The party clock's tone rule (review E5), as arithmetic a test can pin at the exact boundary:
 * hot at `hotThresholdMs` remaining ON THE NOSE (`<=`, so 30,000ms is hot and 30,001 is calm),
 * calm with no clock at all. Time-based, never mine-based — a TV has no "me", and rule 1 says
 * a clock in its final seconds is red for everyone in the room.
 */
export function spotlightClockTone(remainingMs: number | null): CountdownTone {
  return remainingMs !== null && remainingMs <= DRAFT_ROOM_CONFIG.tv.hotThresholdMs ? "hot" : "default";
}

export function TvBoard({ draftId }: { readonly draftId: string }) {
  const room = useDraftRoom(draftId);
  const playersById = useMemo(() => buildPlayersById(room.players), [room.players]);
  // Task 2 (review E5/E6): the spotlight band's own clock — the same `useCountdown` the rail
  // itself uses for the pick deadline, never a second clock source. Called unconditionally,
  // before either early return below, per React's Rules of Hooks; `room.view` is null while
  // loading or on error, so the deadline reads null right along with it.
  const { remainingMs } = useCountdown(room.view?.deadlineAt ?? null);

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
  // Rule 1: clocks and live are the negative family — the band's clock goes hot for everyone in
  // the final `DRAFT_ROOM_CONFIG.tv.hotThresholdMs`, the same way the room rail's own countdown
  // goes hot for whoever's turn it is (`turnSummary`'s `mine`). A TV has no "me", so the trigger
  // here is time, not identity.
  const spotlightHot = spotlightClockTone(remainingMs) === "hot";
  const lastPick = room.lastPick;
  const lastPickPlayer = lastPick === null ? null : (playersById.get(lastPick.pick.playerId) ?? null);

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
        waiting={room.waiting}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-6 lg:overflow-hidden">
        <PickCelebration lastPick={room.lastPick} playersById={playersById} teams={room.teams} />

        {/* A plain <section>, not <Card>: `data-*` attributes are not part of `CardProps`, and
            the spotlight needs a stable test hook. Its label is "Now picking", not "On the
            clock": the rail above already carries that phrase, and saying the same thing twice
            on one screen is what made the old room feel confusing. What this panel adds is the
            FACE — the owner's portrait, readable across a room.
            Task 2 (review E6): the band folds in the two facts that used to sit elsewhere on the
            TV — the countdown (E5, moved out of the rail entirely, see `RoomRail`) and the last
            pick landed, restated quietly at glance scale. This is the TV's one dense fact-band
            now, not a mostly-empty restatement of the rail. */}
        <section data-testid="spotlight" className="flex shrink-0 items-center gap-4 rounded-lg border border-line bg-surface-elevated p-6 shadow-card">
          {onClock === null ? null : <Avatar name={onClock.ownerDisplayName} avatar={onClock.ownerAvatarUrl} size="lg" />}
          <div className="min-w-0 flex-1">
            <p className="font-display text-sm tracking-wide text-text-muted">Now picking</p>
            <p className="font-display text-display-lg font-semibold leading-display text-text-primary">{onClock?.name ?? "Nobody"}</p>
            {onClock === null ? null : <Badge tone="neutral">{onClock.ownerDisplayName}</Badge>}
          </div>
          <div className="ml-auto flex flex-col items-end gap-1">
            {remainingMs === null ? null : (
              <Countdown remainingMs={remainingMs} size="lg" tone={spotlightHot ? "hot" : "default"} data-testid="spotlight-countdown" />
            )}
            {/* The wire underneath already carries the newest pick's ink (`PickWire`'s own
                docblock); this is a restatement at glance scale, so the player name stays
                muted rather than repeating that emphasis — one fact earns ink per view.
                Skipped, same as `PickWire`'s own `wireEntries`, when the player id hasn't
                resolved yet (a resync gap) — never a guessed name or a `RosterSlotType` value
                (which includes FLEX/BENCH) masquerading as a `PositionBadge`'s `Position`. */}
            {lastPick === null || lastPickPlayer === null ? null : (
              <div className="flex items-center gap-2">
                {/* Founder directive 2026-08-26 ("why aren't we showing the players picture?"):
                    the same face-beside-name pattern the onClock owner already gets above, at
                    the spotlight's own `lg` size — decorative, the name text beside it already
                    says who this is. */}
                <Avatar name={lastPickPlayer.name} avatar={lastPickPlayer.headshotUrl} size="lg" />
                <p data-testid="spotlight-last-pick" className="flex items-center gap-1 whitespace-nowrap text-sm text-text-muted">
                  {`#${lastPick.pick.pickNumber} ${lastPickPlayer.name}`}
                  <PositionBadge position={lastPickPlayer.position} size="sm" />
                </p>
              </div>
            )}
          </div>
        </section>

        {/* R1 (2026-08-26 design review): the same band the room runs, at the TV's own scale —
            the crowd across the room gets the draft's recent history without a second glance
            at a laptop. */}
        <PickWire view={view} teams={room.teams} playersById={playersById} players={room.players} variant="tv" />

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
