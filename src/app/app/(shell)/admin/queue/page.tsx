import type { Metadata } from "next";
import { getDb } from "@research-ts/db/client";
import { listPendingFlags } from "@/integrity-service/flags";
import { formatFlagCursor, parseFlagCursor } from "@/integrity/queue-view";
import { PageTitle } from "@/components/ui";
import { withAdmin } from "@/app/api/admin/_shared";
import { QueueTable } from "@/admin-room/components/queue-table";
import { pageTitle } from "@/components/app-shell/page-metadata";

export const dynamic = "force-dynamic";
// A5: matches this page's own <h1>, and `AdminConsoleNav`'s label for this route.
export const metadata: Metadata = pageTitle("Dispute queue");

interface PageProps {
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
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
 * The dense queue itself, the `Load more` pagination and the empty state all live in
 * `QueueTable` (`@/admin-room/components/queue-table`, Task 19) now — this page's own job shrinks
 * to the two reads (`parseBefore`, `listPendingFlags`) and building the `Load more` href with
 * `formatFlagCursor`, which it hands down as a plain string. That last part cannot move into
 * `QueueTable` itself: `src/admin-room/**` may not value-import `@/integrity` (the client
 * boundary, `eslint.config.mjs`), and `formatFlagCursor` is one of its value exports — the same
 * "cross the boundary via props, not via import" shape `noticePreviewsFor` on the detail page
 * already uses for `ResolutionForm`'s own preview data.
 *
 * Renders no `TopBar` and no `<main>` of its own (Task 2 Step 5) — `(shell)/layout.tsx` supplies
 * both, once, for every page in this route group. `withAdmin`'s render callback still receives
 * the full operator (its own docblock explains why it is the full row, not just an id) — this
 * page simply has no field of it left to render itself now that `TopBar` reads it instead.
 */
export default async function AdminQueuePage({ searchParams }: PageProps) {
  const query = await searchParams;
  const before = parseBefore(first(query.before));

  return withAdmin(async () => {
    const page = await listPendingFlags(getDb(), { before });
    const nextHref = page.nextBefore === null ? null : `/app/admin/queue?before=${encodeURIComponent(formatFlagCursor(page.nextBefore))}`;

    return (
      <>
        <header className="flex flex-col gap-1">
          <PageTitle>Dispute queue</PageTitle>
          <p className="text-sm text-text-muted">Oldest first. Nothing here is ranked by how serious it looks.</p>
        </header>

        <QueueTable rows={page.rows} nextHref={nextHref} />
      </>
    );
  });
}
