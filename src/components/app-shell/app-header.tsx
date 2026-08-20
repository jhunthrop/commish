import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { NoticeInbox } from "@/account-room/components/notice-inbox";

export interface AppHeaderProps {
  /** The signed-in user's display name, server-derived by the page. */
  readonly displayName: string;
  /** The signed-in user's STORED avatar ref (`users.avatar_url`), server-derived by the page. */
  readonly avatar: string | null;
}

/**
 * The one signed-in page shell: wordmark home link, the user, and the way out. Every page
 * under `/app` renders this except the draft room, whose full-height `RoomRail` IS its
 * header — two chromes stacked would break the room's no-page-scroll contract.
 *
 * The name is a link to `/app/profile` — the one write path this product has to who a user is
 * (Task 2) — carrying the user's own `Avatar` so the way in is legible, not just clickable.
 *
 * `NoticeInbox` (Task 10) sits left of the profile link: a `"use client"` component this
 * Server Component renders directly, with no prop of its own — `AppHeaderProps` gains nothing
 * for it, since it fetches its own data over `GET /api/notices` rather than the page threading
 * it through. Every signed-in page gets it for free by rendering `AppHeader`.
 */
export function AppHeader({ displayName, avatar }: AppHeaderProps) {
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
          <NoticeInbox />
          <Link
            href="/app/profile"
            className="flex items-center gap-2 rounded-md text-sm text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Avatar name={displayName} avatar={avatar} size="sm" />
            {displayName}
          </Link>
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
