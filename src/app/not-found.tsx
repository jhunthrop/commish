import { ButtonLink, EmptyState } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/current-user";
import { PublicBar, STOREFRONT_NAV } from "@/components/app-shell/public-bar";

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
export default async function NotFound() {
  const user = await getCurrentUser();
  return (
    <>
      <PublicBar intent={null} signedIn={user !== null} nav={STOREFRONT_NAV} />
      <main className="mx-auto flex min-h-[60vh] max-w-lg items-center px-4">
        <EmptyState
          icon="search"
          title="We could not find that page."
          description="That link may be outdated. The page you were looking for is not here."
          action={
            <div className="flex flex-wrap items-center justify-center gap-3">
              {/* One ink action per view (rule 5): the escape hatch is the ink pill, the
                  browse alternative the quiet one. */}
              <ButtonLink href="/">Go to the home page</ButtonLink>
              <ButtonLink href="/browse" variant="secondary">
                Browse open leagues
              </ButtonLink>
            </div>
          }
        />
      </main>
    </>
  );
}
