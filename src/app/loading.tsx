import { AppShellSkeleton } from "@/components/app-shell/app-shell-skeleton";

/**
 * The root loading boundary — the only `loading.tsx` above `/app` (Phase 3.6 addendum, Task 21,
 * Step 2). Covers every public page: the front door, `/browse`, `/reviews`, and the seat-hold
 * interstitial (`/join/[leagueId]/hold`) — every one of them signed-out reachable, which is why
 * this renders the PUBLIC geometry rather than the signed-in one.
 *
 * `/app`'s own three chromes each carry a more specific `loading.tsx` of their own
 * (`(shell)`, `(room)`, `(public)`), and the App Router prefers the deepest matching file for a
 * given segment — so none of those pages ever fall through to this one. This file exists only
 * for what sits outside `/app` altogether.
 */
export default function RootLoading() {
  return <AppShellSkeleton shape="public" />;
}
