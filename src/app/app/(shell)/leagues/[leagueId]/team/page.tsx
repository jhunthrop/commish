import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { LEAGUE_CONFIG } from "@/league/config";
import { leagueHome, lineupView, matchupWeek } from "@/league-service";
import { LeagueHome } from "@/league-room/components/league-home";
import { leagueAct } from "@/lib/leagues/next-act";
import { readPreferences } from "@/identity-service/preferences";
import { pageTitle } from "@/components/app-shell/page-metadata";

export const metadata = { title: pageTitle("My team") };

/**
 * THE MY-TEAM TAB (founder, 2026-08-28: the tab-based center viewport). Same read, same shell,
 * one room: `LeagueHome` renders its masthead, tab rail, right rail and lower third identically
 * on every tab — only the main column changes. A dedicated route rather than client state, so
 * the lineup editor is linkable — the lower third's Set-your-lineup verb lands here.
 */
export default async function LeagueTeamPage({ params }: { readonly params: Promise<{ leagueId: string }> }) {
  const user = await requireCurrentUser();
  const { leagueId } = await params;
  const [home, preferences] = await Promise.all([leagueHome(getDb(), leagueId, user.id), readPreferences(getDb(), user)]);
  if (home === null || (home.myTeamId === null && !home.isCommissioner)) notFound();
  // Pre-draft this room does not exist — a bookmark lands on the waiting room, not a void.
  if (home.draftStatus !== "complete") redirect(`/app/leagues/${leagueId}`);
  const lineup =
    home.myTeamId === null ? null : await lineupView(getDb(), { leagueId, teamId: home.myTeamId, weekNumber: home.currentWeek });
  const act = leagueAct(home, lineup);
  // This week's points beside every man in the editor (persona pass, 2026-08-30): the same
  // matchupWeek read the matchup tab pays, narrowed to the viewer's own game.
  const week = home.myMatchup === null ? null : await matchupWeek(getDb(), leagueId, home.currentWeek, user.id);
  const myMatchupDetail =
    week === null || home.myTeamId === null
      ? null
      : week.matchups.find((m) => m.home.teamId === home.myTeamId || m.away.teamId === home.myTeamId) ?? null;
  return (
    <LeagueHome
      myMatchupDetail={myMatchupDetail}
      home={home}
      lineup={lineup}
      helpLevel={preferences.helpLevel}
      nextActionKind={act?.kind ?? null}
      act={act}
      playoffTeams={LEAGUE_CONFIG.playoffTeams}
      tab="team"
    />
  );
}
