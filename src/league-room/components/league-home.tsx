import Link from "next/link";
import type { LeagueHomeBody, LineupBody } from "../contract";
import { Card, PageTitle } from "@/components/ui";
import { LeagueChat } from "@/chat-room/components/league-chat";
import { formatWeek } from "../lib/format";
import { AdvisorPanel } from "./advisor-panel";
import { InvitePanel } from "./invite-panel";
import { LeagueMembersPanel } from "./league-members-panel";
import { LineupEditor } from "./lineup-editor";
import { MatchupCelebration } from "./matchup-celebration";
import { MatchupScoreboard } from "./matchup-scoreboard";
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
        <PageTitle>{home.name}</PageTitle>
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
          <MatchupScoreboard matchup={home.myMatchup} myTeamId={home.myTeamId} />
        )}
        {/* Same visibility the retired "Score Week" button had: the commissioner's control is
            gone, and this is what replaced it — an explanation of why, not a silent absence. */}
        {home.isCommissioner ? (
          <p className="text-sm text-text-muted">
            {"Scores update automatically as games finish. There's nothing to run by hand."}
          </p>
        ) : null}
      </section>

      <StandingsTable rows={home.standings} myTeamId={home.myTeamId} />

      {/*
        Unlike the draft room's `aside` band, this section sits in ordinary document flow, so
        `LeagueChat`'s own `h-full min-h-0` chain has nothing bounded to fill and would grow to
        fit every held message. A fixed height from the spacing scale is all the inner
        `min-h-0`/`flex-1` chain needs to scroll inside itself instead (L2, final review).
      */}
      <div className="h-96">
        <LeagueChat leagueId={home.leagueId} />
      </div>

      {lineup === null ? null : <LineupEditor leagueId={home.leagueId} lineup={lineup} totalWeeks={home.totalWeeks} />}

      {home.myTeamId === null ? null : <AdvisorPanel leagueId={home.leagueId} weekNumber={home.currentWeek} />}

      {/*
        The members panel and the invite panel sit here, in that order, as siblings in ordinary
        document flow rather than inside a layout that claims the space between them: the
        commissioner's "who is missing" question (the panel above) and their "invite someone"
        answer (the panel below) read together without either one owning the section. A future
        panel — the league-terms panel this same spot is expected to grow — composes the same
        way, as one more sibling, not as a change to how these two are laid out.
      */}
      <LeagueMembersPanel teams={home.teams} teamCount={home.teamCount} commissionerUserId={home.commissionerUserId} myTeamId={home.myTeamId} />

      {home.isCommissioner ? <InvitePanel leagueId={home.leagueId} /> : null}
    </main>
  );
}
