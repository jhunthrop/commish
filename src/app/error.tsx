"use client";

import Link from "next/link";
import { Button, ErrorState } from "@/components/ui";

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
 */
export default function AppError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  return (
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
              <Link
                href="/app"
                className="inline-flex h-10 items-center justify-center rounded-md border border-line px-4 text-md font-medium text-text-primary transition-colors hover:bg-surface-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                Go to your leagues
              </Link>
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
