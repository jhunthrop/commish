"use client";

import Link from "next/link";
import { Crest } from "@/components/ui";
import { useReaderClock } from "@/league-room/hooks/use-reader-clock";
import { instantWeekday } from "@/league-room/lib/day-chapters";

/**
 * THE QUIET LINE ABOVE THE BOARD (the Draft area round, 2026-09-12) — the door back to the real
 * thing, on the two stops that are draft preparation.
 *
 * IT WIDENED TO "DRAFTING NOW" AND THAT WAS NOT A FLOURISH (mock finding 5). Deleting Rooms from
 * the top nav takes away the only path into a live draft room, so a manager whose draft had
 * already started would have had no way back to it from anywhere in the product. A league of
 * yours that is drafting right now says so here, and the line is the way in.
 *
 * THE SLOT CLAUSE IS APPENDED ONLY WHEN THERE IS ONE (mock finding 3). No draft draws its order
 * until it starts, so "you pick 4th" has no source before kickoff; `assignedSlot` is null until
 * one exists and the line simply does not say it. Absence renders as absence, never as a
 * placeholder that looks like data.
 *
 * THE DAY IS THE READER'S OWN (the 2026-09-11 fix round's ruling, kept): one formatter for every
 * draft date in the product, UTC on the server pass and the reader's zone after mount, off the
 * same `formatToParts` call every other door reads. A client component for that one reason.
 */
export interface ScheduledDraft {
  readonly leagueId: string;
  readonly leagueName: string;
  readonly draftId: string;
  /** True once the draft is under way: the line becomes a live door instead of a reminder. */
  readonly drafting: boolean;
  readonly kickoffIso: string;
  /** His place in the order, once an order exists. Null otherwise, and then unsaid. */
  readonly assignedSlot: number | null;
}

/** "4th", "1st", "22nd" — the ordinal a manager says out loud about his own pick. */
export function slotOrdinal(slot: number): string {
  const tens = slot % 100;
  if (tens >= 11 && tens <= 13) return `${slot}th`;
  const ones = slot % 10;
  return `${slot}${ones === 1 ? "st" : ones === 2 ? "nd" : ones === 3 ? "rd" : "th"}`;
}

/** What follows the league's name. `day` is null while it is drafting, where the day has stopped
 *  being the fact anyone needs. */
export function scheduledLineSentence(drafting: boolean, day: string | null, assignedSlot: number | null): string {
  const lead = drafting ? "is drafting now" : `drafts ${day}`;
  return assignedSlot === null ? lead : `${lead}, you pick ${slotOrdinal(assignedSlot)}`;
}

export function ScheduledLine({ draft }: { readonly draft: ScheduledDraft | null }) {
  const clock = useReaderClock();
  if (draft === null) return null;
  const day = draft.drafting ? null : instantWeekday(draft.kickoffIso, clock);
  return (
    <Link
      href={`/app/drafts/${draft.draftId}`}
      data-testid="scheduled-line"
      data-drafting={draft.drafting ? "true" : undefined}
      className="flex items-center gap-3 rounded-lg bg-surface-elevated px-4 py-3 text-sm text-text-muted shadow-card hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <Crest id={draft.leagueId} name={draft.leagueName} size={34} />
      <span className="min-w-0">
        <span className="font-semibold text-text-primary">{draft.leagueName}</span> {scheduledLineSentence(draft.drafting, day, draft.assignedSlot)}
      </span>
      <span className="ml-auto shrink-0 font-semibold text-accent">Open the room</span>
    </Link>
  );
}
