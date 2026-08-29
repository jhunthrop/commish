import Link from "next/link";
import { ButtonLink, EmptyState, LowerThird, Table, type TableColumn } from "@/components/ui";
import { ChapterBand } from "@/components/ui/chapter-band";
import { UI_CONFIG } from "@/components/ui/config";
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

/** The exact instant, for the cell's `title` and for anyone who has to quote it in a support
 *  thread — the fact `formatWaited` rounds away, kept one hover from the operator's hand. */
function formatWaitingSince(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * How long this flag has been waiting, in the unit an operator actually thinks in.
 *
 * The column used to print "Aug 23, 2026, 11:56 AM", which is a fact about the calendar and not a
 * fact about the queue: an operator scanning oldest-first has to subtract today's date from every
 * row to learn the one thing they came for, and does it once per row down the page.
 *
 * **WHY THIS IS NOT `formatCoarseDuration` (`@/components/ui/countdown`), WHICH SAYS THE SAME
 * THING.** That module carries `"use client"`, and `QueueTable` is a Server Component — Next
 * hands a server caller a client REFERENCE for every value export of a client module, so calling
 * it throws *"Attempted to call formatCoarseDuration() from the server"* at render. It is a real
 * boundary, not a lint preference, and it is invisible to `tsc`, to `eslint` and to this file's
 * own jsdom tests; only rendering the actual page finds it.
 *
 * What is NOT duplicated is the part that could meaningfully drift: the three bucket boundaries
 * are `UI_CONFIG.countdown`'s own, read from `@/components/ui/config`, which carries no directive
 * and is therefore legal on both sides of the boundary. So "2 days" means the same thing here as
 * it does in the waiting room's "Starts in …" by construction, and the only thing this function
 * owns is the sentence — which it should own anyway, because a queue reports time ELAPSED where
 * the countdown reports time REMAINING, and only one of the two is ever allowed to be negative.
 *
 * NOT a severity signal, and deliberately carrying no tint, no chip and no sort control: ruling 30
 * is that oldest-first with nothing ranked by how serious it looks IS the discipline. An age is
 * the queue's own established order stated plainly, which is the opposite of re-ranking it.
 */
function formatWaited(iso: string, now: number): string {
  const { coarseRemainingMinuteMs, coarseRemainingHourMs, coarseRemainingDayMs } = UI_CONFIG.countdown;
  // Clamped at zero: a `raised_at` in the future is a clock-skew artifact, not a negative age.
  const elapsed = Math.max(0, now - new Date(iso).getTime());
  if (elapsed < coarseRemainingMinuteMs) return "under a minute";
  if (elapsed < coarseRemainingHourMs) return plural(Math.round(elapsed / coarseRemainingMinuteMs), "minute");
  if (elapsed < coarseRemainingDayMs) return plural(Math.round(elapsed / coarseRemainingHourMs), "hour");
  return plural(Math.round(elapsed / coarseRemainingDayMs), "day");
}

/** "1 day", "3 days" — the same shape `Countdown`'s own private `plural` produces, and private
 *  here for the same reason it is private there. */
function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/**
 * The queue's two chapters, split on the boundary the age column already rounds to: a day.
 *
 * A FILTER, NEVER A SORT (ruling 30). `rows` arrives ordered `raised_at ASC` and every row over a
 * day old necessarily precedes every row under it, so partitioning preserves the caller's order
 * exactly — `Array.prototype.filter` twice, and no comparator anywhere in this file. That is the
 * whole reason the split is legal on a surface whose defining discipline is "oldest first, with
 * nothing ranked by how serious it looks": this re-ranks nothing, it only NAMES a boundary the
 * order had already put the rows on either side of.
 *
 * The boundary is `UI_CONFIG.countdown.coarseRemainingDayMs`, the same constant `formatWaited`
 * rounds against, so the band and the cell beneath it can never disagree about what "1 day"
 * means.
 */
function splitByAge(rows: readonly QueueRow[], now: number): { readonly overdue: readonly QueueRow[]; readonly fresh: readonly QueueRow[] } {
  const dayMs = UI_CONFIG.countdown.coarseRemainingDayMs;
  const isOverdue = (row: QueueRow): boolean => now - new Date(row.raisedAt).getTime() >= dayMs;
  return { overdue: rows.filter(isOverdue), fresh: rows.filter((row) => !isOverdue(row)) };
}

/** Built per render rather than declared once, because the age column is relative to NOW and a
 *  module-level constant would be relative to whenever the server process started. `now` is read
 *  once per render and threaded in, so every row on a page is measured against the same instant —
 *  a per-cell `Date.now()` would let two rows disagree about when "now" was. */
function columnsAsOf(now: number): readonly TableColumn<QueueRow>[] {
  return [
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
      header: "Waited",
      cell: (row) => (
        <time dateTime={row.raisedAt} title={formatWaitingSince(row.raisedAt)} className="whitespace-nowrap font-mono text-text-muted">
          {formatWaited(row.raisedAt, now)}
        </time>
      ),
      // Supplementary detail, already restated by the row's own link (an operator can still open
      // the flag with no idea how long it has waited) — dropped below `sm`, the same
      // `hideOnNarrow` discipline `standings-table.tsx`'s own "Points against" column uses to keep
      // the 360px layout readable.
      hideOnNarrow: true,
      // Right-aligned and tabular (law 4): a column of durations is scanned down its own right
      // edge, which is what `Table`'s `numeric` flag is for, and mono is what stops "2 days" and
      // "11 hours" jittering against each other row to row.
      numeric: true,
    },
  ];
}

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
  // ONE instant for the whole table (see `columnsAsOf`). A Server Component render on a
  // `force-dynamic` page, so this is server time — never a client clock that could disagree with
  // the ordering the query established.
  const now = Date.now();
  const columns = columnsAsOf(now);
  const { overdue, fresh } = splitByAge(rows, now);
  // The next item to act on, which is the oldest one, because that is the only order this queue
  // has. `rows` is already `raised_at ASC`, so it is simply the head.
  const oldest = rows[0];

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
        <div className="flex flex-col">
          {/* SUNDAY v5, LAW 5 — chapter markers, not hairlines. The split is the ONE fact this
              queue already holds and never said out loud: how long a question has been waiting.
              Oldest-first ordering makes the partition free (`splitByAge` filters, it never
              sorts), so ruling 30's discipline is untouched — nothing is re-ranked, nothing is
              graded by how serious it looks, and a band is only ever drawn over rows that exist.
              The bands say the CONSEQUENCE in plain words, which is the half of law 5 that does
              the work: an operator arriving mid-column learns what the rows beneath share.

              THE OVERDUE PLATE IS `warn`, NOT `live`, AND THE DISTINCTION IS LAW 4's. Red means
              "happening right now, and nothing else ever" — a flag raised yesterday is not an
              event in the present tense, it is a clock that has run long, and amber-orange is
              exactly the channel v5 reserves for that ("a tightening clock", deliberately a
              separate hue from the furniture amber). Nothing on an operator surface is live, and
              spending the live channel here is how it stops meaning anything on the surfaces
              where something genuinely is. */}
          {overdue.length === 0 ? null : (
            <>
              <ChapterBand name="Waited over a day" consequence="Somebody has been waiting since yesterday" tone="warn" />
              <Table caption="Flags waiting over a day" columns={columns} rows={overdue} rowKey={(row) => row.flagId} empty={null} />
            </>
          )}
          {fresh.length === 0 ? null : (
            <>
              <ChapterBand name="Fresh" consequence="Raised today" />
              <Table caption="Flags raised today" columns={columns} rows={fresh} rowKey={(row) => row.flagId} empty={null} />
            </>
          )}
        </div>
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

      {/* SUNDAY v5, LAW 6 — a queue with a next item to act on ends in a lower third; a clear
          queue does not. That conditional IS the law's own diagnostic applied honestly rather
          than a strip drawn for symmetry: when there is nothing waiting there is no decision, so
          the page ends on its empty state and stops talking.

          The verb is "Open the oldest" because oldest-first is this queue's whole discipline
          (ruling 30) and the strip is where a discipline becomes an act. The count carries a "+"
          the moment a cursor says there are more flags than this page holds — law 7: a page's own
          row count is not the queue's depth, and printing it as though it were would be a number
          we cannot stand behind. */}
      {oldest === undefined ? null : (
        <LowerThird
          cells={[
            { label: "Open flags", value: nextHref === null ? String(rows.length) : `${rows.length}+` },
            { label: "Waiting longest", value: formatWaited(oldest.raisedAt, now) },
          ]}
          action={
            <ButtonLink href={`/app/admin/queue/${oldest.flagId}`} variant="verb">
              Open the oldest
            </ButtonLink>
          }
        />
      )}
    </div>
  );
}
