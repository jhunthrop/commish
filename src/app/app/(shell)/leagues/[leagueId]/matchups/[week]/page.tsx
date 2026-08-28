import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { PageTitle } from "@/components/ui";
import { leagueHome, matchupWeek } from "@/league-service";
import { getReferenceCache } from "@/league-service/reference-cache-instance";
import type { TeamStandingsRow } from "@/league-room/contract";
import type { RecordsByTeamId } from "@/league-room/components/matchup-hero";
import { LiveMatchupWeek } from "@/league-room/components/live-matchup-week";
import { WeekNav } from "@/league-room/components/week-nav";
import { formatWeek } from "@/league-room/lib/format";
import { liveScoringCopy } from "@/stats/live-scoring-copy";
import { pageTitle } from "@/components/app-shell/page-metadata";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly leagueId: string; readonly week: string }>;
}

/**
 * A5: the week number is a route param, not a DB read, so it composes a real, honest title
 * (`formatWeek`, `@/league-room/lib/format` — the same string `WeekNav` already renders) without
 * the league-name DB read this page's own body makes (`leagueHome`, above) — that read stays
 * this task's line, not crossed for a browser tab.
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { week } = await params;
  const weekNumber = Number.parseInt(week, 10);
  return pageTitle(Number.isInteger(weekNumber) && weekNumber >= 1 ? formatWeek(weekNumber) : "Matchups");
}

/**
 * A Server Component reading through the service layer directly, same rationale as the
 * league home page. `leagueHome` is read too (rather than trusting the `week` route param
 * alone) so the page can 404 a non-member the same way the home page does, and so `WeekNav`
 * gets the league's real `totalWeeks` even for a week with no fixtures yet.
 *
 * Renders no `TopBar` and no `<main>` of its own (Task 2 Step 5) — `(shell)/layout.tsx` supplies
 * both, once, for every page in this route group.
 */
export default async function MatchupWeekPage({ params }: PageProps) {
  const user = await requireCurrentUser();
  const { leagueId, week } = await params;
  const weekNumber = Number.parseInt(week, 10);
  if (!Number.isInteger(weekNumber) || weekNumber < 1) notFound();

  const home = await leagueHome(getDb(), leagueId, user.id);
  if (home === null || (home.myTeamId === null && !home.isCommissioner)) notFound();

  const body = await matchupWeek(getDb(), leagueId, weekNumber, user.id, getReferenceCache());
  if (body === null) notFound();

  return (
    <>
      <PageTitle>{`${home.name} · Week ${weekNumber}`}</PageTitle>
      <WeekNav leagueId={leagueId} weekNumber={weekNumber} totalWeeks={body.totalWeeks} />
      {body.matchups.length === 0 ? (
        <p className="text-text-muted">There are no matchups in this week yet.</p>
      ) : (
        <LiveMatchupWeek leagueId={leagueId} body={body} records={recordsFrom(home.standings)} />
      )}
      <p className="text-sm text-text-muted">{liveScoringCopy()}</p>
    </>
  );
}

/**
 * Every team's win-loss-tie line, keyed by team id, for the matchup hero.
 *
 * A RECORD IS THE FIRST THING A SCOREBOARD PRINTS UNDER A TEAM NAME, and `Scoreboard` has always
 * had the slot for it — this page simply never filled it. The fact costs nothing new: `leagueHome`
 * is already read above, for membership and the league's own name, and its standings carry every
 * team's record. Joining the two reads is work only this page can do; `matchupWeek` reads
 * fixtures and stat lines and has no view of the season's results, so widening ITS wire would
 * mean a second query for something already in hand.
 */
function recordsFrom(standings: readonly TeamStandingsRow[]): RecordsByTeamId {
  const records: Record<string, { wins: number; losses: number; ties: number }> = {};
  for (const row of standings) {
    records[row.teamId] = { wins: row.wins, losses: row.losses, ties: row.ties };
  }
  return records;
}
