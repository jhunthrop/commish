import type { ReactNode } from "react";
import { Pill, PositionBadge } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import type { RoomSignals, SeatAhead } from "@/draft-service/assistant/view";
import { collapseText, pickLabel, runText, seatAheadText } from "../format";

export interface SignalsStripProps {
  readonly signals: RoomSignals;
  readonly teamCount: number;
  /** The strategy note: the writer's sentence when it landed, the template otherwise. */
  readonly strategy: string;
  readonly strategyVoice: "written" | "template";
  readonly nameOf: (playerId: string) => string;
  readonly seatLabel: (seat: SeatAhead) => string;
  /** The bye-cluster and stack notes for the top candidate, kept from the assistant round. */
  readonly notes: readonly string[];
  readonly children?: ReactNode;
}

/**
 * BAND ONE — the room signals (spec 3.3): the strategy note leads, then the run, the tier
 * collapses and the seats between now and your next pick, each read from the plan's own runs
 * with the basis of the read stated. Quiet chips in the raised surface; nothing here competes
 * with the Draft verb below.
 */
export function SignalsStrip({ signals, teamCount, strategy, strategyVoice, nameOf, seatLabel, notes, children }: SignalsStripProps) {
  const { run, collapses, ahead } = signals;
  return (
    <section data-testid="advisor-signals" aria-label="Room signals" className="flex flex-col gap-2">
      {children}
      <p data-testid="advisor-strategy" data-voice={strategyVoice} className="font-display text-lg font-semibold leading-snug text-text-primary">
        {strategy}
      </p>
      {run === null && collapses.length === 0 ? null : (
        <ul aria-label="Runs and tiers" className="flex flex-wrap items-center gap-1.5">
          {run === null ? null : (
            <li data-testid="advisor-run">
              <Pill>
                <PositionBadge position={run.position} size="sm" className="mr-1.5" />
                {runText(run.position, run.count, run.window)}
              </Pill>
            </li>
          )}
          {collapses.map((row) => (
            <li key={row.position} data-testid="advisor-collapse">
              <Pill>
                <PositionBadge position={row.position} size="sm" className="mr-1.5" />
                {collapseText(row)}
              </Pill>
            </li>
          ))}
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
