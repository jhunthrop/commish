"use client";

/**
 * TANSTACK QUERY, ADOPTED FIRST FOR THE SIMULATOR (Task 3) — mounted at the `/app/draft` SEGMENT
 * (this file's own layout, `src/app/app/(shell)/draft/layout.tsx`), not at the whole-app root.
 *
 * WHY THIS SCOPE, DOCUMENTED (the brief asks for the decision, not only the code): the Simulator
 * is the first surface in this codebase that needs a client-side data layer with real caching,
 * background polling (a queued sim's status) and mutation-driven invalidation (creating a run
 * invalidates the list). Every other surface in this product today is server-rendered per
 * request or reads its own client-local state (`useState`/`useReducer`) with no shared cache
 * worth naming. Mounting the provider at the whole app's root would mean every one of those
 * pages carries a client boundary and a query-client instance it never asked for and never
 * reads from — dead weight on first load for the entire app to buy one section's feature.
 * Scoping it to `/app/draft` means:
 *
 *  - The Board, My Sheet, the HQ, the room and every non-draft page stay exactly as they are:
 *    plain server components, no query client mounted, no behavior change.
 *  - The Simulator, and any OTHER page under this segment that wants to adopt TanStack Query
 *    later (the Playbook's own re-sim-per-slot cache is a natural next candidate, Task 4), share
 *    ONE client and ONE cache rather than each mounting a provider of its own — which is what
 *    "adopt incrementally" means here: one provider, adopted page by page under this segment,
 *    not one provider per page.
 *
 * A later phase that finds a second SECTION needing the same thing (the room, say) can lift this
 * exact provider to the app root at that point — this is deliberately the smallest scope that
 * solves today's problem, not a permanent architectural line.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

export function DraftQueryProvider({ children }: { readonly children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // A sim's own numbers do not change on their own between a manager's clicks; only a
            // create/invalidate ever moves them. Refetching on window focus would just re-read
            // the identical row.
            refetchOnWindowFocus: false,
            staleTime: 30_000,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
