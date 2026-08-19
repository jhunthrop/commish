import Link from "next/link";
import type { LeagueSummary } from "../contract";
import { Badge, Card, EmptyState, EYEBROW } from "@/components/ui";

/**
 * Not a client component — it renders data and links, and has no state of its own. The empty
 * state's action points at `#create-league`, the anchor the page hosting this list gives its
 * create form — an empty state may never be a dead end (`docs/design-system.md`).
 *
 * The card's one loud state is a LIVE draft: the same accent ring the room's on-clock cell
 * wears, plus a direct way in. Everything else stays quiet — the wall of leagues should read
 * at a glance, not shout.
 */
export function LeagueList({ leagues }: { readonly leagues: readonly LeagueSummary[] }) {
  if (leagues.length === 0) {
    return (
      <EmptyState
        title="No leagues yet"
        description="Create one below, or open an invite link a commissioner sent you."
        icon="users"
        action={
          <a href="#create-league" className="text-sm font-medium text-accent underline">
            Jump to the form
          </a>
        }
      />
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {leagues.map((league) => {
        const live = league.draftStatus === "in_progress";
        return (
          <li key={league.id}>
            <Card
              as="article"
              className={`flex h-full flex-col gap-3 ${live ? "ring-2 ring-accent" : ""}`}
            >
              <div className="flex items-start justify-between gap-2">
                <Link
                  href={`/app/leagues/${league.id}`}
                  className="font-display text-2xl font-bold uppercase leading-display text-text-primary hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {league.name}
                </Link>
                {live ? <Badge tone="accent">Draft live</Badge> : null}
              </div>
              <p className={EYEBROW}>
                {`${league.format === "auction" ? "Auction" : "Snake"} · ${league.filledTeams} of ${league.teamCount} managers`}
                {league.isCommissioner ? " · Commissioner" : ""}
              </p>
              <div className="mt-auto flex flex-wrap items-center gap-3 text-sm">
                {live && league.draftId !== null ? (
                  <Link
                    href={`/app/drafts/${league.draftId}`}
                    className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-text transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                  >
                    Join the draft
                  </Link>
                ) : null}
                {!live && league.draftStatus === "scheduled" && league.draftId !== null ? (
                  <Link href={`/app/drafts/${league.draftId}`} className="text-accent underline">
                    Open the draft room
                  </Link>
                ) : null}
                <Link href={`/app/leagues/${league.id}`} className="text-accent underline">
                  League home
                </Link>
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
