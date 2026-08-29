import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { RailNav } from "./rail-nav";
import { Icon } from "@/components/ui/icon";
import { NoticeInbox } from "@/account-room/components/notice-inbox";
import { LiveStatePill } from "@/league-room/components/live-state-pill";
import { SessionNotice } from "./session-notice";
import type { LiveState } from "./shell-data";

export interface TopBarProps {
  /** The signed-in user's display name, server-derived by the page. */
  readonly displayName: string;
  /** The signed-in user's STORED avatar ref (`users.avatar_url`), server-derived by the page. */
  readonly avatar: string | null;
  /** `users.isAdmin`, server-derived by the page — every caller already holds a `CurrentUser`
   *  with this on it, so this is required rather than defaulted: a page rendering `TopBar`
   *  makes an explicit choice about the queue link rather than silently getting "false" from a
   *  page nobody updated (Task 5). */
  readonly isAdmin: boolean;
  /** `AppShellProps.liveState` (`./shell-data`), threaded straight through — the one live fact
   *  the top bar carries. Always `null` until Task 9's `LiveStatePill` gives it real content
   *  (ruling 12: no pill beats a pill that pulses on a Tuesday in July); this task only carries
   *  the seam, so a caller outside `AppShell` (a not-yet-migrated page rendering `TopBar` on its
   *  own) never has to pass it. */
  readonly liveState?: LiveState | null;
  /** Extra classes from the caller — `AppShell` uses this to span the bar across both grid
   *  columns; a page rendering `TopBar` standalone leaves it unset. */
  readonly className?: string;
}

/**
 * The one signed-in page shell: wordmark home link, the user, and the way out. Every page under
 * `/app` renders this except the draft room, whose full-height `RoomRail` IS its header — two
 * chromes stacked would break the room's no-page-scroll contract.
 *
 * Renamed from `AppHeader` (Task 2 Step 4) — the old name does not survive the rename. No longer
 * centered: `AppShell` (`./app-shell.tsx`) renders this spanning the full width of its grid, so
 * the `mx-auto max-w-4xl` wrapper the old `AppHeader` carried is gone; a page still rendering
 * this standalone (one not yet moved into the `(shell)` route group) simply gets a full-width
 * bar too, which is correct either way — full-bleed is the founder's brief in one deletion
 * (Step 2), not a shell-only behavior.
 *
 * The name is a link to `/app/profile` — the one write path this product has to who a user is
 * (Task 2) — carrying the user's own `Avatar` so the way in is legible, not just clickable.
 *
 * `NoticeInbox` (Task 10) sits left of the profile link: a `"use client"` component this
 * Server Component renders directly, with no prop of its own — `TopBarProps` gains nothing for
 * it, since it fetches its own data over `GET /api/notices` rather than the page threading it
 * through. Every signed-in page gets it for free by rendering `TopBar`.
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
 *
 * `SessionNotice` (Task 16, F13) renders below the bar row, still inside this one grid item —
 * the shell's own chrome is where a dead session under `AppShell` gets said, above the content
 * column. It renders nothing until a session is actually lost, so a page with a live session
 * looks byte-for-byte the same as before this task.
 */
export function TopBar({ displayName, avatar, isAdmin, liveState = null, className = "" }: TopBarProps) {
  return (
    <header className={`bg-surface ${className}`}>
      {/* v2's Geist retone widened the wordmark (font-display's own -0.02em tracking cannot claw
          back a condensed-to-regular font-family swap), which is why the row and the right-hand
          group's gaps tightened one step each here — the same fix-round-1 problem this header's
          own docblock names, reopened by the font change rather than by a sixth control.
          `border-b` moved here from the outer `<header>` (Task 16, F13) so `SessionNotice` below
          can render its OWN band, under this row, still inside the one grid item `AppShell`
          spans across row 1 — "above the content column", never a second header. */}
      <div className="flex w-full items-center justify-between gap-2 border-b border-line px-2 py-3">
        <div className="flex items-center gap-8">
          {/* The mark signs off with the amber full stop, matching the storefront rail. */}
          <Link
            href="/app"
            className="font-display text-xl font-extrabold tracking-[-0.01em] text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Commish<span className="text-accent">.</span>
          </Link>
          {/* Hidden below sm, the PublicBar precedent — the 360px row already runs at capacity
              (this file's own fix-round history), and a mobile nav is the shell work's problem. */}
          <RailNav className="hidden sm:flex" />
        </div>
        {/* Task 13, Step 1c: `gap-1`, not `gap-2` — the row's own fix-round-1 history already
            tightened this once for a font change; a SIXTH real control (the live pill, now
            genuinely present at every width instead of hidden below `sm`) is the second squeeze,
            and `mobile-360.spec.ts`'s own 360px battery is what caught it needing one. */}
        <div className="flex items-center gap-1">
          {/* Task 10, Step 3: the top bar's one live fact — `LiveStatePill` itself renders
              nothing when `liveState` is `null` (ruling 12), so this slot is silent outside a
              real game window with no branch needed here.

              Task 13, Step 1c (reconciliation review follow-up): NO WRAPPER, no breakpoint.
              The checkpoint fix round hid this behind `hidden sm:block` — the exact failure mode
              this file's own fix-round-1 history warns about, restated: a control that only
              disappears below a breakpoint is one narrow-viewport regression waiting to reopen,
              and hiding the live pill also drops the live-game signal on the one device people
              watch games beside. `LiveStatePill` now carries the discipline this header already
              applies to its other controls itself (icon-only, at every width, sentence in the
              accessible name), so it needs no wrapper and no width class here at all. */}
          <LiveStatePill liveState={liveState} />
          {!isAdmin ? null : (
            <Link
              href="/app/admin/queue"
              aria-label="Queue"
              className="flex items-center justify-center rounded-md p-1.5 text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Icon name="shield" size={18} />
            </Link>
          )}
          <NoticeInbox />
          {/* GAMEDAY (2026-08-28): the manager, in ink. *"The manager's own identity present on
              every screen"* is one of the four things the razor names as REAL aliveness, and this
              is the one place the product says who you are on every signed-in page — it was the
              quietest thing in the row. */}
          <Link
            href="/app/profile"
            className="flex items-center gap-1.5 rounded-md text-sm font-medium text-text-primary transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Avatar name={displayName} avatar={avatar} size="sm" />
            {displayName}
          </Link>
          <form action="/sign-out" method="post">
            {/* GAMEDAY: quiet, like every other utility in this row. Full ink made the loudest
                control on every signed-in surface in the product the way OUT of it — law 5's own
                discipline ("a filter, a toggle, a sort control and a way out are quiet on every
                surface") applied to the chrome, which is where it had never been read. */}
            <button
              type="submit"
              className="rounded-md px-2 py-1.5 text-sm text-text-muted transition-colors hover:bg-surface-elevated hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
      <SessionNotice />
    </header>
  );
}
