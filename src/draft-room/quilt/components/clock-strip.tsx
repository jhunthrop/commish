"use client";

import { useMemo } from "react";
import type { Player } from "@/domain/player";
import type { TeamCard } from "@/domain/league";
import type { DraftStateView } from "@/draft-engine";
import { Button } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";
import { pickLabel } from "../state/board";
import { unfilledStartingPositions } from "../state/lens";
import { QUILT_CONFIG } from "../state/config";
import { teamCode } from "../lib/team-code";
import { shortName } from "./quilt-cell";
import type { LensChipsProps } from "./lens-chips";
import { LensChips } from "./lens-chips";

export interface ClockStripProps {
  readonly view: DraftStateView;
  readonly teams: readonly TeamCard[];
  readonly playersById: ReadonlyMap<string, Player>;
  readonly myTeamId: string | null;
  /** The caller's own queue, best first — the amber strip inlines its top three. */
  readonly queue: readonly string[];
  /** True only when the server says it is this caller's turn. */
  readonly myTurn: boolean;
  readonly submitting: boolean;
  /** Begins the pick-safety window (never a direct submit) — `usePendingPick.begin`. */
  readonly onDraft: (playerId: string) => void;
  /** The running clock's own reading ("0:24"), computed ONCE by the room (one ticking interval
   *  feeds this strip and the quilt's on-clock cell alike); null before the client clock snaps. */
  readonly clockLabel: string | null;
  readonly lensChips: Pick<LensChipsProps, "lens" | "onChange" | "hasByes">;
}

/** The mock's own room sentence — the strip's quiet middle while the clock is somebody else's. */
const ROOM_SENTENCE = "The board is the room. Your pool lives in the drawer below.";

/** Where the caller picks next: the first upcoming index that is theirs, as "1.08 · in 2". */
function yourNext(view: DraftStateView, myTeamId: string | null): { readonly label: string; readonly away: number } | null {
  if (myTeamId === null) return null;
  const away = view.upcoming.indexOf(myTeamId);
  if (away === -1) return null;
  const pickNumber = view.pickNumber + away;
  const teamCount = view.draftOrder.length;
  if (teamCount === 0) return null;
  const round = Math.ceil(pickNumber / teamCount);
  return { label: pickLabel(round, pickNumber - (round - 1) * teamCount), away };
}

/**
 * THE CLOCK STRIP BREATHES (law 1). Slim ribbon while the room drafts: the running clock in the
 * room's own red, whose turn it is, and where your next pick sits. On YOUR turn it swells amber
 * — `accentGlow` wash, accent border, your queue's top three inlined with one-tap DRAFT, and
 * one quiet line of what your starting roster still needs — and the growth eases inside the
 * 250ms motion ceiling. Amber is yours, red is the room's; nothing here ever flashes red at
 * you, and the needs line never rides the red state.
 */
export function ClockStrip({ view, teams, playersById, myTeamId, queue, myTurn, submitting, onDraft, clockLabel, lensChips }: ClockStripProps) {
  const reducedMotion = usePrefersReducedMotion();
  const onClockTeam = teams.find((team) => team.id === view.onClockTeamId) ?? null;
  const next = yourNext(view, myTeamId);
  const teamCount = view.draftOrder.length;
  const currentRound = teamCount === 0 ? 1 : Math.ceil(view.pickNumber / teamCount);
  const currentPlace = teamCount === 0 ? "" : pickLabel(currentRound, view.pickNumber - (currentRound - 1) * teamCount);

  // The queue's top three still-available players; short of a queue, the board's own top three —
  // said honestly as BOARD rows, never dressed up as a queue the manager did not build.
  const available = useMemo(() => new Set(view.availablePlayerIds), [view.availablePlayerIds]);
  const queued = queue.filter((playerId) => available.has(playerId)).slice(0, QUILT_CONFIG.clockQueueCount);
  const fromBoard = queued.length === 0;
  const suggested = fromBoard ? view.availablePlayerIds.slice(0, QUILT_CONFIG.clockQueueCount) : queued;

  if (myTurn) {
    // The quiet needs line (founder ruling 2026-09-03): the starting positions still open,
    // K/DEF included — spoken only HERE, on the amber state, to the one manager deciding.
    // The red room state never carries it; red is the room's channel, and the room does not
    // nag (see `unfilledStartingPositions` for the scope judgment).
    const stillNeeded = myTeamId === null ? [] : unfilledStartingPositions(view.slotConfig, view.rosters[myTeamId] ?? []);
    return (
      <div
        data-testid="clock-strip"
        data-strip-state="your-turn"
        className={`accent-wash flex flex-col gap-1 border-b-2 border-accent px-4 py-2 ${reducedMotion ? "" : "animate-strip-grow"}`}
      >
        <div className="flex items-center gap-3">
          <div id="room-clock" className="flex items-center gap-2 rounded-sm bg-accent px-3 py-1.5">
            <span className="font-display text-2xl font-bold text-accent-text tabular-nums">{clockLabel ?? "…"}</span>
            <span className="font-display text-sm font-bold text-accent-text">YOUR PICK · {currentPlace}</span>
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {suggested.map((playerId, index) => {
              const player = playersById.get(playerId);
              if (player === undefined) return null;
              return (
                <div key={playerId} className={`flex items-center gap-2 rounded-sm bg-surface-raised px-3 py-1.5 ${index === 0 ? "border border-accent" : ""}`}>
                  <span className="font-display text-md font-semibold text-text-primary">{shortName(player.name)}</span>
                  <span className="text-xs text-text-faint">{player.position}</span>
                  <Button size="sm" variant={index === 0 ? "verb" : "secondary"} disabled={submitting} onClick={() => onDraft(playerId)}>
                    Draft
                  </Button>
                </div>
              );
            })}
            <span className={`hidden ${MICRO_LABEL} text-text-faint xl:inline`}>{fromBoard ? "board" : "your queue"}</span>
          </div>
          <LensChips {...lensChips} />
        </div>
        {stillNeeded.length === 0 ? null : (
          <p data-testid="needs-line" className="text-xs text-text-muted">
            Still need {stillNeeded.join(" · ")}
          </p>
        )}
      </div>
    );
  }

  return (
    <div data-testid="clock-strip" data-strip-state="resting" className="flex items-center gap-4 border-b border-line bg-surface-elevated px-4 py-2">
      {view.phase === "in_progress" && onClockTeam !== null ? (
        <div id="room-clock" className="flex items-center gap-2 rounded-sm bg-live px-3 py-1">
          <span className="font-display text-lg font-bold text-live-text tabular-nums">{clockLabel ?? "…"}</span>
          <span className="font-display text-xs font-bold text-live-text">
            {currentPlace} · {teamCode(onClockTeam.name)}
          </span>
        </div>
      ) : (
        <span className="font-display text-sm font-semibold text-text-muted">
          {view.phase === "complete" ? "Draft complete" : "Waiting for kickoff"}
        </span>
      )}
      <span className="hidden truncate text-sm text-text-faint lg:inline">{ROOM_SENTENCE}</span>
      <div className="ml-auto flex items-center gap-3">
        {next !== null && view.phase === "in_progress" ? (
          <span data-testid="your-next" className="font-display text-xs font-bold tracking-wide text-accent">
            {next.away === 0 ? `YOU PICK ${next.label}` : next.away === 1 ? `YOU PICK ${next.label} · NEXT` : `YOU PICK ${next.label} · IN ${next.away}`}
          </span>
        ) : null}
        <LensChips {...lensChips} />
      </div>
    </div>
  );
}
