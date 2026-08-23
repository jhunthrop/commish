import Link from "next/link";
import { getDb } from "@/db/client";
import { getCurrentUser } from "@/lib/auth/current-user";
import { readPreferences } from "@/identity-service/preferences";
import { PageTitle } from "@/components/ui";
import { JoinForm } from "@/league-room/components/join-form";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly code: string }>;
}

/**
 * The shareable invite link's destination, and the ONE page under `/app` a signed-out visitor
 * reaches (`middleware.ts`'s single exemption, whose docblock states how tightly it is scoped).
 *
 * Lives in the `(public)` route group (Task 2), a sibling of `(shell)`: this segment DECLINES
 * `(shell)/layout.tsx`'s `AppShell` entirely — a signed-in shell around a page a stranger can
 * land on unauthenticated would be chrome nobody signed out can use, and the rail's own leagues
 * would be somebody's private list drawn beside a link anyone with the URL can open. A route
 * group changes no URL, so `/app/join/[code]` still resolves exactly as every existing invite
 * link expects.
 *
 * That exemption is what makes `GET /api/invites/[code]`'s documented unauthenticated ruling
 * TRUE rather than aspirational: the record says a prospect sees what they are joining "before
 * holding an account", and until this page rendered signed out, no signed-out visitor could
 * reach the preview at all. Signed out, the terms render and the action is "Sign in to join" —
 * the same idiom `PublicLeagueList` uses on `/browse`. Signed in, still no shell renders here —
 * the addendum's Task 16 (`PublicBar`) is this page's eventual signed-out chrome; until it lands
 * this page keeps its own inline header, unchanged.
 *
 * `readPreferences` (the same seed-on-first-read call the league home page makes) only runs when
 * there IS a caller: a signed-out visitor has no preferences row and must not seed one. Their
 * `InfoTip`s open `guided` unconditionally, exactly as `/browse`'s do and for the same reason —
 * a stranger deciding whether to join benefits most from more explanation, not less.
 */
export default async function JoinPage({ params }: PageProps) {
  const [user, { code }] = await Promise.all([getCurrentUser(), params]);
  const preferences = user === null ? null : await readPreferences(getDb(), user);

  return (
    <>
      {user === null ? (
        <header className="border-b border-line bg-surface">
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
      ) : null}
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
        <PageTitle>Join a league</PageTitle>
        <JoinForm code={code} helpLevel={preferences?.helpLevel ?? "guided"} signedIn={user !== null} />
      </main>
    </>
  );
}
