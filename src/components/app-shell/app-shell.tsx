import type { ReactNode } from "react";
import { AdminConsoleNav } from "./admin-console-nav";
import { LeagueRail } from "./league-rail";
import { ShellFooter } from "./shell-footer";
import { TopBar } from "./top-bar";
import type { LiveState, RailLeague } from "./shell-data";

export interface AppShellProps {
  readonly user: { readonly displayName: string; readonly avatar: string | null; readonly isAdmin: boolean };
  readonly rail: readonly RailLeague[];
  /** The one live fact the top bar carries. `null` outside a game window (ruling 12). */
  readonly liveState: LiveState | null;
  readonly children: ReactNode;
}

/**
 * The signed-in frame, rendered ONCE by `src/app/app/(shell)/layout.tsx` (ruling 8, as amended)
 * — a `TopBar` spanning the full width, a `LeagueRail` beside the content at `lg` and above it
 * as a horizontal strip below, and a full-bleed `<main>` with no `max-w-*` at all (Step 2's
 * founder brief, in one deletion). There is no `currentLeagueId` prop: `LeagueRail` is a client
 * component that derives the current league from `usePathname()` directly, so this component
 * needs no per-page argument, which is what makes it renderable from a layout in the first
 * place.
 *
 * The grid is `grid-cols-[auto_1fr]` at `lg`, a single column below it (the rail redesign,
 * 2026-09-03): the rail column takes whatever the rail renders — `UI_CONFIG.shell.railWidthPx`
 * when the collapsed rail is there, ZERO on `/app`, where the rail is `null` because that page
 * IS the rail's own full-page form (law 3: the rail never renders beside its own page). The
 * flyout is an absolutely-positioned overlay inside the rail, so opening it never changes this
 * track either — no layout shift, ever.
 *
 * A third row (`ShellFooter`, flow analysis A3) sits under the content column only — never
 * under the rail — so the grid grows by one row (`auto`) rather than being restructured. Below
 * `lg` the grid collapses to a single column and the footer simply falls in flow after `<main>`.
 */
export function AppShell({ user, rail, liveState, children }: AppShellProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] lg:grid-rows-[auto_1fr_auto]">
      <TopBar
        className="lg:col-span-2 lg:row-start-1"
        displayName={user.displayName}
        avatar={user.avatar}
        isAdmin={user.isAdmin}
        liveState={liveState}
      />
      <LeagueRail leagues={rail} className="lg:col-start-1 lg:row-start-2" />
      {/* Full-bleed: no `max-w-*` here at all. A long-form reading surface keeps its own
          `max-w-prose` on its paragraph column instead — "full-bleed frames, measured
          paragraphs" (Step 2). */}
      <main className="flex w-full min-w-0 flex-col gap-6 px-4 py-4 lg:col-start-2 lg:row-start-2">
        {/* Flow analysis A4: the operator console index, visible only for an admin standing on
            `/app/admin/*`. Silent (renders null) for every other page and every other user. */}
        <AdminConsoleNav isAdmin={user.isAdmin} />
        {children}
      </main>
      <ShellFooter className="lg:col-start-2 lg:row-start-3" />
    </div>
  );
}
