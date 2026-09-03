import { getDb } from "@/db/client";
import { readPreferences } from "@/identity-service/preferences";
import { listLeagueActivity } from "@/integrity-service/activity";
import { listNotices, quoteFor } from "@/integrity-service/notify";
import { leagueHome, lineupView, matchupWeek, weeklyProjectionsByPlayerId, fixtureLabelsByTeam } from "@/league-service";
import { byeWeeksByTeam } from "@/league-service/nfl-schedule";
import { pendingWaiverClaims } from "@/league-service/claims";
import { listTrades } from "@/league-service/trades";
import { getReferenceCache } from "@/league-service/reference-cache-instance";
import type { CurrentUser } from "@/lib/auth/current-user";
import type {
  MatchupLineupEntry,
  MatchupWeekBody,
  PlatformNoticeView,
  RoomData,
  TradeCounterpartyOption,
  TradeRoomContext,
  TradeRosterPlayer,
} from "@/league-room/contract";

export interface RoomDataOptions {
  /** The activity feed's untrusted `?before` cursor, already parsed by the page. */
  readonly activityBefore?: number;
  /** The activity route also carries the viewer's own platform notices for this league. */
  readonly includeNotices?: boolean;
}

/**
 * THE ROOM'S ONE SERVER READ, shared by the room page and the four full-height drawer routes
 * (law 2: they are the same surface, so they load the same data). `leagueHome` keeps its own
 * pinned query budget — everything else is a sibling call, parallelized here.
 *
 * Returns `null` for a missing league OR a caller with no seat and no whistle — the caller
 * pages translate that to `notFound()`, the same non-oracle 404 every league page keeps.
 *
 * Pre-draft, the season reads are skipped whole: the league IS the waiting room, and a claims
 * endpoint that refuses or an empty trade inbox would be six queries answering questions
 * nobody can act on yet.
 */
export async function loadRoomData(
  user: CurrentUser,
  leagueId: string,
  options: RoomDataOptions = {},
): Promise<RoomData | null> {
  const db = getDb();
  const [home, preferences] = await Promise.all([leagueHome(db, leagueId, user.id), readPreferences(db, user)]);
  if (home === null || (home.myTeamId === null && !home.isCommissioner)) return null;

  if (home.draftStatus !== "complete") {
    return {
      home,
      lineup: null,
      week: null,
      projectionsByPlayerId: new Map(),
      fixturesByNflTeam: new Map(),
      byeWeeksByNflTeam: new Map(),
      trades: null,
      pendingClaims: [],
      activityRows: [],
      activityNextBefore: null,
      activityNotices: [],
      tradeContext: null,
      helpLevel: preferences.helpLevel,
    };
  }

  const teamId = home.myTeamId;
  const [lineup, week, projectionsByPlayerId, fixturesByNflTeam, byeWeeksByNflTeam, trades, pendingClaims, activity, notices] =
    await Promise.all([
      teamId === null ? null : lineupView(db, { leagueId, teamId, weekNumber: home.currentWeek }),
      matchupWeek(db, leagueId, home.currentWeek, user.id, getReferenceCache()),
      weeklyProjectionsByPlayerId(db, home.currentWeek),
      fixtureLabelsByTeam(db, home.currentWeek),
      byeWeeksByTeam(db),
      teamId === null ? null : listTrades(db, { leagueId, teamId }),
      teamId === null ? [] : pendingWaiverClaims(db, leagueId, teamId),
      listLeagueActivity(db, { leagueId, viewerUserId: user.id, before: options.activityBefore }),
      options.includeNotices === true ? listNotices(db, user.id) : null,
    ]);

  // The viewer's OWN notices, filtered to this league — the same bounded, cursorless inbox page
  // the header reads, with the quote resolved here so the client band is plain data.
  const activityNotices: readonly PlatformNoticeView[] =
    notices === null
      ? []
      : notices.notices
          .filter((notice) => notice.leagueId === leagueId)
          .map((notice) => ({ id: notice.id, title: notice.title, body: notice.body, quote: quoteFor(notice) }));

  return {
    home,
    lineup,
    week,
    projectionsByPlayerId,
    fixturesByNflTeam,
    byeWeeksByNflTeam,
    trades,
    pendingClaims,
    activityRows: activity.rows,
    activityNextBefore: activity.nextBefore,
    activityNotices,
    tradeContext: teamId === null ? null : tradeContext(home.name, home.currentWeek, teamId, home.teams, week),
    helpLevel: preferences.helpLevel,
  };
}

function rosterOf(entries: readonly MatchupLineupEntry[]): TradeRosterPlayer[] {
  const players: TradeRosterPlayer[] = [];
  for (const entry of entries) {
    if (entry.playerId === null || entry.playerName === null || entry.position === null) continue;
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

/** Every team's roster keyed by id, from the SAME `matchupWeek` read (the trades page's own
 *  reuse-over-invent shape, now shared by every room route). */
function rostersByTeamId(week: MatchupWeekBody): Readonly<Record<string, readonly TradeRosterPlayer[]>> {
  const rosters: Record<string, readonly TradeRosterPlayer[]> = {};
  for (const matchup of week.matchups) {
    rosters[matchup.home.teamId] = rosterOf([...matchup.home.starters, ...matchup.home.bench]);
    rosters[matchup.away.teamId] = rosterOf([...matchup.away.starters, ...matchup.away.bench]);
  }
  return rosters;
}

function tradeContext(
  leagueName: string,
  weekNumber: number,
  myTeamId: string,
  teams: RoomData["home"]["teams"],
  week: MatchupWeekBody | null,
): TradeRoomContext {
  const counterparties: readonly TradeCounterpartyOption[] = teams
    .filter((team) => team.id !== myTeamId)
    .map((team) => ({ teamId: team.id, teamName: team.name }));
  return {
    weekNumber,
    myTeamId,
    counterparties,
    rostersByTeamId: week === null ? {} : rostersByTeamId(week),
    leagueName,
  };
}
