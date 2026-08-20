import Link from "next/link";
import type { ActivityRow } from "@/integrity/activity-view";
import { EmptyState, InfoTip } from "@/components/ui";
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
  // `"clock"` is the icon ONLY `renderDraftPick`'s clock-ran-out branch uses
  // (`src/integrity/activity-view.ts`) — the one headline that says "from their queue" to a
  // reader who may never have seen an autopick before.
  const isQueueAutopick = row.icon === "clock";
  return (
    <li className="flex items-start gap-3 border-b border-border py-4 last:border-b-0">
      <Icon name={row.icon} size={20} className="mt-0.5 shrink-0 text-text-muted" />
      <div className="flex flex-col gap-0.5">
        <p className="text-md text-text-primary">
          {row.headline}
          {isQueueAutopick ? <InfoTip term="queue" className="ml-1" /> : null}
        </p>
        {row.detail === null ? null : <p className="text-sm text-text-muted">{row.detail}</p>}
        <time dateTime={row.occurredAt} className="text-xs text-text-muted">
          {formatOccurredAt(row.occurredAt)}
        </time>
      </div>
    </li>
  );
}

/**
 * The chronological, member-visible half of Task 10: `rows` arrive already rendered by
 * `activityRowFor` (Task 9's allowlist) — this component prints them, it never re-derives
 * visibility or re-sorts. Deliberately NOT `"use client"`: `Show older` is a plain `<Link>`
 * carrying a `before` cursor in the query string, so the history reads with no JavaScript at
 * all, and the page it lives on is a document, not a room (`docs/design-system.md`, "Layout:
 * pages vs. rooms") — this plan's own closing note says the feed is a history, not a second
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
