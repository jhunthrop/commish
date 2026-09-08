import type { ReactNode } from "react";
import type { AdvisorView, NowCandidate, SeatAhead } from "@/draft-service/assistant/view";
import type { AdvisorActs } from "./advisor-acts";
import { NowCard } from "./now-card";
import { PlanRail } from "./plan-rail";
import { SignalsStrip } from "./signals-strip";

export interface AdvisorPanelProps {
  readonly view: AdvisorView;
  readonly acts: AdvisorActs;
  readonly renderName: (playerId: string, name: string) => ReactNode;
  readonly seatLabel: (seat: SeatAhead) => string;
  readonly changedSince: readonly string[];
  readonly changedSincePick: number | null;
  readonly recomputing: boolean;
  /** The post-pick beat, when this seat's own pick just landed. */
  readonly beat: string | null;
  readonly notes: readonly string[];
}

/** The reason on screen: the writer's validated sentence when it landed, the template floor
 *  otherwise. `data-voice` says which, so a test can tell the fallback apart. */
export function reasonOnScreen(view: AdvisorView, candidate: NowCandidate): { readonly text: string; readonly voice: "written" | "template" } {
  const written = view.voice.reasons[candidate.playerId];
  return written === undefined ? { text: candidate.templateReason, voice: "template" } : { text: written, voice: "written" };
}

export function strategyOnScreen(view: AdvisorView): { readonly text: string; readonly voice: "written" | "template" } {
  return view.voice.strategy === null ? { text: view.strategyTemplate, voice: "template" } : { text: view.voice.strategy, voice: "written" };
}

/**
 * THE ADVISOR, THREE BANDS (spec 3.6): the signals strip, the plan rail, the now card. One
 * presentational component for the desk drawer, the phone tab and the Draft HQ demo, so the
 * three never drift; every act goes through `acts`, which the room wires to the pool's own
 * pick path and queue.
 */
export function AdvisorPanel({ view, acts, renderName, seatLabel, changedSince, changedSincePick, recomputing, beat, notes }: AdvisorPanelProps) {
  const strategy = strategyOnScreen(view);
  const nameOf = (playerId: string): string => view.names[playerId] ?? playerId;
  return (
    <div data-testid="advisor-panel" aria-label="The advisor" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      <SignalsStrip
        signals={view.signals}
        teamCount={view.teamCount}
        strategy={strategy.text}
        strategyVoice={strategy.voice}
        neededPositions={view.plan.turns.map((turn) => turn.position)}
        nameOf={nameOf}
        seatLabel={seatLabel}
        notes={notes}
      >
        {beat === null ? null : (
          <p data-testid="assistant-beat" className="rounded-md bg-surface-raised px-2.5 py-1.5 text-sm font-semibold text-text-primary">
            {beat}
          </p>
        )}
      </SignalsStrip>
      <PlanRail plan={view.plan} teamCount={view.teamCount} nameOf={nameOf} changedSince={changedSince} changedSincePick={changedSincePick} recomputing={recomputing} />
      <NowCard view={view} acts={acts} renderName={renderName} reasonFor={(candidate) => reasonOnScreen(view, candidate)} />
    </div>
  );
}
