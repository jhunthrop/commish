import type { ReactNode } from "react";
import { Button, PositionBadge, SlotChip } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import type { AdvisorView, NowCandidate } from "@/draft-service/assistant/view";
import { pickLabel, runsText } from "../format";
import type { AdvisorActs } from "./advisor-acts";

export interface NowCardProps {
  readonly view: AdvisorView;
  readonly acts: AdvisorActs;
  /** The name as the room renders it (the peek-opening `PlayerName` in a live room, a plain
   *  span in the demo). */
  readonly renderName: (playerId: string, name: string) => ReactNode;
  /** The reason on screen per candidate, already chosen between the writer and the template. */
  readonly reasonFor: (candidate: NowCandidate) => { readonly text: string; readonly voice: "written" | "template" };
}

function OddsCell({ candidate, view }: { readonly candidate: NowCandidate; readonly view: AdvisorView }) {
  const next = view.plan.turns[0]?.pickNumber ?? null;
  if (candidate.makeItBack === null) return <span className="text-xs text-text-faint">{next === null ? "Your last turn" : "No odds"}</span>;
  return (
    <span className="font-mono text-xs tabular-nums text-text-muted">
      {runsText(candidate.makeItBack)}
      {next === null ? "" : ` at ${pickLabel(next, view.teamCount)}`}
    </span>
  );
}

function Verb({ candidate, acts }: { readonly candidate: NowCandidate; readonly acts: AdvisorActs }) {
  if (acts.canDraft) {
    return (
      <Button size="sm" variant="verb" disabled={acts.submitting} onClick={() => acts.onDraft(candidate.playerId)}>
        Draft
      </Button>
    );
  }
  const place = acts.queueOrder.get(candidate.playerId) ?? null;
  return (
    <Button size="sm" variant="secondary" disabled={acts.submitting} aria-pressed={place !== null} onClick={() => acts.onQueueToggle(candidate.playerId)}>
      {place === null ? "Queue" : `Queued ${place}`}
    </Button>
  );
}

/**
 * BAND THREE — the now card (spec 3.2 and 3.6): five rows, best first, each with the slot it
 * fills, its value over replacement, the simulator's own make-it-back count, ONE reason sentence
 * for this player in this room, and the verb: Draft when you are on the clock (the loudest thing
 * on the tab, nothing else competes), Queue when you are not, with the queue order visible.
 */
export function NowCard({ view, acts, renderName, reasonFor }: NowCardProps) {
  const heading = view.onTheClock ? "Your pick, right now" : `Your next pick, ${pickLabel(view.pickNumber, view.teamCount)}`;
  return (
    <section data-testid="advisor-now" aria-label="The picks for this turn" data-on-clock={view.onTheClock ? "true" : "false"} className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className={`${MICRO_LABEL} text-text-faint`}>{heading}</span>
        {view.onTheClock ? null : <span className="font-mono text-xs tabular-nums text-text-faint">{view.picksUntilYourTurn} picks away</span>}
      </div>
      {view.now.length === 0 ? (
        <p className="text-sm text-text-faint">Nothing on the board fits your roster right now.</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {view.now.map((candidate, index) => {
            const reason = reasonFor(candidate);
            return (
              <li key={candidate.playerId} data-testid="advisor-now-row" className={`flex flex-col gap-1 rounded-md px-2.5 py-2 ${index === 0 ? "border border-accent bg-surface-raised" : "bg-surface-raised"}`}>
                <div className="flex items-center gap-2">
                  <PositionBadge position={candidate.position} rank={candidate.positionRank} size="sm" />
                  <span data-testid="advisor-now-name" className="min-w-0 flex-1 truncate font-display text-md font-semibold text-text-primary">
                    {renderName(candidate.playerId, view.names[candidate.playerId] ?? candidate.playerId)}
                  </span>
                  {candidate.fillsSlot === null ? null : <SlotChip slot={candidate.fillsSlot} />}
                  <span className="font-mono text-xs tabular-nums text-text-muted">+{candidate.valueOverReplacement.toFixed(1)}</span>
                  <Verb candidate={candidate} acts={acts} />
                </div>
                <p data-testid="advisor-reason" data-voice={reason.voice} className="text-sm text-text-muted">
                  {reason.text}
                </p>
                <OddsCell candidate={candidate} view={view} />
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
