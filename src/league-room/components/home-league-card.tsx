import Link from "next/link";
import type { HomeLeagueCard as HomeLeagueCardData } from "../contract";
import { Card, EYEBROW } from "@/components/ui";
import { formatRecord, formatWeek } from "../lib/format";
import { MatchupScoreboard } from "./matchup-scoreboard";
import { WeekStatusBadge } from "./week-status-badge";

/**
 * Where the card's one action button goes. Draft-phase actions go to the draft room; every
 * other action (invite, lineup, scores, review) goes to the league's own home, which is where
 * `InvitePanel`, `LineupEditor`, and the week's `MatchupScoreboard` already live
 * (`league-home.tsx`) — this never duplicates a second copy of any of them.
 */
function actionHref(league: HomeLeagueCardData): string {
  const kind = league.nextAction?.kind;
  if ((kind === "join-draft" || kind === "open-draft-room") && league.draftId !== null) {
    return `/app/drafts/${league.draftId}`;
  }
  return `/app/leagues/${league.id}`;
}

/**
 * One league, as the cross-league home renders it: the record, this week's matchup with its
 * live-or-final score, and the one next action — never a disabled one, since `league.nextAction`
 * is `null` exactly when there is nothing to do (`@/league/next-action.ts`).
 *
 * A live draft gets the same accent ring `LeagueList` gives it, for the same reason: everything
 * else on this page should read at a glance, and a league on the clock is the one thing that
 * should not.
 */
export function HomeLeagueCard({ league }: { readonly league: HomeLeagueCardData }) {
  const draftLive = league.draftStatus === "in_progress";

  return (
    <Card as="article" className={`flex h-full flex-col gap-3 ${draftLive ? "ring-2 ring-accent" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/app/leagues/${league.id}`}
          className="font-display text-2xl font-bold uppercase leading-display text-text-primary hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {league.name}
        </Link>
        {league.record === null ? null : (
          <span className="shrink-0 text-sm font-semibold tabular-nums text-text-muted">{formatRecord(league.record)}</span>
        )}
      </div>
      <p className={EYEBROW}>
        {`${league.format === "auction" ? "Auction" : "Snake"} · ${league.filledTeams} of ${league.teamCount} managers`}
        {league.isCommissioner ? " · Commissioner" : ""}
      </p>

      {league.matchup === null ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-text-muted">{`${formatWeek(league.weekNumber)}: no matchup.`}</p>
          <WeekStatusBadge status={league.weekStatus} />
        </div>
      ) : (
        <MatchupScoreboard matchup={league.matchup} myTeamId={league.myTeamId} />
      )}

      {league.nextAction === null ? null : (
        <Link
          href={actionHref(league)}
          className="mt-auto self-start rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-text transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          {league.nextAction.label}
        </Link>
      )}
    </Card>
  );
}
