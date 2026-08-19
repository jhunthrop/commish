"use client";

import "./globals.css";

/**
 * The last boundary: this replaces the ROOT layout, so it must render its own `<html>` and
 * `<body>` and import the stylesheet itself. It cannot use `ThemeProvider` or any primitive
 * that assumes the app shell mounted, because the reason it is rendering at all may be that the
 * shell threw. Token class names still resolve because `globals.css` is imported directly here.
 *
 * Same rule as `error.tsx`: the raw exception text never reaches the page, the digest does.
 *
 * The inlined button below carries `Button`'s `BASE` classes (including `gap-2`, for the icon
 * spacing `Button` itself reserves) but deliberately drops the `disabled:` variant classes:
 * this button is never disabled (there is no `loading` state here, and `reset` is always
 * callable), so those classes would be dead weight copied for parity's own sake.
 *
 * The `<main>...</main>` body is split out as `GlobalErrorContent` so it can be exercised
 * directly by `inBothThemes`/`axe` in the test suite: React treats `<html>`/`<body>` as host
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
      <button
        type="button"
        onClick={reset}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 text-md font-medium text-accent-text transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        Try again
      </button>
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
