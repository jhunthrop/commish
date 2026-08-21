import Link from "next/link";
import { getDb } from "@/db/client";
import { listPendingFlags } from "@/integrity-service/flags";
import { formatFlagCursor, parseFlagCursor } from "@/integrity/queue-view";
import { AppHeader } from "@/components/app-shell/app-header";
import { Card, EmptyState, PageTitle } from "@/components/ui";
import { Icon } from "@/components/ui/icon";
import { withAdmin } from "@/app/api/admin/_shared";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

function formatWaitingSince(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** The same "first string value, or none" query-param reader `LeagueActivityPage` uses. */
const first = (value: string | readonly string[] | undefined): string | null =>
  typeof value === "string" ? value : Array.isArray(value) ? (value[0] ?? null) : null;

/** An untrusted `?before=` cursor that doesn't decode reads as "no cursor" (the first page) —
 *  the same fail-closed discipline `LeagueActivityPage`'s own `parseBefore` uses. */
function parseBefore(raw: string | null): { readonly raisedAt: string; readonly id: string } | undefined {
  if (raw === null) return undefined;
  const cursor = parseFlagCursor(raw);
  return cursor ?? undefined;
}

/**
 * The queue's own page: `withAdmin`'s Server Component overload, then the read
 * (`listPendingFlags`), then render. No filter, no sort control — ruling 30 is that oldest-first
 * with no severity sort is the whole discipline, not a default a UI control could override.
 *
 * Pagination is a plain `Load more` link carrying `?before=` — a real navigation, not client
 * JavaScript, the same "reads with no JavaScript at all" discipline `ActivityFeed`'s own `Show
 * older` link holds to (`src/league-room/components/activity-feed.tsx`). Named `Load more`
 * rather than that link's `Show older`: this queue pages FORWARD through time (oldest first,
 * `raised_at ASC`), so the next page is NEWER flags, not older ones — reusing the other page's
 * label here would say the wrong direction.
 *
 * The empty state is the state an operator sees most, and it still may not be a dead end: it
 * says the queue is clear, not that nothing is happening — those are different facts, and an
 * operator wants to tell them apart (Task 5's own brief). There is no "most recently active
 * league" signal wired into this read yet, so the link goes to the league list itself rather
 * than guessing; a future task that adds one can replace this without touching the empty state's
 * words. `rows.length === 0` renders that empty state only when `nextBefore` is ALSO `null` —
 * a page that came back with a full page of rows (`INTEGRITY_CONFIG.queue.pageSize`) and a real
 * cursor is never the "clear" state, even in the pathological case every row on it turned out to
 * render nothing (today, every row always renders something, but the guard costs nothing).
 */
export default async function AdminQueuePage({ searchParams }: PageProps) {
  const query = await searchParams;
  const before = parseBefore(first(query.before));

  return withAdmin(async (operator) => {
    const page = await listPendingFlags(getDb(), { before });

    return (
      <>
        <AppHeader displayName={operator.displayName} avatar={operator.avatarUrl} isAdmin={operator.isAdmin} />
        <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4">
          <header className="flex flex-col gap-1">
            <PageTitle>Dispute queue</PageTitle>
            <p className="text-sm text-text-muted">Oldest first. Nothing here is ranked by how serious it looks.</p>
          </header>

          {page.rows.length === 0 && page.nextBefore === null ? (
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
            <>
              <ul className="flex flex-col gap-3" aria-label="Open flags">
                {page.rows.map((row) => (
                  <li key={row.flagId}>
                    <Card as="article">
                      <Link href={`/app/admin/queue/${row.flagId}`} className="flex items-start gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                        <Icon name={row.icon} size={20} className="mt-0.5 shrink-0 text-text-muted" />
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <p className="break-words font-medium text-text-primary">{row.question}</p>
                          <p className="break-words text-sm text-text-muted">{row.about}</p>
                          <time dateTime={row.raisedAt} className="text-xs text-text-muted">
                            Waiting since {formatWaitingSince(row.raisedAt)}
                          </time>
                        </div>
                      </Link>
                    </Card>
                  </li>
                ))}
              </ul>
              {page.nextBefore === null ? null : (
                <Link className="text-accent underline" href={`/app/admin/queue?before=${encodeURIComponent(formatFlagCursor(page.nextBefore))}`}>
                  Load more
                </Link>
              )}
            </>
          )}
        </main>
      </>
    );
  });
}
