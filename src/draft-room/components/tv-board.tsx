"use client";

import { useMemo } from "react";
import type { CountdownTone } from "@/components/ui/countdown";
import { Avatar, Button, ErrorState, LowerThird, Skeleton, type LowerThirdCell } from "@/components/ui";
import { formatCoarseRemaining, formatCountdown, useCountdown } from "@/components/ui/countdown";
import { DRAFT_ROOM_CONFIG } from "../state/config";
import { rosterSpots } from "../state/format";
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
 * calm with no clock at all. Time-based, never mine-based — a TV has no "me", and a clock in its
 * final seconds is urgent for everyone in the room.
 *
 * SUNDAY v5 CHANGED WHAT IT SPENDS, not when it fires. The party clock is now ALWAYS drawn in the
 * live channel (a running draft clock is the purest "happening right now" this product has), so
 * "hot" can no longer be a colour step — there is nowhere redder for it to go. It spends the
 * micro-label instead: the strip's clock cell renames itself "Final seconds", which reads across a
 * room at a glance and survives a viewer who cannot tell the two reds apart anyway.
 */
export function spotlightClockTone(remainingMs: number | null): CountdownTone {
  return remainingMs !== null && remainingMs <= DRAFT_ROOM_CONFIG.tv.hotThresholdMs ? "hot" : "default";
}

/**
 * The TV's own sizes inside the shared `LowerThird` anatomy. The primitive draws a cell value at
 * `text-xl` and its clock at `text-display-lg`, which is right for a laptop and small for a wall:
 * law 3 is "readable from the sofa", and this surface is the one where the sofa is literal. The
 * value slot is a `ReactNode` precisely so a caller can spend its own scale inside it — the same
 * carve-out `RoomRail`'s `RAIL_EYEBROW`/`LEAGUE_TEXT` maps already make for this variant, and it
 * reaches no shared primitive's internals to do it.
 */
const TV_VALUE = "font-display text-display-lg font-extrabold leading-display";
const TV_CLOCK = "font-display text-display-2xl font-extrabold leading-none tabular-nums";

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
  // The final `DRAFT_ROOM_CONFIG.tv.hotThresholdMs` renames the clock's own micro-label rather
  // than recolouring digits that are already in the live channel — see `spotlightClockTone`.
  const spotlightHot = spotlightClockTone(remainingMs) === "hot";
  // The room's whole shape, from the payload: one pick per roster spot per seat.
  const totalPicks = view.draftOrder.length * rosterSpots(view.slotConfig);

  // THE PARTY'S LOWER THIRD (Sunday v5, law 6). It carries the three things a room full of people
  // is actually watching — who is picking, how far in the draft is, and how long is left — and no
  // verb at all, which is law 6's diagnostic answering honestly: nobody acts from across a living
  // room, and this screen's own invariant is that no control on it is ever clickable.
  const cells: LowerThirdCell[] = [];
  if (onClock !== null) {
    cells.push({
      label: "Now picking",
      value: (
        <span className="inline-flex items-center gap-3">
          <Avatar name={onClock.ownerDisplayName} avatar={onClock.ownerAvatarUrl} size="lg" />
          <span className={TV_VALUE}>{onClock.name}</span>
        </span>
      ),
    });
  }
  cells.push({
    // Law 1's own pairing: the count means something because the total sits beside it.
    // `picks × seats` is arithmetic on the payload, never a projection; zero seats (an undrawn
    // order) prints the count alone rather than a divide-by-nothing.
    label: "Picks in",
    value: <span className={TV_VALUE}>{totalPicks === 0 ? view.picks.length : `${view.picks.length} of ${totalPicks}`}</span>,
  });
  if (remainingMs !== null) {
    cells.push({
      label: spotlightHot ? "Final seconds" : "Pick clock",
      value: <span className={TV_CLOCK}>{formatCountdown(remainingMs)}</span>,
      clock: true,
    });
  }

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

        {/* R1 (2026-08-26 design review): the same band the room runs, at the TV's own scale —
            the crowd across the room gets the draft's recent history without a second glance
            at a laptop. It is also why the strip below carries no "last pick" cell any more:
            this line already names the newest pick, in ink, one row up. */}
        <PickWire view={view} teams={room.teams} playersById={playersById} players={room.players} variant="tv" />

        <DraftBoard
          view={view}
          teams={room.teams}
          playersById={playersById}
          myTeamId={room.myTeamId}
          landedPickNumber={room.lastPick?.pick.pickNumber ?? null}
          variant="tv"
          reasons={room.reasons}
          laws={room.laws}
        />
      </div>
      {/* THE SPOTLIGHT MOVED TO THE FOOT AND BECAME THE LOWER THIRD (Sunday v5, law 6). It was a
          bordered card between the rail and the board — a second masthead under the first, and
          the widest thing on the screen that was not the board. As a strip across the foot it
          costs the board nothing above it, and it is where a broadcast has always put the clock,
          the subject and the state of play. */}
      <div data-testid="spotlight" className="shrink-0">
        <LowerThird cells={cells} live={view.phase === "in_progress"} />
        {/* The strip's digits are `aria-hidden` inside the primitive, so the time left is spoken
            here — coarsely, on a boundary crossing rather than every tick. */}
        <p className="sr-only" aria-live="polite">
          {remainingMs === null ? null : formatCoarseRemaining(remainingMs)}
        </p>
      </div>
    </div>
  );
}
