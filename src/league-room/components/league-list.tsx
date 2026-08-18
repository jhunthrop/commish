import Link from "next/link";
import type { LeagueSummary } from "../contract";
import { Badge, Card, EmptyState } from "@/components/ui";

const DRAFT_LABEL: Readonly<Record<string, string>> = {
  scheduled: "Draft not started",
  in_progress: "Draft in progress",
  complete: "Draft complete",
};

/**
 * Not a client component — it renders data and links, and has no state of its own. The empty
 * state's action points at `#create-league`, the anchor `/app/leagues` gives the create form
 * below it — an empty state may never be a dead end (`docs/design-system.md`).
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
    <ul className="flex flex-col gap-2">
      {leagues.map((league) => (
        <li key={league.id}>
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/app/leagues/${league.id}`} className="text-lg font-medium text-accent underline">
                {league.name}
              </Link>
              {league.isCommissioner ? <Badge tone="accent">Commissioner</Badge> : null}
              <Badge tone="neutral">{league.format === "auction" ? "Auction" : "Snake"}</Badge>
            </div>
            <p className="text-sm text-text-muted">
              <span>{`${league.filledTeams} of ${league.teamCount} managers`}</span>
              {league.draftStatus === null ? null : (
                <>
                  {" · "}
                  <span>{DRAFT_LABEL[league.draftStatus]}</span>
                </>
              )}
            </p>
          </Card>
        </li>
      ))}
    </ul>
  );
}
