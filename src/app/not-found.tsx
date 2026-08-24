import Link from "next/link";
import { EmptyState } from "@/components/ui";
import { PublicBar } from "@/components/app-shell/public-bar";

const LINK_CLASS =
  "inline-flex h-10 items-center justify-center rounded-md px-4 text-md font-medium transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

/**
 * A wrong URL is not a failure, so this is an `EmptyState` and not an `ErrorState`: no
 * `role="alert"`, no apology, no retry (retrying the same missing URL cannot help). Two ways on,
 * because the two things a visitor could have been looking for are a league they are in and a
 * league they might join.
 *
 * Renders `PublicBar` unconditionally (F14, the same reasoning `src/app/error.tsx` states): a
 * 404 catches every unmatched URL, including one a total stranger followed with no account at
 * all, and this component has no session to check even if it wanted to guess. Its own primary
 * action changed with it — "Go to your leagues" (`/app`) used to be a bounce into hosted sign-in
 * for anyone without a session, so it is "Go to the home page" (`/`) now, the same escape
 * `/reviews`'s own rate-limit refusal already uses. `PublicBar` adds a second way out on top: its
 * wordmark is `/` too, and its `SignInLink` works whether this visitor has an account or not.
 */
export default function NotFound() {
  return (
    <>
      <PublicBar intent={null} />
      <main className="mx-auto flex min-h-[60vh] max-w-lg items-center px-4">
        <EmptyState
          icon="search"
          title="We couldn't find that page."
          description="That link may be outdated. The page you were looking for is not here."
          action={
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link href="/" className={`${LINK_CLASS} bg-accent text-accent-text hover:brightness-110`}>
                Go to the home page
              </Link>
              <Link href="/browse" className={`${LINK_CLASS} border border-line text-text-primary hover:bg-surface-elevated`}>
                Browse open leagues
              </Link>
            </div>
          }
        />
      </main>
    </>
  );
}
