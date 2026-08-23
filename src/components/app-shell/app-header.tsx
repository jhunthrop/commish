import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icon";
import { NoticeInbox } from "@/account-room/components/notice-inbox";

export interface AppHeaderProps {
  /** The signed-in user's display name, server-derived by the page. */
  readonly displayName: string;
  /** The signed-in user's STORED avatar ref (`users.avatar_url`), server-derived by the page. */
  readonly avatar: string | null;
  /** `users.isAdmin`, server-derived by the page — every caller already holds a `CurrentUser`
   *  with this on it, so this is required rather than defaulted: a page rendering `AppHeader`
   *  makes an explicit choice about the queue link rather than silently getting "false" from a
   *  page nobody updated (Task 5). */
  readonly isAdmin: boolean;
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
 *
 * The queue link (Task 5) renders ONLY for `isAdmin`, and links to `/app/admin/queue` — itself
 * gated by `withAdmin` (ruling 14, 404 not 403), so this is a convenience for an operator who
 * already has access, never the access control itself. An ordinary member never sees it.
 *
 * ICON-ONLY, matching `NoticeInbox`'s own trigger (`Icon` plus `aria-label`, no visible text
 * node) rather than a new narrow-viewport breakpoint: this header already has exactly one
 * pattern for "a header control with no room for a label" and a second one, invented here, was
 * the actual 360px regression (fix round 1, FIX 1) — five controls at full width (wordmark,
 * queue, notices, profile, sign out) overflowed a 360px viewport by 30px and clipped sign-out
 * off the right edge. Icon-only at every width removes that width unconditionally rather than
 * only below a breakpoint, so it cannot regress the same way if a sixth control ever joins this
 * row.
 */
export function AppHeader({ displayName, avatar, isAdmin }: AppHeaderProps) {
  return (
    <header className="border-b border-line bg-surface">
      {/* v2's Geist retone widened the wordmark (font-display's own -0.02em tracking cannot claw
          back a condensed-to-regular font-family swap), which is why the row and the right-hand
          group's gaps tightened one step each here — the same fix-round-1 problem this header's
          own docblock names, reopened by the font change rather than by a sixth control. */}
      <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-3 py-3">
        <Link
          href="/app"
          className="font-display text-xl font-bold uppercase text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Commish
        </Link>
        <div className="flex items-center gap-2">
          {!isAdmin ? null : (
            <Link
              href="/app/admin/queue"
              aria-label="Queue"
              className="flex items-center justify-center rounded-md p-2 text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Icon name="shield" size={20} />
            </Link>
          )}
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
