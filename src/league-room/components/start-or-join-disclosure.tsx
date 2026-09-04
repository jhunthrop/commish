"use client";

import { useEffect, useState, type ReactElement } from "react";
import Link from "next/link";
import type { ExperienceTier } from "@/domain/user";
import { firstRunPathOrder, type TierOrderedPathKey } from "@/identity";
import { CreateLeaguePanel } from "./create-league-panel";
import { JoinLeagueEntry } from "./join-league-entry";

const CREATE_LEAGUE_HASH = "#create-league";

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
  create: () => (
    <section key="create" id="create-league" className="flex flex-col gap-2">
      <h2 className="text-lg font-medium text-text-primary">Start a league</h2>
      <CreateLeaguePanel />
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
 * Closed by default, EXCEPT when the page was reached via the `#create-league` fragment: three
 * surfaces link straight at that id (`/browse`'s intro line, `OpenLeagueShelf`'s empty state,
 * and `HomeBoard`'s own defensive empty state) expecting the create form to be visible, not one
 * more click away behind a closed disclosure a fragment link cannot open on its own. Read on
 * mount rather than server-side, because `window.location.hash` does not exist on the server —
 * this is the one piece of Task 5 that genuinely needs a client component instead of a plain
 * server-rendered `<details open>`. That anchor keeps resolving in EITHER order, since the
 * `create` section always carries `id="create-league"` wherever it lands in the list.
 *
 * AND ON EVERY LATER CLICK, not just mount (production incident, 2026-09-03): the page's own
 * "Create a league" button is a fragment link to this hash, and a click on an ALREADY-LOADED
 * /app only changes the hash. With a mount-only read, nothing listened; and a browser neither
 * opens a closed `<details>` nor scrolls to an anchor hidden inside one — so the button did
 * exactly nothing. The `hashchange` listener opens the disclosure and walks the viewport to
 * the create section; a repeat click on the same hash scrolls natively once the section is
 * out from behind the closed disclosure.
 */
export function StartOrJoinDisclosure({ experienceTier }: { readonly experienceTier: ExperienceTier }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const openFromHash = () => {
      if (window.location.hash !== CREATE_LEAGUE_HASH) return;
      setOpen(true);
      // After the open state paints: bring the create section into view. Instant, not smooth —
      // an anchor jump, so no reduced-motion branch to carry.
      requestAnimationFrame(() => document.getElementById("create-league")?.scrollIntoView());
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, []);

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="rounded-lg bg-surface-elevated shadow-card"
    >
      <summary className="cursor-pointer select-none p-4 text-sm font-medium text-text-primary">
        Start or join another league
      </summary>
      <div className="flex flex-col gap-6 border-t border-line p-4">
        {firstRunPathOrder(experienceTier).map((key) => SECTIONS[key]())}
      </div>
    </details>
  );
}
