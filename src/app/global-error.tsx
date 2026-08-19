"use client";

import "./globals.css";

/**
 * The last boundary: this replaces the ROOT layout, so it must render its own `<html>` and
 * `<body>` and import the stylesheet itself. It cannot use `ThemeProvider` or any primitive
 * that assumes the app shell mounted, because the reason it is rendering at all may be that the
 * shell threw. Token class names still resolve because `globals.css` is imported directly here.
 *
 * Same rule as `error.tsx`: the raw exception text never reaches the page, the digest does.
 */
export default function GlobalError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-4 text-center">
          <h1 className="text-lg font-semibold text-text-primary">Something went wrong on our side.</h1>
          <p className="max-w-prose text-sm text-text-muted">
            This one is on us, not on you. Reload the page, and if it keeps happening try again in a few minutes.
          </p>
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-10 items-center justify-center rounded-md bg-accent px-4 text-md font-medium text-accent-text transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            Try again
          </button>
          {error.digest === undefined ? null : <p className="text-sm text-text-muted">Reference {error.digest}</p>}
        </main>
      </body>
    </html>
  );
}
