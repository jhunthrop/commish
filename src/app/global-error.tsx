"use client";

import "./globals.css";
// Imported from its own file, not the `@/components/ui` barrel: the last boundary should not
// depend on every primitive the barrel re-exports being importable while the app is failing.
import { Button } from "@/components/ui/button";

/**
 * The last boundary: this replaces the ROOT layout, so it must render its own `<html>` and
 * `<body>` and import the stylesheet itself. It cannot use `ThemeProvider` or any primitive
 * that assumes the app shell mounted, because the reason it is rendering at all may be that the
 * shell threw. Token class names still resolve because `globals.css` is imported directly here.
 * `Button` qualifies: it assumes nothing mounted (no context, no provider), so even the last
 * boundary renders the real primitive rather than the hand-inlined copy of its classes it
 * carried before Task 4's accent-budget sweep banned that copy (E8).
 *
 * Same rule as `error.tsx`: the raw exception text never reaches the page, the digest does.
 *
 * The `<main>...</main>` body is split out as `GlobalErrorContent` so it can be exercised
 * directly by `renderSurface`/`axe` in the test suite: React treats `<html>`/`<body>` as host
 * singletons and always reconciles them onto the real `document.documentElement`/`document.body`
 * rather than nesting them under a test container, which puts the actual accessibility surface
 * (headings, copy, the retry control) out of `axe`'s reach if it is only ever tested through the
 * full `GlobalError`. `GlobalErrorContent` is not itself a Next.js convention file — it exists
 * purely so the tested UI and the shipped UI are the same tree.
 */
export function GlobalErrorContent({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-lg font-semibold text-text-primary">Something went wrong on our side.</h1>
      <p className="max-w-prose text-sm text-text-muted">
        This one is on us, not on you. Reload the page, and if it keeps happening try again in a few minutes.
      </p>
      <p className="max-w-prose text-sm text-text-muted">Your leagues are not affected. Reload to keep going.</p>
      {/* This boundary's ONE action (rule 5), so it is the view's ink pill. */}
      <Button onClick={reset}>Try again</Button>
      {error.digest === undefined ? null : <p className="text-sm text-text-muted">Reference {error.digest}</p>}
    </main>
  );
}

/** The actual Next.js convention export: the document shell around `GlobalErrorContent`. */
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
        <GlobalErrorContent error={error} reset={reset} />
      </body>
    </html>
  );
}
