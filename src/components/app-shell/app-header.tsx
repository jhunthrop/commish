import Link from "next/link";

export interface AppHeaderProps {
  /** The signed-in user's display name, server-derived by the page. */
  readonly displayName: string;
}

/**
 * The one signed-in page shell: wordmark home link, the user, and the way out. Every page
 * under `/app` renders this except the draft room, whose full-height `RoomRail` IS its
 * header — two chromes stacked would break the room's no-page-scroll contract.
 */
export function AppHeader({ displayName }: AppHeaderProps) {
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-4 py-3">
        <Link
          href="/app"
          className="font-display text-xl font-bold uppercase tracking-wide text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Commish
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-sm text-text-muted">{displayName}</span>
          <form action="/sign-out" method="post">
            <button
              type="submit"
              className="rounded-md px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-surface-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
