import type { Metadata } from "next";

/**
 * The one rule every page title obeys (flow analysis A5, N11): "<page> · Commish". Every one of
 * the product's 29 routes used to set `document.title = "Commish"` — only `src/app/layout.tsx`
 * declared metadata, and no page overrode it, so history entries, tabs and bookmarks were
 * indistinguishable everywhere browser-back is the only exit (N1, N5).
 *
 * This string is the SINGLE place the " · Commish" suffix is assembled — `src/app/layout.tsx`'s
 * root `metadata.title.template` is the only consumer. A page never types the suffix itself; it
 * calls `pageTitle` (below) with its own short name and Next composes the rest via this template,
 * the same "one string owns the pattern" discipline `NEXT_ACTION_COPY` already applies to league
 * action labels (`@/league/next-action.ts`).
 */
export const TITLE_TEMPLATE = "%s · Commish";

/**
 * The one line the product uses to introduce itself outside its own chrome — the root layout's
 * `metadata.description` and `opengraph-image.tsx`'s own tagline (Task 3, brand adoption pass).
 * A single constant rather than two copies of the same sentence: a link unfurl and a search
 * result are two renderings of the same claim, and letting them drift is how a tagline stops
 * matching what a stranger reads on the page it points at.
 */
export const TAGLINE = "Season-long fantasy football, done right.";

/**
 * Builds a page's `metadata` export from its own short, page-specific title — "Your leagues",
 * never "Your leagues · Commish". Next's `title.template` (`src/app/layout.tsx`) appends the
 * product name, so every page that calls this agrees on the suffix by construction; there is no
 * second place in the codebase that could drift from it.
 *
 * For a route whose real title needs data this file has no business reading (a league's name, a
 * draft's own record), use an honest static title instead of fetching — "League home", "Draft
 * room" — rather than a DB read a `metadata`/`generateMetadata` export does not otherwise need
 * (flow analysis A5's own ruling: an honest static title beats a fetch that exists only to name
 * a browser tab).
 */
export function pageTitle(title: string): Metadata {
  return { title };
}
