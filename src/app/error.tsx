"use client";

import { Button, ButtonLink, ErrorState } from "@/components/ui";
import { PublicBar } from "@/components/app-shell/public-bar";

/**
 * The route-segment error boundary for every page under `src/app`. Next.js renders this in
 * place of the segment when a Server or Client Component throws during render.
 *
 * It deliberately does NOT render `error.message`. `docs/conventions.md` is explicit that
 * user-facing error strings are plain language and never raw DB or exception text, and a
 * boundary is exactly where that rule is easiest to break: `error.message` at this point may be
 * a Postgres relation name, a driver stack, or an upstream provider's response body. The
 * `digest` is different — it is a hash Next generates precisely so a user can quote it and an
 * operator can find the matching server log line, so it is shown as a quiet reference.
 *
 * Renders `PublicBar` unconditionally (F14). This is a Client Component, and it cannot know
 * whether there is a session: `getCurrentUser()` is server-side, and an error boundary that
 * guesses gets it wrong exactly when the thing it guessed with is what broke. `PublicBar` is the
 * honest chrome for an unknown session — a wordmark home link and one sign-in link, both of
 * which work whether the visitor reading this is a member or a stranger — where a rail with no
 * leagues in it would be a lie and a rail with somebody's leagues in it is data this boundary
 * does not have.
 */
export default function AppError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  return (
    <>
      <PublicBar intent={null} />
      <main className="mx-auto flex min-h-[60vh] max-w-lg items-center px-4">
        <div className="w-full">
          <ErrorState
            title="Something went wrong on our side."
            description="This one is on us, not on you. Nothing about your leagues has changed. Try again, or head back to your leagues."
            action={
              <div className="flex flex-wrap items-center justify-center gap-3">
                <Button variant="primary" onClick={reset}>
                  Try again
                </Button>
                {/* Task 10 pill sweep: this used to be a `Link` wearing a hand-rolled copy of the
                    quiet-pill classes (`rounded-md`, `border-line`) — exactly the drift
                    `buttonClassName`'s docblock (E8) exists to end. `ButtonLink`'s `secondary`
                    variant is the real quiet pill: `rounded-pill`, `border-edge`. */}
                <ButtonLink href="/app" variant="secondary">
                  Go to your leagues
                </ButtonLink>
              </div>
            }
          />
          {error.digest === undefined ? null : (
            <p className="mt-4 text-center text-sm text-text-muted">Reference {error.digest}</p>
          )}
        </div>
      </main>
    </>
  );
}
