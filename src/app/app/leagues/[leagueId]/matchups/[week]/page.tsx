import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { PageTitle } from "@/components/ui";
import { leagueHome, matchupWeek } from "@/league-service";
import { MatchupPanel } from "@/league-room/components/matchup-panel";
import { WeekNav } from "@/league-room/components/week-nav";
import { AppHeader } from "@/components/app-shell/app-header";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly leagueId: string; readonly week: string }>;
}

/**
 * A Server Component reading through the service layer directly, same rationale as the
 * league home page. `leagueHome` is read too (rather than trusting the `week` route param
 * alone) so the page can 404 a non-member the same way the home page does, and so `WeekNav`
 * gets the league's real `totalWeeks` even for a week with no fixtures yet.
 */
export default async function MatchupWeekPage({ params }: PageProps) {
  const user = await requireCurrentUser();
  const { leagueId, week } = await params;
  const weekNumber = Number.parseInt(week, 10);
  if (!Number.isInteger(weekNumber) || weekNumber < 1) notFound();

  const home = await leagueHome(getDb(), leagueId, user.id);
  if (home === null || (home.myTeamId === null && !home.isCommissioner)) notFound();

  const body = await matchupWeek(getDb(), leagueId, weekNumber, user.id);
  if (body === null) notFound();

  return (
    <>
    <AppHeader displayName={user.displayName} />
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4">
      <PageTitle>{`${home.name} — Week ${weekNumber}`}</PageTitle>
      <WeekNav leagueId={leagueId} weekNumber={weekNumber} totalWeeks={body.totalWeeks} />
      {body.matchups.length === 0 ? (
        <p className="text-text-muted">There are no matchups in this week yet.</p>
      ) : (
        body.matchups.map((matchup) => (
          <MatchupPanel key={`${matchup.home.teamId}:${matchup.away.teamId}`} matchup={matchup} myTeamId={body.myTeamId} />
        ))
      )}
    </main>
    </>
  );
}
