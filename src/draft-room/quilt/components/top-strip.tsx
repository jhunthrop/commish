"use client";

import { memo } from "react";
import type { TeamCard } from "@/domain/league";
import type { DraftStateView } from "@/draft-engine";
import { Avatar, CountdownLabel } from "@/components/ui";
import { pickLabel } from "../state/board";

export interface TopStripProps {
  readonly leagueName: string;
  readonly view: DraftStateView;
  readonly teams: readonly TeamCard[];
  readonly myTeamId: string | null;
  /** True only when the server says it is this caller's turn. */
  readonly myTurn: boolean;
  /** Items that arrived while the stream was hidden, for the strip's small "new" pill. */
  readonly hiddenNew: number;
  /** Shown only while the stream is hidden: the way back to the room. */
  readonly onOpenStream: (() => void) | null;
}

export type TurnState = "yours" | "theirs" | "idle";

/** The strip's clock digits, ticking alone (`CountdownLabel` owns the interval). */
const CLOCK_DIGITS = "font-display text-2xl font-extrabold leading-none tabular-nums";

/**
 * THE TOP STRIP (Sideline's `.top`): the league, the pick in the sport's grammar, the clock, and
 * whose turn it is as a person with a face. One line and no verb: the room's one Draft lives in
 * the dock (P3), so this strip never competes with it. On your turn the chip washes amber
 * (yours); somebody else's turn shows their face and name. Nothing here ticks but the digits.
 */
export const TopStrip = memo(function TopStrip({ leagueName, view, teams, myTeamId, myTurn, hiddenNew, onOpenStream }: TopStripProps) {
  const teamCount = view.draftOrder.length;
  const live = view.phase === "in_progress";
  const round = teamCount === 0 ? 1 : Math.ceil(view.pickNumber / teamCount);
  const place = teamCount === 0 ? "" : pickLabel(round, view.pickNumber - (round - 1) * teamCount);
  const onClock = teams.find((team) => team.id === view.onClockTeamId) ?? null;
  const me = teams.find((team) => team.id === myTeamId) ?? null;
  const turn: TurnState = !live ? "idle" : myTurn ? "yours" : "theirs";
  const format = view.format === "auction" ? "auction" : "snake";

  return (
    <header data-testid="top-strip" data-turn={turn} className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-b border-line px-4 py-2">
      <h1 className="font-display text-xl font-extrabold leading-none text-text-primary">{leagueName}</h1>
      <p className="text-sm text-text-muted">
        {live ? (
          <>
            Round {round} · <span className="font-semibold text-text-primary">pick {place}</span> · {teamCount} teams · {format}
          </>
        ) : view.phase === "complete" ? (
          "Draft complete"
        ) : (
          `${teamCount} teams · ${format} · waiting for kickoff`
        )}
      </p>
      <span className="flex-1" />
      {onOpenStream === null ? null : (
        <button
          type="button"
          data-testid="stream-hidden-pill"
          onClick={onOpenStream}
          className="inline-flex items-center gap-1.5 rounded-pill bg-surface-elevated px-3 py-1 text-xs font-semibold text-text-muted shadow-card hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {hiddenNew > 0 ? <span className="rounded-pill bg-self px-1.5 text-self-text tabular-nums">{hiddenNew}</span> : null}
          The room
        </button>
      )}
      {live ? (
        <div id="room-clock" className="flex items-baseline gap-1.5">
          <CountdownLabel deadlineAt={view.deadlineAt} className={`${CLOCK_DIGITS} ${myTurn ? "text-negative" : "text-text-primary"}`} />
          {view.clockSeconds === null ? null : <span className="text-xs text-text-faint">of {Math.floor(view.clockSeconds / 60)}:{String(view.clockSeconds % 60).padStart(2, "0")}</span>}
        </div>
      ) : null}
      {turn === "yours" ? (
        <span data-testid="turn-chip" className="self-wash flex items-center gap-2.5 rounded-pill py-1 pl-1 pr-3.5">
          <Avatar name={me?.ownerDisplayName ?? "You"} avatar={me?.ownerAvatarUrl} size="md" ring="self" />
          <span className="font-display text-md font-bold text-text-primary">Your pick</span>
        </span>
      ) : turn === "theirs" && onClock !== null ? (
        <span data-testid="turn-chip" className="flex items-center gap-2.5 rounded-pill bg-surface-elevated py-1 pl-1 pr-3.5 shadow-card">
          <Avatar name={onClock.ownerDisplayName} avatar={onClock.ownerAvatarUrl} size="md" />
          <span className="flex flex-col leading-tight">
            <span className="font-display text-md font-bold text-text-primary">{onClock.ownerDisplayName}</span>
            <span className="text-xs text-text-muted">{onClock.id === myTeamId ? "you" : onClock.name} is picking</span>
          </span>
        </span>
      ) : null}
    </header>
  );
});
