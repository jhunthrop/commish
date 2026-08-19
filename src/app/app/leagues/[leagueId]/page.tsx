import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { leagueHome, lineupView } from "@/league-service";
import { LeagueHome } from "@/league-room/components/league-home";
import { AppHeader } from "@/components/app-shell/app-header";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly leagueId: string }>;
}

/**
 * A Server Component reading through the service layer directly — idiomatic Next.js, and
 * outside the client-boundary rule (which covers `src/league-room/**`, browser code by
 * construction). Membership is enforced by the API for everything interactive on the page;
 * a non-member who guesses a league id sees a 404 rather than another league's standings.
 */
export default async function LeaguePage({ params }: PageProps) {
  const user = await requireCurrentUser();
  const { leagueId } = await params;

  const home = await leagueHome(getDb(), leagueId, user.id);
  if (home === null || (home.myTeamId === null && !home.isCommissioner)) notFound();

  const lineup =
    home.myTeamId === null
      ? null
      : await lineupView(getDb(), { leagueId, teamId: home.myTeamId, weekNumber: home.currentWeek });

  return (
    <>
      <AppHeader displayName={user.displayName} avatar={user.avatarUrl} />
      <LeagueHome home={home} lineup={lineup} />
    </>
  );
}
