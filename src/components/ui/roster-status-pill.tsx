import type { RosterStatusNote } from "@/projections/preseason/roster-status";
import { rosterStatusLabel, rosterStatusSentence } from "@/projections/preseason/roster-status-copy";
import { Badge, type BadgeTone } from "./badge";

export interface RosterStatusPillProps {
  readonly note: RosterStatusNote;
  readonly className?: string;
}

/**
 * THE ROSTER STATUS PILL — one shape for every surface that lists a player (the board, the pool,
 * the search result, the team page). The visible word is the short label ("IR", "Practice squad");
 * the accessible name and the hover title carry the whole dated sentence, source included, so a
 * screen reader and a curious pointer both get the observation rather than the abbreviation.
 *
 * TONE IS THE TREATMENT, not the severity: a reserve designation is `warning` (he is rostered, his
 * games are capped), an off-roster status is `neutral` (he has no projection, and grey is what "no
 * number" looks like everywhere else on this product). Never `negative`: red is for a loss a
 * manager took, and a status is a fact about a roster.
 */
export function RosterStatusPill({ note, className = "" }: RosterStatusPillProps) {
  const tone: BadgeTone = note.excluded ? "neutral" : "warning";
  const sentence = rosterStatusSentence(note);
  return (
    <Badge tone={tone} soft title={sentence} className={className} data-roster-status={note.status}>
      <span aria-hidden="true">{rosterStatusLabel(note.status)}</span>
      <span className="sr-only">{sentence}</span>
    </Badge>
  );
}
