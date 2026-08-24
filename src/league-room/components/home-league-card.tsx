import Link from "next/link";
import type { HomeLeagueCard as HomeLeagueCardData } from "../contract";
import { Badge, Card, EYEBROW, SeatMeter } from "@/components/ui";
import { actionHref } from "../lib/action-href";
import { formatRecord, formatWeek } from "../lib/format";
import { MatchupScoreboard } from "./matchup-scoreboard";
import { WeekStatusBadge } from "./week-status-badge";

/**
 * One league, as the cross-league home renders it: the record, this week's matchup with its
 * live-or-final score, and the one next action — never a disabled one, since `league.nextAction`
 * is `null` exactly when there is nothing to do (`@/league/next-action.ts`).
 *
 * A live draft gets the same accent ring `LeagueList` (the card this replaced) gave it, for the
 * same reason: everything else on this page should read at a glance, and a league on the clock
 * is the one thing that should not — paired with the same visible "Draft live" badge that card
 * carried, since a ring alone is invisible to the accessibility tree.
 */
export function HomeLeagueCard({ league }: { readonly league: HomeLeagueCardData }) {
  const draftLive = league.draftStatus === "in_progress";

  return (
    <Card as="article" className={`flex h-full flex-col gap-3 ${draftLive ? "ring-2 ring-accent" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/app/leagues/${league.id}`}
          // `min-w-0 break-words`: a flex item will not shrink below its min-content width
          // without it, so a long league name widened this whole card at 360px.
          className="min-w-0 break-words font-display text-2xl font-semibold leading-display text-text-primary hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {league.name}
        </Link>
        <div className="flex shrink-0 items-center gap-2">
          {draftLive ? <Badge tone="accent">Draft live</Badge> : null}
          {league.record === null ? null : (
            // Casual users have no prior convention for a bare "5-2" to lean on, so the eyebrow
            // label is visible, not just an accessible-name fallback. The two inner spans are
            // `aria-hidden`: the group's own `aria-label` is the one accessible name a screen
            // reader gets for this whole cluster, so the label and the value aren't announced
            // a second time as separate nodes.
            <div role="group" aria-label={`Record: ${formatRecord(league.record)}`} className="flex flex-col items-end gap-0.5">
              <span className={EYEBROW} aria-hidden="true">
                Record
              </span>
              <span className="text-sm font-semibold tabular-nums text-text-muted" aria-hidden="true">
                {formatRecord(league.record)}
              </span>
            </div>
          )}
        </div>
      </div>
      <p className={EYEBROW}>
        {league.format === "auction" ? "Auction" : "Snake"}
        {league.isCommissioner ? " · Commissioner" : ""}
      </p>
      <SeatMeter filled={league.filledTeams} total={league.teamCount} />

      {league.matchup === null ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-text-muted">{`${formatWeek(league.weekNumber)}: no matchup.`}</p>
          <WeekStatusBadge status={league.weekStatus} />
        </div>
      ) : (
        <MatchupScoreboard matchup={league.matchup} myTeamId={league.myTeamId} />
      )}

      {league.nextAction === null ? null : (
        // The visible label is the same short verb phrase on every card ("Watch the scores" can
        // repeat across many leagues); the accessible name is not, so two cards' action links
        // are never indistinguishable to a screen reader reading the page's link list.
        <Link
          href={actionHref(league)}
          aria-label={`${league.nextAction.label} for ${league.name}`}
          className="mt-auto self-start rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-text transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          {league.nextAction.label}
        </Link>
      )}
    </Card>
  );
}
