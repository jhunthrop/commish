import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@research-ts/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { PageTitle } from "@/components/ui";
import { leagueHome, lineupView, matchupWeek } from "@/league-service";
import { leagueAct } from "@/lib/leagues/next-act";
import { getReferenceCache } from "@/league-service/reference-cache-instance";
import type { TeamStandingsRow } from "@/league-room/contract";
import type { RecordsByTeamId } from "@/league-room/components/matchup-hero";
import { LiveMatchupWeek } from "@/league-room/components/live-matchup-week";
import { managersFrom } from "@/league-room/lib/managers";
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

  // LAW 6's verb, for the lower third at the foot of this page. The lineup read is the same one
  // `LeaguePage` makes, for the same reason: `leagueAct` distinguishes "set your lineup" from "fix
  // your lineup" on whether every starter slot is filled, and a lower third that guessed between
  // the two would put the wrong words on the one control the week is waiting on. It is the
  // league's CURRENT week either way — a manager reading week 3 in December is still owed the act
  // that is actually pending, not a verb about a week that has already settled.
  const lineup = home.myTeamId === null ? null : await lineupView(getDb(), { leagueId, teamId: home.myTeamId, weekNumber: home.currentWeek });

  return (
    <>
      <PageTitle>{`${home.name} · Week ${weekNumber}`}</PageTitle>
      <WeekNav leagueId={leagueId} weekNumber={weekNumber} totalWeeks={body.totalWeeks} />
      {/* WHERE THE NUMBERS COME FROM, said once, at the top. It used to be the last line on the
          page; law 6 gives the FOOT of a screen to the lower third, and a provenance sentence
          under a strip carrying the verb reads as an afterthought to the decision rather than a
          caveat on the scores it is actually about. */}
      <p className="text-sm text-text-muted">{liveScoringCopy()}</p>
      {body.matchups.length === 0 ? (
        <p className="text-text-muted">There are no matchups in this week yet.</p>
      ) : (
        <LiveMatchupWeek
          leagueId={leagueId}
          body={body}
          records={recordsFrom(home.standings)}
          managers={managersFrom(home.standings)}
          act={leagueAct(home, lineup)}
        />
      )}
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
  const records: Record<string, RecordsByTeamId[string]> = {};
  for (const row of standings) {
    records[row.teamId] = { wins: row.wins, losses: row.losses, ties: row.ties, rank: row.rank, previousRank: row.previousRank };
  }
  return records;
}
