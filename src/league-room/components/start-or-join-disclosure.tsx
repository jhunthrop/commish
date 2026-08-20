"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CreateLeaguePanel } from "./create-league-panel";
import { JoinLeagueEntry } from "./join-league-entry";

const CREATE_LEAGUE_HASH = "#create-league";

/**
 * The returning-manager answer to "start or join ANOTHER league": the same three real paths
 * `FirstRunPanel` shows a brand-new manager (Task 5's fork), collapsed behind one disclosure
 * because a manager whose board is already full of leagues does not need all three at full
 * weight on every visit — that was the old always-on wall this task removes.
 *
 * Closed by default, EXCEPT when the page was reached via the `#create-league` fragment: three
 * surfaces link straight at that id (`/browse`'s intro line, `PublicLeagueList`'s empty state,
 * and `HomeBoard`'s own defensive empty state) expecting the create form to be visible, not one
 * more click away behind a closed disclosure a fragment link cannot open on its own. Read on
 * mount rather than server-side, because `window.location.hash` does not exist on the server —
 * this is the one piece of Task 5 that genuinely needs a client component instead of a plain
 * server-rendered `<details open>`.
 */
export function StartOrJoinDisclosure() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (window.location.hash === CREATE_LEAGUE_HASH) setOpen(true);
  }, []);

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="rounded-lg border border-border"
    >
      <summary className="cursor-pointer select-none p-4 text-sm font-medium text-text-primary">
        Start or join another league
      </summary>
      <div className="flex flex-col gap-6 border-t border-border p-4">
        <section aria-label="Join a league" className="flex flex-col gap-2">
          <h2 className="text-lg font-medium text-text-primary">Invited by a friend?</h2>
          <JoinLeagueEntry />
        </section>
        <section aria-label="Find a league" className="flex flex-col gap-2">
          <h2 className="text-lg font-medium text-text-primary">No group to play with yet?</h2>
          <p className="text-sm text-text-muted">Browse leagues that are still looking for managers.</p>
          <Link href="/browse" className="text-accent underline">
            Browse open leagues
          </Link>
        </section>
        <section id="create-league" className="flex flex-col gap-2">
          <h2 className="text-lg font-medium text-text-primary">Start a league</h2>
          <CreateLeaguePanel />
        </section>
      </div>
    </details>
  );
}
