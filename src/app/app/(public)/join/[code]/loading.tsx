import { AppShellSkeleton } from "@/components/app-shell/app-shell-skeleton";

/**
 * F7: `/app/join/[code]` is signed-out reachable through `middleware.ts`'s single exemption for
 * the invite landing, so this renders the PUBLIC geometry rather than inheriting `(shell)`'s
 * signed-in one — a rail and a profile control would promise a session this visitor may not
 * have, then swap out for `PublicBar` once the real page renders. Its own file, in its own
 * `(public)` route group, is the fix; moving this route to `/join/[code]` to sit beside the
 * other public surfaces was considered and rejected, because every invite ever sent points at
 * `/app/join/[code]`.
 */
export default function JoinLoading() {
  return <AppShellSkeleton shape="public" />;
}
