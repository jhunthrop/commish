"use client";

import type { ReactElement } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import type { ExperienceTier } from "@/domain/user";
import { firstRunPathOrder, type TierOrderedPathKey } from "@/identity";
import { openCreateLeagueSheet } from "./create-league-sheet";
import { JoinLeagueEntry } from "./join-league-entry";

/**
 * The three sections, keyed the same way `firstRunPlan`'s paths are, so `firstRunPathOrder`
 * (`@/identity/first-run.ts`) can reorder THESE the same rule reorders the fork. Content is this
 * component's own — a returning manager reads "Invited by a friend?", not `FirstRunPath`'s
 * "Join with an invite" — only the ORDER is shared, never the copy.
 */
const SECTIONS: Readonly<Record<TierOrderedPathKey, () => ReactElement>> = {
  join: () => (
    <section key="join" aria-label="Join a league" className="flex flex-col gap-2">
      <h2 className="text-lg font-medium text-text-primary">Invited by a friend?</h2>
      <JoinLeagueEntry />
    </section>
  ),
  browse: () => (
    <section key="browse" aria-label="Find a league" className="flex flex-col gap-2">
      <h2 className="text-lg font-medium text-text-primary">No group to play with yet?</h2>
      <p className="text-sm text-text-muted">Browse leagues that are still looking for managers.</p>
      <Link href="/browse" className="text-accent underline">
        Browse open leagues
      </Link>
    </section>
  ),
  // THE TRIGGER ROW (founder ruling, 2026-09-05: "the same bottom sheet everywhere across the
  // app when clicking create league anywhere") — this section used to BE the create form
  // (`CreateLeaguePanel`, wrapping `CreateLeagueForm`, at `id="create-league"`). It is now one
  // button, calling `openCreateLeagueSheet()` (`./create-league-sheet.tsx`), which reaches the
  // single sheet `AppShell` mounts for the whole signed-in app — the same sheet the front door's
  // `CrewDoor` opens, the same sheet `HomeBoard`'s own CTA opens.
  create: () => (
    <section key="create" aria-label="Start a league" className="flex flex-col gap-2">
      <h2 className="text-lg font-medium text-text-primary">Start a league</h2>
      <Button variant="secondary" className="self-start" onClick={() => openCreateLeagueSheet()}>
        Start a league
      </Button>
    </section>
  ),
};

/**
 * The returning-manager answer to "start or join ANOTHER league": the same three real paths
 * `FirstRunPanel` shows a brand-new manager (Task 5's fork), collapsed behind one disclosure
 * because a manager whose board is already full of leagues does not need all three at full
 * weight on every visit — that was the old always-on wall this task removes.
 *
 * Ordered by the SAME `firstRunPathOrder` rule the fork itself uses, from `experienceTier`: an
 * experienced manager opening this disclosure to start their fourth league of the season is
 * usually reaching for Create, exactly the reasoning `firstRunPlan` already encodes for a
 * zero-leagues manager — one rule, two consumers, rather than this component inventing its own
 * second opinion about the same manager.
 *
 * THE HASH STORY CHANGES (2026-09-05): this component used to be the one place `/app#create-
 * league` landed — reading `window.location.hash` on mount and on every later `hashchange` to
 * force itself open and scroll the anchor into view (the production incident, 2026-09-03, that
 * comment used to recount). That entire mechanism moved to `CreateLeagueSheetHost` (`./create-
 * league-sheet.tsx`), mounted once by `AppShell`: a hash arrival now opens the SHEET directly,
 * an overlay that needs no scroll target and no disclosure held open underneath it. This
 * component is closed by default, plainly, with nothing left to force it open — join and browse
 * are the only two things a fragment link could ever need to reveal here, and neither one is
 * ever the target of `#create-league`.
 */
export function StartOrJoinDisclosure({ experienceTier }: { readonly experienceTier: ExperienceTier }) {
  return (
    <details className="rounded-lg bg-surface-elevated shadow-card">
      <summary className="cursor-pointer select-none p-4 text-sm font-medium text-text-primary">
        Start or join another league
      </summary>
      <div className="flex flex-col gap-6 border-t border-line p-4">
        {firstRunPathOrder(experienceTier).map((key) => SECTIONS[key]())}
      </div>
    </details>
  );
}
