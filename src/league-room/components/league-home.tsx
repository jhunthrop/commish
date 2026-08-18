import Link from "next/link";
import type { LeagueHomeBody, LineupBody } from "../contract";
import { Card } from "@/components/ui";
import { formatPoints, formatWeek } from "../lib/format";
import { InvitePanel } from "./invite-panel";
import { LineupEditor } from "./lineup-editor";
import { MatchupCelebration } from "./matchup-celebration";
import { ScoreWeekButton } from "./score-week-button";
import { StandingsTable } from "./standings-table";

/**
 * The league's home screen. Deliberately NOT a client component: it composes, it does not
 * fetch, and every value it renders (`currentWeek`, `myMatchup`, `standings`, `clinched`,
 * `locked`) arrives already computed by `src/league/**` on the server. Keeping the
 * composition here rather than inside `page.tsx` is what makes it testable.
 */
export function LeagueHome({ home, lineup }: { readonly home: LeagueHomeBody; readonly lineup: LineupBody | null }) {
  const clinched = home.standings.some((row) => row.teamId === home.myTeamId && row.clinched);
  const drafted = home.draftStatus === "complete";
  const draftLive = home.draftStatus === "in_progress";

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-display-md font-bold leading-display text-text-primary">{home.name}</h1>
        <p className="text-sm text-text-muted">
          {`${home.teams.length} of ${home.teamCount} managers · ${home.format === "auction" ? "Auction" : "Snake"} draft`}
        </p>
      </header>

      <MatchupCelebration matchup={home.myMatchup} myTeamId={home.myTeamId} clinched={clinched} />

      {drafted ? null : (
        <Card>
          <p className="text-text-primary">
            {draftLive ? "Your draft is live right now." : "This league hasn't drafted yet."}
          </p>
          {home.draftId === null ? null : (
            <Link className="text-accent underline" href={`/app/drafts/${home.draftId}`}>
              {draftLive ? "Join the draft" : "Open the draft room"}
            </Link>
          )}
        </Card>
      )}

      <section className="flex flex-col gap-2" aria-label={`${formatWeek(home.currentWeek)} matchup`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-medium text-text-primary">{formatWeek(home.currentWeek)}</h2>
          <Link className="text-sm text-accent underline" href={`/app/leagues/${home.leagueId}/matchups/${home.currentWeek}`}>
            All matchups
          </Link>
        </div>
        {home.myMatchup === null ? (
          <p className="text-text-muted">You have no matchup this week.</p>
        ) : (
          <Card>
            <p className="text-text-primary">
              {`${home.myMatchup.homeTeamName} ${home.myMatchup.homeScore === null ? "—" : formatPoints(home.myMatchup.homeScore)}`}
              {" vs "}
              {`${home.myMatchup.awayTeamName} ${home.myMatchup.awayScore === null ? "—" : formatPoints(home.myMatchup.awayScore)}`}
            </p>
            <p className="text-sm text-text-muted">{home.myMatchup.final ? "Final." : "Not scored yet."}</p>
          </Card>
        )}
        {home.isCommissioner ? <ScoreWeekButton leagueId={home.leagueId} weekNumber={home.currentWeek} /> : null}
      </section>

      <StandingsTable rows={home.standings} myTeamId={home.myTeamId} />

      {lineup === null ? null : <LineupEditor leagueId={home.leagueId} lineup={lineup} />}

      {home.isCommissioner ? <InvitePanel leagueId={home.leagueId} /> : null}
    </main>
  );
}
