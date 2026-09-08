import { Button } from "@/components/ui";
import type { AdvisorActs } from "./advisor-acts";

export interface AdvisorVerbProps {
  readonly playerId: string;
  readonly acts: AdvisorActs;
  /** The player's name for the accessible label, on a row where several verbs share a screen.
   *  The lead card leaves it off: its one verb reads "Draft" on its own. */
  readonly name?: string;
  readonly className?: string;
}

function labelled(text: string, name: string | undefined, joiner: string): string | undefined {
  return name === undefined ? undefined : `${text}${joiner}${name}`;
}

/**
 * THE TWO VERBS, ONCE: Draft when you are on the clock through the pool's own pick path and its
 * confirmation rules, Queue when you are not through the queue that already exists, "Queued n"
 * when he is already in it. The lead card and every candidate row render this same control, so
 * a row's Draft is the card's Draft.
 */
export function AdvisorVerb({ playerId, acts, name, className = "" }: AdvisorVerbProps) {
  if (acts.canDraft) {
    return (
      <Button size="sm" variant="verb" disabled={acts.submitting} aria-label={labelled("Draft", name, " ")} className={className} onClick={() => acts.onDraft(playerId)}>
        Draft
      </Button>
    );
  }
  const place = acts.queueOrder.get(playerId) ?? null;
  const text = place === null ? "Queue" : `Queued ${place}`;
  return (
    <Button size="sm" variant="secondary" disabled={acts.submitting} aria-pressed={place !== null} aria-label={labelled(text, name, place === null ? " " : ", ")} className={className} onClick={() => acts.onQueueToggle(playerId)}>
      {text}
    </Button>
  );
}
