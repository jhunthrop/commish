import { Pill, PositionBadge } from "@/components/ui";
import type { RoomSignals } from "@/draft-service/assistant/view";
import { collapseText, runText } from "../format";

export interface SignalsStripProps {
  readonly signals: RoomSignals;
}

/**
 * THE STRIP ABOVE THE CARD: the run in progress and the positions at a tier collapse, as quiet
 * chips, each read from the room and stated with its basis. When the room has nothing to report
 * it renders nothing at all: no filler line (the pick count round, after the founder saw a
 * stray "Best available." strip above the card).
 */
export function SignalsStrip({ signals }: SignalsStripProps) {
  const { run, collapses } = signals;
  if (run === null && collapses.length === 0) return null;
  return (
    <ul data-testid="advisor-signals" aria-label="Runs and tiers" className="flex flex-wrap items-center gap-1.5">
      {run === null ? null : (
        <li data-testid="advisor-run">
          <Pill>
            <PositionBadge position={run.position} size="sm" className="mr-1.5" />
            {runText(run)}
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
  );
}
