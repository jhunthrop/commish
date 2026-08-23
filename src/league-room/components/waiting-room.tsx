"use client";

import Link from "next/link";
import { Countdown, formatCoarseDuration, useCountdown } from "@/components/ui/countdown";
import { StatePanel } from "@/components/ui/state-panel";
import type { LeagueAuthority } from "@/league-service/authority";
import { hasOpenSeat } from "@/matchmaking/filter";
import type { DraftScheduleBody } from "../contract";
import { draftTerminalStatePanel } from "./draft-schedule-panel";

/**
 * `DraftScheduleBody` plus the two facts Task 8's own "Produces" list deliberately does not add
 * there (`DraftScheduleBody.startTrigger`/`filledTeams` are the only two new fields it names):
 * `teamCount` rides in from `LeagueHomeBody`, which `LeagueHome` already holds for its own
 * header line, rather than a third copy of a league's own seat count on the wire. `authority`
 * (Phase 3.5 addendum, Task 14) is the SAME `LeagueHomeBody.authority` Task 12's wire type
 * carries — this component reads its `kind` directly, rather than trusting a page-local
 * `isHouse` boolean a caller could compute wrong, to decide which of the two filling-state
 * actions a house league can actually offer.
 */
export interface WaitingRoomLeague extends DraftScheduleBody {
  readonly teamCount: number;
  readonly authority: LeagueAuthority;
}

/**
 * The room a `when_full` league's members watch before there is a draft to watch — the missing
 * state Task 7's sit-and-go trigger landed with no surface of its own (Phase 3.5, Task 8).
 *
 * Four states, the same shape `DraftSchedulePanel` renders the `'scheduled'`-trigger case from:
 *
 * 1. FILLING — no countdown, because there is nothing to count down to yet (a `when_full`
 *    league's stored `kickoffAt` is a placeholder — `DraftScheduleBody.kickoffAt`'s own
 *    docblock). The fill count IS the hero, in words, per `public-league-list.tsx`'s own
 *    no-bar ruling (ruling 16) — this plan agrees with it rather than quietly overruling it a
 *    second time.
 * 2. FULL AND COUNTING DOWN — the shared `Countdown` primitive (`@/components/ui/countdown`,
 *    Task 8's Step 1) is the hero here; `WaitingRoom` is its third caller.
 * 3 & 4. IN PROGRESS / COMPLETE — identical to the two states a commissioner-scheduled draft
 *    reaches, rendered through the SAME `draftTerminalStatePanel` `DraftSchedulePanel` uses, so
 *    the two sentences can never drift apart.
 *
 * `LeagueHome` renders this OR `DraftSchedulePanel`, never both, keyed on
 * `league.startTrigger`.
 *
 * PERSONA PANEL, STEP 5. Veteran: reads as informed, not stranded — the fill count IS the state
 * of the world, stated once, not a spinner implying something is loading. Casual: "You don't have
 * to wait here" is a promise this product can keep, because it already sends a `draft_fill_
 * triggered` notice to every seat the moment the league fills (`fireWhenFullInTx`,
 * `@/league-service/fill-trigger`) — the sentence is not aspirational copy, it names a real
 * notification path. Commissioner: "Invite someone" is the one lever that's actually theirs;
 * gated on `isCommissioner` rather than offered to everyone and quietly failing for whoever isn't.
 * First-timer, the panel's own question — "what happens if I'm not there when it starts?" —
 * answered by NAMING the room's autopick fallback (Task 5) once the countdown is running, rather
 * than leaving a first-timer to discover it only once the clock is already live: the filling
 * state says nothing about it (there's no clock running yet to be away from), the full state
 * does. Urgency vs. anxiety: the countdown only ever appears once the room is genuinely about to
 * draft (state 2) — a manager watching a half-full league (state 1) sees no ticking clock at all,
 * so there is nothing counting down to create false urgency around a moment that may be hours
 * away.
 *
 * PHASE 3.5 ADDENDUM, TASK 14, STEP 4. A house league adds no fifth state and changes one: in
 * the filling state, "Invite someone" is a member-league-only lever (ruling 33 — nobody holds an
 * invite code to a room the platform runs), gated on `league.authority.kind === "house"` rather
 * than on `isCommissioner` alone. That reads the SAME wire union `LeagueMembersPanel`'s own
 * "Run by Commish" branch keys on, never a page-local recomputation of who runs this league —
 * `isCommissioner` is already always `false` for a house league (`isCommissionerOf`'s own
 * docblock), so the two conditions never disagree, but only one of them SAYS why. In its place, a
 * house league's second action reads "See the rest of the shelf" — the "never a dead end" rule
 * doing exactly what it exists for on the one surface where the obvious action is unavailable.
 */
export function WaitingRoom({ league, isCommissioner }: { readonly league: WaitingRoomLeague; readonly isCommissioner: boolean }) {
  const isHouse = league.authority.kind === "house";
  const full = !hasOpenSeat(league);
  // Called unconditionally, before any early return — React's Rules of Hooks. `null` once
  // there's nothing left to count down to: still filling (no kickoff has been set yet), or a
  // draft already in progress/complete (handled by `draftTerminalStatePanel` below).
  const { remainingMs } = useCountdown(league.status === "scheduled" && full ? league.kickoffAt : null);

  const terminal = draftTerminalStatePanel(league);
  if (terminal !== null) return terminal;

  if (full) {
    // `terminal` above is `null` only while `league.status === "scheduled"` (`draftTerminalStatePanel`'s
    // own contract), and `full` is true here, so the ternary feeding `useCountdown` above took its
    // `league.kickoffAt` branch — `remainingMs` is therefore never `null` at this point. Asserted,
    // not re-guarded: a dead `remainingMs === null` branch here would be unreachable and, per this
    // task's own review, exactly the kind of defensive code the gates' 100% coverage would then
    // demand a test for despite there being no state that reaches it — the same `pausedUntil!`
    // idiom `RoomRail` (`@/draft-room/components/room-rail`) already uses for an identical
    // logically-guaranteed-non-null case.
    return (
      <StatePanel
        tone="neutral"
        icon="bolt"
        title={`All ${league.teamCount} seats are full.`}
        action={
          <div className="flex flex-col items-center gap-1">
            <Countdown remainingMs={remainingMs!} size="lg" data-testid="waiting-room-countdown" />
            <p role="status" className="text-sm text-text-muted">{`Starts in ${formatCoarseDuration(remainingMs!)}.`}</p>
            {/* First-timer persona question, Step 5: "what happens if I'm not there?" — the
                honest answer this room already gives during a live draft (`room-dock.tsx`'s
                own copy), stated once here too rather than left for a member to discover only
                once the clock is already running. */}
            <p className="text-sm text-text-muted">Away when it starts? The room autopicks for you if your clock runs out.</p>
          </div>
        }
      />
    );
  }

  return (
    <StatePanel
      tone="neutral"
      icon="users"
      title={`${league.filledTeams} of ${league.teamCount} seats taken`}
      description="You don't have to wait here. We'll let you know the moment it fills."
      action={
        <div className="flex flex-wrap items-center justify-center gap-4">
          {isHouse || !isCommissioner ? null : (
            <Link href={`/app/leagues/${league.leagueId}#invite-managers`} className="text-sm font-medium text-accent underline">
              Invite someone
            </Link>
          )}
          <Link href="/browse" className="text-sm font-medium text-accent underline">
            {isHouse ? "See the rest of the shelf" : "See leagues closer to filling"}
          </Link>
        </div>
      }
    />
  );
}
