import { getDb } from "@/db/client";
import type { Db } from "@/db/client";
import { readPreferences } from "@/identity-service/preferences";
import { listLeagueActivity } from "@/integrity-service/activity";
import { listNotices, quoteFor } from "@/integrity-service/notify";
import { leagueHome, lineupView, matchupWeek, weeklyProjectionsByPlayerId, fixtureLabelsByTeam, gradesForDraft } from "@/league-service";
import { byeWeeksByTeam } from "@/league-service/nfl-schedule";
import { pendingWaiverClaims } from "@/league-service/claims";
import { listTrades } from "@/league-service/trades";
import { getReferenceCache } from "@/league-service/reference-cache-instance";
import type { CurrentUser } from "@/lib/auth/current-user";
import { createPresenceStore } from "@/lib/realtime/presence";
import { getSharedRedis } from "@/lib/realtime/redis";
import { formatDate } from "@/league-room/lib/format";
import type {
  LeagueGradeRow,
  MatchupLineupEntry,
  MatchupWeekBody,
  PlatformNoticeView,
  RoomData,
  TradeCounterpartyOption,
  TradeManager,
  TradeRoomContext,
  TradeRosterPlayer,
} from "@/league-room/contract";

/** Task 10: `RoomData.grades`/`gradesBasis` — loaded only for a completed, opted-in draft, and
 *  empty otherwise (the pre-draft branch below, and a league that has opted out). `formatDate`
 *  ("August 18") is applied here, once, so `GradeBoard` stays a pure "print this string"
 *  component with no date arithmetic of its own. */
async function gradesFor(
  db: Db,
  home: { readonly draftStatus: string | null; readonly draftGradesVisible: boolean; readonly draftId: string | null },
): Promise<{ readonly grades: readonly LeagueGradeRow[]; readonly gradesBasis: string }> {
  if (home.draftStatus !== "complete" || !home.draftGradesVisible || home.draftId === null) {
    return { grades: [], gradesBasis: "" };
  }
  const { grades, boardGeneration } = await gradesForDraft(db, home.draftId);
  return { grades, gradesBasis: boardGeneration === null ? "" : formatDate(boardGeneration) };
}

/**
 * Who is in the room as the page renders (Sideline P5), from the presence store the league
 * stream writes. A store that cannot be read answers EMPTY, which the room renders as no
 * presence claim at all: "we do not know" is never spelled "nobody is here", and the browser's
 * own `usePresence` re-reads the moment its stream opens.
 */
async function presentUserIdsFor(leagueId: string): Promise<readonly string[]> {
  try {
    return await createPresenceStore(getSharedRedis()).listPresent(leagueId, Date.now());
  } catch {
    return [];
  }
}

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
      presentUserIds: [],
      tradeContext: null,
      helpLevel: preferences.helpLevel,
      grades: [],
      gradesBasis: "",
    };
  }

  const teamId = home.myTeamId;
  const [lineup, week, projectionsByPlayerId, fixturesByNflTeam, byeWeeksByNflTeam, trades, pendingClaims, activity, notices, gradesRead, presentUserIds] =
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
      gradesFor(db, home),
      presentUserIdsFor(leagueId),
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
    presentUserIds,
    tradeContext: teamId === null ? null : tradeContext(home.name, home.currentWeek, teamId, home.teams, week),
    helpLevel: preferences.helpLevel,
    grades: gradesRead.grades,
    gradesBasis: gradesRead.gradesBasis,
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
  // P1, on the surface where two PEOPLE negotiate: the person behind each team id, out of the
  // `TeamCard`s this function is already handed. No second read and no widened wire type — see
  // `TradeManager` (`@/league-room/contract`) for why a manager's face does not belong on a
  // stored proposal row.
  const managersByTeamId: Record<string, TradeManager> = {};
  for (const team of teams) {
    managersByTeamId[team.id] = { teamName: team.name, name: team.ownerDisplayName, avatar: team.ownerAvatarUrl };
  }
  return {
    weekNumber,
    myTeamId,
    counterparties,
    rostersByTeamId: week === null ? {} : rostersByTeamId(week),
    managersByTeamId,
    leagueName,
  };
}
