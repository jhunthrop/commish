import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { LEAGUE_CONFIG } from "@/league/config";
import { leagueHome, lineupView } from "@/league-service";
import { LeagueHome } from "@/league-room/components/league-home";
import { leagueAct } from "@/lib/leagues/next-act";
import { readPreferences } from "@/identity-service/preferences";
import { pageTitle } from "@/components/app-shell/page-metadata";

export const metadata = { title: pageTitle("Free agents") };

/**
 * THE FREE AGENTS TAB: the pool minus every roster here, with the claim flow.
 * one room: `LeagueHome` renders its masthead, tab rail, right rail and lower third identically
 * on every tab — only the main column changes. A dedicated route rather than client state, so
 * the table is linkable and the back button means what it says.
 */
export default async function LeagueFreeAgentsPage({ params }: { readonly params: Promise<{ leagueId: string }> }) {
  const user = await requireCurrentUser();
  const { leagueId } = await params;
  const [home, preferences] = await Promise.all([leagueHome(getDb(), leagueId, user.id), readPreferences(getDb(), user)]);
  if (home === null || (home.myTeamId === null && !home.isCommissioner)) notFound();
  // Pre-draft this room does not exist — a bookmark lands on the waiting room, not a void.
  if (home.draftStatus !== "complete") redirect(`/app/leagues/${leagueId}`);
  const lineup =
    home.myTeamId === null ? null : await lineupView(getDb(), { leagueId, teamId: home.myTeamId, weekNumber: home.currentWeek });
  const act = leagueAct(home, lineup);
  return (
    <LeagueHome
      home={home}
      lineup={lineup}
      helpLevel={preferences.helpLevel}
      nextActionKind={act?.kind ?? null}
      act={act}
      playoffTeams={LEAGUE_CONFIG.playoffTeams}
      tab="players"
    />
  );
}
