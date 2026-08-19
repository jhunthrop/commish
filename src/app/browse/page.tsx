import Link from "next/link";
import { getDb } from "@/db/client";
import { getCurrentUser } from "@/lib/auth/current-user";
import { PageTitle } from "@/components/ui";
import { AppHeader } from "@/components/app-shell/app-header";
import { listPublicLeagues } from "@/league-service/browse";
import { normalizeBrowseFilter } from "@/matchmaking/filter";
import { BrowseFilters } from "@/league-room/components/browse-filters";
import { PublicLeagueList } from "@/league-room/components/public-league-list";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

const first = (value: string | readonly string[] | undefined): string | null =>
  typeof value === "string" ? value : Array.isArray(value) ? value[0] ?? null : null;

/**
 * The public front door to matchmaking, and the only page under a non-`/app` prefix that reads
 * league data. `middleware.ts` does not redirect outside `/app`, so this renders for a
 * signed-out visitor by design — `getCurrentUser()` returning null is the expected case, not an
 * error, and the only thing it changes is whether a card offers a join button or a sign-in
 * link. The signed-in chrome (`AppHeader`) appears only when there is a person to name.
 */
export default async function BrowsePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const filter = normalizeBrowseFilter({
    format: first(params.format),
    experienceTier: first(params.experienceTier),
    stakeTier: first(params.stakeTier),
  });
  const user = await getCurrentUser();
  const leagues = await listPublicLeagues(getDb(), filter);

  return (
    <>
      {user === null ? (
        <header className="border-b border-border bg-surface">
          <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-4 py-3">
            <Link
              href="/"
              className="font-display text-xl font-bold uppercase tracking-wide text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Commish
            </Link>
            <Link href="/sign-in" className="text-sm font-medium text-accent underline">
              Sign in
            </Link>
          </div>
        </header>
      ) : (
        <AppHeader displayName={user.displayName} />
      )}
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4">
        <PageTitle>Open leagues</PageTitle>
        <p className="max-w-prose text-text-muted">
          Leagues looking for managers, with a draft still to come. Pick one that matches how you
          like to play.
        </p>
        <BrowseFilters filter={filter} />
        <PublicLeagueList leagues={leagues} signedIn={user !== null} />
      </main>
    </>
  );
}
