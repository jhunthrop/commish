"use client";

import { useState, type ReactNode } from "react";
import type { Position } from "@/domain/player";
import { Button, Pill, PositionBadge } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import type { RoomSignals, SeatAhead } from "@/draft-service/assistant/view";
import { ADVISOR_ROOM_CONFIG } from "../config";
import { collapseText, pickLabel, runText, seatAheadText } from "../format";

export interface SignalsStripProps {
  readonly signals: RoomSignals;
  readonly teamCount: number;
  /** The strategy note: the writer's sentence when it landed, the template otherwise. */
  readonly strategy: string;
  readonly strategyVoice: "written" | "template";
  /** The positions the plan targets, in turn order: the asking seat's own needs, which decide
   *  which collapse chips a phone shows first. */
  readonly neededPositions: readonly Position[];
  readonly nameOf: (playerId: string) => string;
  readonly seatLabel: (seat: SeatAhead) => string;
  /** The bye-cluster and stack notes for the top candidate, kept from the assistant round. */
  readonly notes: readonly string[];
  readonly children?: ReactNode;
}

interface Chip {
  readonly key: string;
  readonly position: Position;
  readonly text: string;
  readonly testId: "advisor-run" | "advisor-collapse";
}

/** Runs first, then the collapses at the seat's own needed positions, then the rest — the order
 *  a phone cuts at `mobileChipCount`. */
export function orderChips(signals: RoomSignals, neededPositions: readonly Position[]): readonly Chip[] {
  const run: readonly Chip[] = signals.run === null ? [] : [{ key: "run", position: signals.run.position, text: runText(signals.run.position, signals.run.count, signals.run.window), testId: "advisor-run" }];
  const needRank = (position: Position): number => {
    const index = neededPositions.indexOf(position);
    return index === -1 ? Number.POSITIVE_INFINITY : index;
  };
  const collapses = [...signals.collapses]
    .sort((a, b) => needRank(a.position) - needRank(b.position))
    .map((row): Chip => ({ key: `collapse:${row.position}`, position: row.position, text: collapseText(row), testId: "advisor-collapse" }));
  return [...run, ...collapses];
}

/**
 * BAND ONE — the room signals (spec 3.3): the strategy note leads, then the run, the tier
 * collapses and the seats between now and your next pick, each read from the plan's own runs
 * with the basis of the read stated. Quiet chips in the raised surface; nothing here competes
 * with the Draft verb below. On a phone the chips show the first `mobileChipCount` and a "More"
 * disclosure reveals the rest, so the plan never drops below the fold.
 */
export function SignalsStrip({ signals, teamCount, strategy, strategyVoice, neededPositions, nameOf, seatLabel, notes, children }: SignalsStripProps) {
  const [expanded, setExpanded] = useState(false);
  const { ahead } = signals;
  const chips = orderChips(signals, neededPositions);
  const hidden = Math.max(0, chips.length - ADVISOR_ROOM_CONFIG.mobileChipCount);
  return (
    <section data-testid="advisor-signals" aria-label="Room signals" className="flex flex-col gap-2">
      {children}
      <p data-testid="advisor-strategy" data-voice={strategyVoice} className="font-display text-lg font-semibold leading-snug text-text-primary">
        {strategy}
      </p>
      {chips.length === 0 ? null : (
        <ul aria-label="Runs and tiers" className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip, index) => (
            <li key={chip.key} data-testid={chip.testId} data-beyond-fold={index >= ADVISOR_ROOM_CONFIG.mobileChipCount ? "true" : undefined} className={index >= ADVISOR_ROOM_CONFIG.mobileChipCount && !expanded ? "hidden md:list-item" : ""}>
              <Pill>
                <PositionBadge position={chip.position} size="sm" className="mr-1.5" />
                {chip.text}
              </Pill>
            </li>
          ))}
          {hidden === 0 ? null : (
            <li className="md:hidden">
              <Button size="sm" variant="ghost" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>
                {expanded ? "Less" : `More (${hidden})`}
              </Button>
            </li>
          )}
        </ul>
      )}
      {ahead.length === 0 ? null : (
        <div className="flex flex-col gap-1">
          <span className={`${MICRO_LABEL} text-text-faint`}>Ahead of you</span>
          <ol aria-label="Seats before your next pick" className="flex gap-1.5 overflow-x-auto pb-1">
            {ahead.map((seat) => {
              const { read, basis } = seatAheadText(seat, nameOf);
              return (
                <li key={seat.pickNumber} data-testid="advisor-seat-ahead" className="flex min-w-40 shrink-0 flex-col gap-0.5 rounded-md bg-surface-raised px-2.5 py-1.5">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-display text-sm font-semibold text-text-primary">{seatLabel(seat)}</span>
                    <span className="font-mono text-xs tabular-nums text-text-faint">{pickLabel(seat.pickNumber, teamCount)}</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-text-muted">
                    {seat.topPosition === null ? null : <PositionBadge position={seat.topPosition.position} size="sm" />}
                    <span>{read}</span>
                  </span>
                  <span className="text-xs text-text-faint">{basis}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      {notes.length === 0 ? null : (
        <ul aria-label="Roster fit" className="flex flex-col gap-0.5">
          {notes.map((note) => (
            <li key={note} data-testid="advisor-note" className="text-xs text-text-faint">
              {note}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
