import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { readPreferences } from "@/identity-service/preferences";
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
 *
 * Reads preferences server-side (`readPreferences`, the same seed-on-first-read call the draft
 * room page makes) and forwards `helpLevel` into `LeagueHome`, so a `guided` caller's
 * `InfoTip`s (the standings Record column, the lineup lock warning, the Bench heading, and now
 * the terms panel's format/scoring definitions — Task 8) open inline from this page's very
 * first render.
 *
 * `leagueHome` (`@/league-service`) is also where the terms panel's data comes from: `home.terms`
 * rides the same read this page already made, so every member sees the league's format, scoring
 * and commissioner without this page issuing a second request for them.
 */
export default async function LeaguePage({ params }: PageProps) {
  const user = await requireCurrentUser();
  const { leagueId } = await params;

  const [home, preferences] = await Promise.all([leagueHome(getDb(), leagueId, user.id), readPreferences(getDb(), user)]);
  if (home === null || (home.myTeamId === null && !home.isCommissioner)) notFound();

  const lineup =
    home.myTeamId === null
      ? null
      : await lineupView(getDb(), { leagueId, teamId: home.myTeamId, weekNumber: home.currentWeek });

  return (
    <>
      <AppHeader displayName={user.displayName} avatar={user.avatarUrl} />
      <LeagueHome home={home} lineup={lineup} helpLevel={preferences.helpLevel} />
    </>
  );
}
