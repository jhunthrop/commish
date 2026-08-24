import Link from "next/link";
import { EmptyState, Table, type TableColumn } from "@/components/ui";
import { Icon } from "@/components/ui/icon";
import type { QueueRow } from "@/integrity/queue-view";

export interface QueueTableProps {
  readonly rows: readonly QueueRow[];
  /**
   * The `Load more` link's own href, already built server-side — never constructed here.
   * `src/admin-room/**` may not value-import `@/integrity` (the client boundary,
   * `eslint.config.mjs`), and `formatFlagCursor` is a value export of it; the page computes the
   * whole href with that function and hands down a plain string, the same "cross the boundary
   * via props, not via import" shape `resolution-form.tsx`'s own `previews` prop already uses.
   * `null` once the queue has paged to its end, and no link renders. Defaults to `null` so a
   * caller that only cares about the row rendering (this file's own tests) can omit it.
   */
  readonly nextHref?: string | null;
}

function formatWaitingSince(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const COLUMNS: readonly TableColumn<QueueRow>[] = [
  {
    key: "icon",
    // Visual-only in the dense row; the accessible name lives in this sr-only header instead of
    // repeating "Kind" on every row. Never a severity glyph standing in for a word ruling 30
    // already forbids — the icon says what KIND of question this is (a report, a hold, a
    // platform-raised pair), the same four icons `ICON_FOR_FLAG_TYPE` (`@/integrity/queue-view`)
    // already picks by flag type, nothing about how serious it looks.
    header: <span className="sr-only">Kind</span>,
    cell: (row) => <Icon name={row.icon} size={18} className="text-text-muted" />,
  },
  {
    key: "question",
    header: "Question",
    cell: (row) => (
      <Link
        href={`/app/admin/queue/${row.flagId}`}
        className="font-medium text-text-primary hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {row.question}
      </Link>
    ),
  },
  {
    key: "about",
    header: "About",
    cell: (row) => <span className="break-words text-text-muted">{row.about}</span>,
  },
  {
    key: "raisedAt",
    header: "Waiting since",
    cell: (row) => (
      <time dateTime={row.raisedAt} className="whitespace-nowrap text-text-muted">
        {formatWaitingSince(row.raisedAt)}
      </time>
    ),
    // Supplementary detail, already restated by the row's own link (an operator can still open
    // the flag with no idea how long it has waited) — dropped below `sm`, the same
    // `hideOnNarrow` discipline `standings-table.tsx`'s own "Points against" column uses to keep
    // the 360px layout readable.
    hideOnNarrow: true,
  },
];

/**
 * The queue, dense (Task 19). Oldest first, with no sort control at all — ruling 30's own
 * discipline restated in code, not merely stated in the caller's own copy: a dense table is
 * exactly where somebody would reflexively add sortable headers, and this one has none. `rows`
 * arrives already ordered (`listPendingFlags`, `raised_at ASC`) and is rendered in that order,
 * unchanged — no client-side `Array.prototype.sort` anywhere in this file, the one thing that
 * would silently undo the ordering the caller worked to establish.
 *
 * The empty state is the state an operator sees most, and it is designed first, not a fallback
 * bolted beneath a table that happens to have nothing to show: "The queue is clear." is a
 * different fact from "nothing is happening", and an operator wants to tell the two apart (the
 * brief's own words) — the same distinction the page this replaces already drew. A page that came
 * back with zero rows but a real cursor (pathological today; every row currently renders
 * something) is NOT the clear state — `Table`'s own `empty` prop stays unused in that branch
 * (`empty={null}`) so the row area renders nothing rather than a false "all clear".
 */
export function QueueTable({ rows, nextHref = null }: QueueTableProps) {
  const clear = rows.length === 0 && nextHref === null;

  return (
    <div className="flex flex-col gap-3">
      {clear ? (
        <EmptyState
          title="The queue is clear."
          description="Nothing is waiting on a decision right now."
          action={
            <Link href="/app" className="text-accent underline">
              Go to your leagues
            </Link>
          }
        />
      ) : (
        <Table caption="Open flags" columns={COLUMNS} rows={rows} rowKey={(row) => row.flagId} empty={null} />
      )}
      {/* A real navigation carrying `?before=` (reads with no JavaScript at all, the same
          discipline `ActivityFeed`'s own `Show older` link holds to) — never client-side
          pagination state. Named `Load more`, not `Show older`: this queue pages FORWARD through
          time (oldest first, `raised_at ASC`), so the next page is NEWER flags, not older ones. */}
      {nextHref === null ? null : (
        <Link className="text-accent underline" href={nextHref}>
          Load more
        </Link>
      )}
    </div>
  );
}
