import { AppShellSkeleton } from "@/components/app-shell/app-shell-skeleton";

/**
 * F8: `(shell)/layout.tsx` renders `AppShell` itself now — the top bar and the league rail are
 * already real by the time this ever mounts — so this suspends ONLY the content column inside
 * `AppShell`'s `<main>`, never the chrome the layout is already holding. Inherited by every page
 * in this route group (the locker room, leagues, matchups, trades, activity, profile, admin):
 * one file, not nine.
 */
export default function ShellLoading() {
  return <AppShellSkeleton shape="content" />;
}
