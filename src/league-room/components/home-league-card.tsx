import Link from "next/link";
import type { HomeLeagueCard as HomeLeagueCardData } from "../contract";
import { Badge, ButtonLink, Card, LedgerRow, SeatMeter } from "@/components/ui";
import { actionHref } from "../lib/action-href";
import { formatRecord, formatWeek } from "../lib/format";
import { MatchupScoreboard } from "./matchup-scoreboard";
import { WeekStatusBadge } from "./week-status-badge";

export interface HomeLeagueCardProps {
  readonly league: HomeLeagueCardData;
  /**
   * Rule 5, one ink action per view — quiet by default, mirroring `OpenLeagueCard`'s own
   * `emphasis` prop (Task 5): a card is never assumed to be the view's one ink action on its own
   * authority. `HomeBoard`'s n=1 branch (Task 9) is this card's one production caller that ever
   * sets `"ink"` — the single-league home has no board, no attention queue, and no other card to
   * compete with it, so its own action IS the view's ink (S10's same rule applied to the n=1
   * shape rather than the multi-league one).
   */
  readonly emphasis?: "ink" | "quiet";
}

/**
 * One league, as the cross-league home renders it: the record, this week's matchup with its
 * live-or-final score, and the one next action — never a disabled one, since `league.nextAction`
 * is `null` exactly when there is nothing to do (`@/league/next-action.ts`).
 *
 * A live draft gets the same accent ring `LeagueList` (the card this replaced) gave it, for the
 * same reason: everything else on this page should read at a glance, and a league on the clock
 * is the one thing that should not — paired with the same visible "Draft live" badge that card
 * carried, since a ring alone is invisible to the accessibility tree.
 *
 * Format and Record (Task 9) render as `LedgerRow`s — the exact hairline-topped shape
 * `OpenLeagueCard`'s own ledger uses, extracted to `@/components/ui` at this, its second caller —
 * so the signed-in home and the public shelf read as one product rather than two components that
 * happen to both call themselves a "league card".
 */
export function HomeLeagueCard({ league, emphasis = "quiet" }: HomeLeagueCardProps) {
  const draftLive = league.draftStatus === "in_progress";
  const ctaVariant = emphasis === "ink" ? ("primary" as const) : ("secondary" as const);

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
        {draftLive ? <Badge tone="accent">Draft live</Badge> : null}
      </div>

      <div className="flex flex-col">
        <LedgerRow label="Format">
          {league.format === "auction" ? "Auction" : "Snake"}
          {league.isCommissioner ? " · Commissioner" : ""}
        </LedgerRow>
        {league.record === null ? null : (
          // Casual users have no prior convention for a bare "5-2" to lean on, so the row's
          // visible label carries the fact, not just an accessible-name fallback. The two inner
          // spans are `aria-hidden`: the row's own `role="group"`/`aria-label` is the one
          // accessible name a screen reader gets for this whole row, so the label and the value
          // aren't announced a second time as separate nodes.
          <LedgerRow
            role="group"
            aria-label={`Record: ${formatRecord(league.record)}`}
            label={<span aria-hidden="true">Record</span>}
          >
            <span className="font-semibold tabular-nums text-text-primary" aria-hidden="true">
              {formatRecord(league.record)}
            </span>
          </LedgerRow>
        )}
      </div>

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
        // Rule 5: quiet unless `emphasis="ink"` — the single-league home's one card earns the
        // ink pill, every other caller (there are none in production yet) stays quiet.
        <ButtonLink
          href={actionHref(league)}
          aria-label={`${league.nextAction.label} for ${league.name}`}
          variant={ctaVariant}
          size="sm"
          className="mt-auto self-start"
        >
          {league.nextAction.label}
        </ButtonLink>
      )}
    </Card>
  );
}
