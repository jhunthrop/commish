import Link from "next/link";
import type { ActivityRow } from "@/integrity/activity-view";
import { EmptyState } from "@/components/ui";
import { Icon } from "@/components/ui/icon";

export interface ActivityFeedProps {
  readonly rows: readonly ActivityRow[];
  readonly leagueId: string;
  /** From `ActivityPage.nextBefore` (Task 9). Non-null means there is an older page to read,
   *  REGARDLESS of how many rows `rows` holds — a page that came back all-filtered still has
   *  one, and "Show older" still has to appear so a member can keep paging past it. */
  readonly nextBefore: number | null;
}

function formatOccurredAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function ActivityRowItem({ row }: { readonly row: ActivityRow }) {
  return (
    // GAMEDAY, LAW 4. This row was `py-4` around a three-line stack — icon, headline, detail, and
    // the timestamp last, at the bottom of a block whose height depended on how long the sentence
    // was. Three lines and 64px to say "You set your week 14 lineup", forty of them down a page,
    // is a history you scroll rather than one you read. The stamp leads its own fixed column at
    // `sm` and up, so the times line up and the sentences start together; below `sm` it drops
    // back under the sentence, because a 40-character timestamp column on a 360px phone would
    // leave the sentence nothing to live in.
    <li className="flex flex-col gap-0.5 border-b border-line py-2 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-3">
      {/* The stamp gets its own fixed column at `sm` and up, so every timestamp in the feed
          starts at the same x and a reader runs their eye down ONE column of times instead of
          hunting for each at the end of a different-length sentence. Literal classes, never a
          template: Tailwind's scanner reads source text, and a width built from a variable ships
          no rule at all. */}
      <time dateTime={row.occurredAt} className="order-last font-mono text-xs text-text-faint sm:order-first sm:w-40 sm:shrink-0">
        {formatOccurredAt(row.occurredAt)}
      </time>
      <Icon name={row.icon} size={14} className="hidden shrink-0 self-center text-text-faint sm:block" />
      {/* `min-w-0` on the flex item plus `break-words` on the text: a headline carries user
          content (a league name, a manager's name, a team name) that can be one long unbroken
          run with nowhere to wrap, and a flex item will not shrink below its min-content width
          without this. Same pair, same reason, as `HomeLeagueCard`'s heading. */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="break-words text-sm text-text-primary">
          {row.headline}
        </p>
        {row.detail === null ? null : <p className="break-words text-sm text-text-muted">{row.detail}</p>}
      </div>
    </li>
  );
}

/**
 * The chronological, member-visible half of Task 10: `rows` arrive already rendered by
 * `activityRowFor` (Task 9's allowlist) — this component prints them, it never re-derives
 * visibility or re-sorts. Deliberately NOT `"use client"`: `Show older` is a plain `<Link>`
 * carrying a `before` cursor in the query string, so the history reads with no JavaScript at
 * all, and the page it lives on is a document, not a room (`docs/design-system.md`, "Layout: shell
 * pages, rooms, public pages, and prose") — this plan's own closing note says the feed is a history, not a second
 * realtime surface.
 *
 * `rows.length === 0` renders the "nothing has happened" empty state ONLY when `nextBefore` is
 * also `null` — a page that came back with zero visible rows but a real cursor still offers
 * `Show older`, never the dead-end empty state, so a member reading an early, mostly-hidden
 * page of their league's history can still page forward to where the visible rows start.
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

  return (
    <div className="flex flex-col gap-4">
      {rows.length === 0 ? <p className="text-sm text-text-muted">Nothing visible to you on this page.</p> : null}
      <ul className="flex flex-col" aria-label="League activity">
        {rows.map((row) => (
          <ActivityRowItem key={row.eventId} row={row} />
        ))}
      </ul>
      {nextBefore === null ? null : (
        <Link className="text-accent underline" href={`/app/leagues/${leagueId}/activity?before=${nextBefore}`}>
          Show older
        </Link>
      )}
    </div>
  );
}
