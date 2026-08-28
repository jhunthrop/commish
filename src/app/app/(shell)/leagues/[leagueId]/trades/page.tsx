import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { PageTitle } from "@/components/ui";
import { leagueHome, matchupWeek } from "@/league-service";
import { getReferenceCache } from "@/league-service/reference-cache-instance";
import type { MatchupLineupEntry, MatchupWeekBody, TradeCounterpartyOption, TradeRoomContext, TradeRosterPlayer } from "@/league-room/contract";
import { TradeInbox } from "@/league-room/components/trade-inbox";
import { pageTitle } from "@/components/app-shell/page-metadata";

export const dynamic = "force-dynamic";
// A5: matches this page's own <h1>.
export const metadata: Metadata = pageTitle("Trades");

interface PageProps {
  readonly params: Promise<{ readonly leagueId: string }>;
}

function rosterOf(entries: readonly MatchupLineupEntry[]): TradeRosterPlayer[] {
  const players: TradeRosterPlayer[] = [];
  for (const entry of entries) {
    if (entry.playerId === null || entry.playerName === null || entry.position === null) continue;
    // Law 3's three fields ride the SAME entry this loop already reads — see
    // `TradeRosterPlayer`'s own docblock for why they live here rather than on `ValuedPlayer`.
    // `nflTeam` falls back to the empty string, which is `PlayerFace`'s own "no club colour I
    // know" input: it renders the bare face rather than a grey rectangle pretending to be
    // somebody's colours.
    players.push({
      playerId: entry.playerId,
      name: entry.playerName,
      position: entry.position,
      nflTeam: entry.nflTeam ?? "",
      headshotUrl: entry.headshotUrl,
      adp: entry.adp,
    });
  }
  return players;
}

/**
 * Every team's own roster, keyed by id, built from the SAME `matchupWeek` read
 * `MatchupWeekPage` already makes rather than a new roster route (`TradeRoomContext`'s own
 * docblock, `@/league-room/contract`). A team with no matchup row for `weekNumber` (a bye, or a
 * week before the schedule exists) simply has no entry, and `TradeComposer`'s own picker renders
 * that team's list as empty rather than throwing.
 */
function rostersByTeamId(week: MatchupWeekBody): Readonly<Record<string, readonly TradeRosterPlayer[]>> {
  const rosters: Record<string, readonly TradeRosterPlayer[]> = {};
  for (const matchup of week.matchups) {
    rosters[matchup.home.teamId] = rosterOf([...matchup.home.starters, ...matchup.home.bench]);
    rosters[matchup.away.teamId] = rosterOf([...matchup.away.starters, ...matchup.away.bench]);
  }
  return rosters;
}

/**
 * A Server Component reading through the service layer directly, the same shape `LeaguePage`/
 * `MatchupWeekPage` already use. `leagueHome` is read for the same reason it is on every other
 * league page: membership (a stranger 404s rather than 403s, same non-oracle discipline the
 * activity page documents) and the league's own current week and team list, which
 * `TradeComposer`'s counterparty picker needs. `matchupWeek` is read second, for the SAME roster
 * data `MatchupWeekPage` already assembles — this task reuses it rather than adding a new roster
 * route (Task 8's own docblock: "it reuses rather than invents").
 *
 * Renders no `TopBar` and no `<main>` of its own (Task 2 Step 5) — `(shell)/layout.tsx` supplies
 * both, once, for every page in this route group.
 */
export default async function TradesPage({ params }: PageProps) {
  const user = await requireCurrentUser();
  const { leagueId } = await params;

  const home = await leagueHome(getDb(), leagueId, user.id);
  if (home === null || home.myTeamId === null) notFound();

  const week = await matchupWeek(getDb(), leagueId, home.currentWeek, user.id, getReferenceCache());

  const counterparties: readonly TradeCounterpartyOption[] = home.teams
    .filter((team) => team.id !== home.myTeamId)
    .map((team) => ({ teamId: team.id, teamName: team.name }));

  const context: TradeRoomContext = {
    weekNumber: home.currentWeek,
    myTeamId: home.myTeamId,
    counterparties,
    rostersByTeamId: week === null ? {} : rostersByTeamId(week),
    leagueName: home.name,
  };

  return (
    <>
      <header className="flex flex-col gap-1">
        <PageTitle>Trades</PageTitle>
        <p className="text-sm text-text-muted">{home.name}</p>
        {/* Persona panel (commissioner, step 4): founder decision #6 ships immediate execution
            with no approval step and no veto window, a real departure from platforms where a
            commissioner can deny a trade. Said plainly, here, rather than left for a
            commissioner to discover the first time they try to stop one and can't.
            D7 (competition review): the old sentence ("There's no review step, for anyone.")
            was a page-level literal that never learned about Plan D's own fairness-review
            carve-out for a lopsided public-league trade — it rendered false, 400px above
            `HeldTradeBanner`, on any page that held one. This states the rule INCLUDING its
            exception, in one sentence, so the header can never contradict the banner beneath
            it again. */}
        <p className="text-sm text-text-muted">
          Trades complete as soon as both sides agree. Public leagues hold back a lopsided trade for a short fairness review first.
        </p>
      </header>
      <TradeInbox leagueId={leagueId} context={context} />
    </>
  );
}
