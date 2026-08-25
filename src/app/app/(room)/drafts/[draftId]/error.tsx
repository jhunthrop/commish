"use client";

import { Button, ButtonLink, ErrorState } from "@/components/ui";

/**
 * The draft room's own error boundary (F14). The `(room)` route group declines
 * `(shell)/layout.tsx` entirely (`DraftRoomPage`'s own docblock: "renders no shell"), so without
 * this file a throw inside the room would fall all the way up to the root boundary
 * (`src/app/error.tsx`) and hand someone mid-draft a generic page with no way back into the room
 * they were just in. This one's frame is the room's own full-bleed one, not the shell's
 * `mx-auto max-w-lg`.
 *
 * `reset()` is the PRIMARY action, labelled "Try the room again": a re-render is the fix most of
 * the time here, and leaving by URL and coming back costs a real socket reconnect on top of
 * whatever broke. "Go to your leagues" is offered second, for when the room itself is the
 * problem.
 *
 * Prints no exception text and no digest beyond the same quiet reference `src/app/error.tsx` and
 * `global-error.tsx` already use, and it never claims a pick or a bid did or did not go through —
 * this boundary has no way to know either way, and a wrong guess in either direction would be
 * worse than saying nothing about it.
 */
export default function DraftRoomError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  return (
    <main className="flex min-h-dvh w-full items-center justify-center px-4">
      <div className="w-full max-w-lg">
        <ErrorState
          title="Something went wrong in the room."
          description="This does not confirm whether your last pick or bid went through. Try the room again to see where things stand."
          action={
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button variant="primary" onClick={reset}>
                Try the room again
              </Button>
              {/* Task 10 pill sweep: same fix as `src/app/error.tsx` — a hand-rolled `Link`
                  copying the quiet-pill classes, replaced with the real primitive. */}
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
  );
}
