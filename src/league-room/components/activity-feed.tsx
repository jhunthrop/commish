import Link from "next/link";
import type { ActivityRow } from "@/integrity/activity-view";
import { EmptyState } from "@/components/ui";
import { ChapterBand } from "@/components/ui/chapter-band";
import { Icon } from "@/components/ui/icon";
import { byDay, dayMarker } from "../lib/day-chapters";

export interface ActivityFeedProps {
  readonly rows: readonly ActivityRow[];
  readonly leagueId: string;
  /** From `ActivityPage.nextBefore` (Task 9). Non-null means there is an older page to read,
   *  REGARDLESS of how many rows `rows` holds — a page that came back all-filtered still has
   *  one, and "Show older" still has to appear so a member can keep paging past it. */
  readonly nextBefore: number | null;
}

/** The clock only. The DAY is the band above the row now (law 5), so repeating the date on every
 *  line is the same fact printed forty times down one column. */
function formatTimeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { timeStyle: "short" });
}

function ActivityRowItem({ row }: { readonly row: ActivityRow }) {
  return (
    // The stamp gets its own fixed column at `sm` and up, so every time in the feed starts at the
    // same x and a reader runs their eye down ONE column instead of hunting for each at the end of
    // a different-length sentence. Literal classes, never a template: Tailwind's scanner reads
    // source text, and a width built from a variable ships no rule at all. The column narrowed
    // from `w-40` to `w-16` when the date moved into the band above it.
    <li className="flex flex-col gap-0.5 border-b border-line py-2 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-3">
      <time dateTime={row.occurredAt} className="order-last font-mono text-xs text-text-faint sm:order-first sm:w-16 sm:shrink-0">
        {formatTimeOfDay(row.occurredAt)}
      </time>
      <Icon name={row.icon} size={14} className="hidden shrink-0 self-center text-text-faint sm:block" />
      {/* `min-w-0` on the flex item plus `break-words` on the text: a headline carries user
          content (a league name, a manager's name, a team name) that can be one long unbroken run
          with nowhere to wrap, and a flex item will not shrink below its min-content width
          without this. */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* NO TIPS (founder ruling, 2026-08-28): the clock-icon row carried a `queue` glossary
            trigger. `renderDraftPick`'s own headline for that branch already says "from their
            queue" in the sentence, which is the definition the tip was one press away from. */}
        <p className="break-words text-sm text-text-primary">{row.headline}</p>
        {row.detail === null ? null : <p className="break-words text-sm text-text-muted">{row.detail}</p>}
      </div>
    </li>
  );
}

/**
 * THE LEAGUE'S HISTORY, BANDED BY DAY (Sunday v5, law 5).
 *
 * *"A hairline divider at sixty rows becomes the loudest thing on the screen while saying the
 * least."* This ledger was forty identical hairline rows each carrying its own full date and time,
 * which is that failure in reverse: no divisions at all, and the one fact that WOULD divide them
 * printed on every line. The day is now a chapter marker carrying its own count, and the row keeps
 * only the clock.
 *
 * Grouping is a fold over rows that ARRIVE in order, never a sort: `activityRowFor`'s allowlist
 * decided what is visible and `listLeagueActivity` decided the order, and this component prints
 * them. A day boundary is simply where two adjacent rows stop agreeing about the date.
 *
 * `rows.length === 0` renders the "nothing has happened" empty state ONLY when `nextBefore` is
 * also `null` — a page that came back with zero visible rows but a real cursor still offers
 * `Show older`, never the dead-end empty state.
 */
export function ActivityFeed({ rows, leagueId, nextBefore }: ActivityFeedProps) {
  if (rows.length === 0 && nextBefore === null) {
    return (
      <EmptyState
        title="Nothing has happened here yet."
        action={
          <Link className="text-accent underline" href={`/app/leagues/${leagueId}`}>
            Go to the league
          </Link>
        }
      />
    );
  }

  // ONE clock for the whole render. Reading `new Date()` inside the loop would let a page that
  // straddles midnight label two rows of the same day differently.
  const now = new Date();

  return (
    <div className="flex flex-col gap-4">
      {rows.length === 0 ? <p className="text-sm text-text-muted">Nothing visible to you on this page.</p> : null}
      {byDay(rows).map((chapter) => (
        <section key={chapter.key} aria-label={dayMarker(chapter.rows[0]!.occurredAt, now)} className="flex flex-col">
          <ChapterBand
            name={dayMarker(chapter.rows[0]!.occurredAt, now)}
            consequence={`${chapter.rows.length} ${chapter.rows.length === 1 ? "entry" : "entries"}`}
          />
          <ul className="flex flex-col">
            {chapter.rows.map((row) => (
              <ActivityRowItem key={row.eventId} row={row} />
            ))}
          </ul>
        </section>
      ))}
      {/* QUIET, deliberately. Law 5's surviving discipline is that the loud action belongs to ACTS
          only — a filter, a toggle and a way to read further stay quiet however loud the verb
          beside them is — and paging back through a history is not an act. */}
      {nextBefore === null ? null : (
        <Link className="text-accent underline" href={`/app/leagues/${leagueId}/activity?before=${nextBefore}`}>
          Show older
        </Link>
      )}
    </div>
  );
}
