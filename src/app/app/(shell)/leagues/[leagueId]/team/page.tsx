import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { fixtureLabelsByTeam, leagueHome, lineupView, matchupWeek, weeklyProjectionsByPlayerId } from "@/league-service";
import { AdvisorPanel } from "@/league-room/components/advisor-panel";
import { LineupEditor } from "@/league-room/components/lineup-editor";
import { PlayerPeekHost } from "@/league-room/components/player-peek";
import { PageTitle } from "@/components/ui";
import { pageTitle } from "@/components/app-shell/page-metadata";

export const metadata = { title: pageTitle("My team") };

/**
 * THE TEAM PAGE — the roster spine's tap target. The room's stage deals lineup problems as
 * decision sheets (law 3); this page stays as the full editor for everything else a manager
 * does to a roster: the whole grid, IR moves, the advisor. A dedicated route rather than a
 * drawer surface, so the editor is linkable and the spine has somewhere honest to go.
 */
export default async function LeagueTeamPage({ params }: { readonly params: Promise<{ leagueId: string }> }) {
  const user = await requireCurrentUser();
  const { leagueId } = await params;
  const home = await leagueHome(getDb(), leagueId, user.id);
  if (home === null || (home.myTeamId === null && !home.isCommissioner)) notFound();
  // Pre-draft this room does not exist — a bookmark lands on the waiting room, not a void.
  if (home.draftStatus !== "complete") redirect(`/app/leagues/${leagueId}`);
  if (home.myTeamId === null) redirect(`/app/leagues/${leagueId}`);

  const [lineup, week, fixtures, projections] = await Promise.all([
    lineupView(getDb(), { leagueId, teamId: home.myTeamId, weekNumber: home.currentWeek }),
    home.myMatchup === null ? null : matchupWeek(getDb(), leagueId, home.currentWeek, user.id),
    fixtureLabelsByTeam(getDb(), home.currentWeek),
    weeklyProjectionsByPlayerId(getDb(), home.currentWeek),
  ]);
  if (lineup === null) notFound();

  const myMatchupDetail =
    week === null
      ? null
      : (week.matchups.find((m) => m.home.teamId === home.myTeamId || m.away.teamId === home.myTeamId) ?? null);
  const mySide =
    myMatchupDetail === null
      ? null
      : myMatchupDetail.home.teamId === home.myTeamId
        ? myMatchupDetail.home
        : myMatchupDetail.away;
  const pointsByPlayerId =
    mySide === null
      ? new Map<string, number | null>()
      : new Map(
          [...mySide.starters, ...mySide.bench]
            .filter((entry) => entry.playerId !== null)
            .map((entry) => [entry.playerId!, entry.points]),
        );

  return (
    <>
      <PlayerPeekHost />
      <div className="flex items-baseline gap-3">
        <PageTitle>My team</PageTitle>
        <Link href={`/app/leagues/${leagueId}`} className="text-sm text-accent">
          Back to the room
        </Link>
      </div>
      <LineupEditor
        leagueId={home.leagueId}
        lineup={lineup}
        totalWeeks={home.totalWeeks}
        pointsByPlayerId={pointsByPlayerId}
        fixturesByNflTeam={fixtures}
        projectionsByPlayerId={projections}
        draftStatus={home.draftStatus}
      />
      <AdvisorPanel leagueId={home.leagueId} weekNumber={home.currentWeek} />
    </>
  );
}
