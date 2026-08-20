import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts, leagues, matchups, players, playerStatLines, scoringSettings, teams } from "@/db/schema";
import type { DraftStatus } from "@/domain/draft";
import { PPR_SCORING, type ScoringSettings } from "@/domain/scoring";
import { listTeamCards } from "@/draft-service/teams";
import { benchOf, LEAGUE_CONFIG, leagueTerms, seasonProgress, startersOf, type WeekStatus } from "@/league";
import type {
  LeagueHomeBody,
  LeagueMemberCard,
  LeagueSummary,
  MatchupDetail,
  MatchupLineupEntry,
  MatchupSide,
  MatchupSummary,
  MatchupWeekBody,
} from "@/league-room/contract";
import { computeFantasyPoints, type ScoringRules } from "@/scoring";
import type { ReferenceCache } from "@/stats-pipeline/reference-cache";
import { getLineup, weekStatusFor } from "./lineups";
import { leagueStandings } from "./results";

/** No Redis connection needed: every existing caller of `matchupWeek` keeps working untouched. */
const NOOP_REFERENCE_CACHE: Pick<ReferenceCache, "players" | "scoringSettings"> = {
  players: (load) => load(),
  scoringSettings: (_leagueId, load) => load(),
};

/** One row of `leagues`, exactly as Drizzle selects it — the shape `myLeaguesOverview` and
 *  `listLeaguesForUser` share. */
type LeagueRow = typeof leagues.$inferSelect;

/** Every league the caller fields a team in, oldest first, plus the team and draft rows over
 *  that same league-id set — the one shared read `listLeaguesForUser` and `crossLeagueHome`
 *  (`@/league-service/home.ts`) both extend rather than each re-querying it their own way. One
 *  query per table, not one per league — a manager in ten leagues must not cost thirty round
 *  trips, whichever of the two callers is asking. */
export interface LeagueMembershipRows {
  readonly leagueRows: readonly LeagueRow[];
  readonly teamRows: readonly { readonly id: string; readonly leagueId: string; readonly name: string }[];
  readonly draftRows: readonly { readonly id: string; readonly leagueId: string; readonly status: DraftStatus }[];
  /** This user's own team in each league they're in. */
  readonly myTeamByLeague: ReadonlyMap<string, string>;
}

/**
 * Every league the given user fields a team in, with every OTHER team, and every draft, over
 * that same league-id set. Nothing here is scoped to a single league or filtered by anything but
 * membership, which is what makes the authorization guarantee simple to state: a league this
 * user has no team in never enters `ids`, so it can never appear in any of the three row sets
 * below, no matter what a caller does with them afterward.
 */
export async function myLeaguesOverview(db: Db, userId: string): Promise<LeagueMembershipRows> {
  const mine = await db.select({ leagueId: teams.leagueId, teamId: teams.id }).from(teams).where(eq(teams.userId, userId));
  if (mine.length === 0) return { leagueRows: [], teamRows: [], draftRows: [], myTeamByLeague: new Map() };
  const ids = mine.map((row) => row.leagueId);

  const leagueRows = await db.select().from(leagues).where(inArray(leagues.id, ids)).orderBy(asc(leagues.createdAt));
  const teamRows = await db.select({ id: teams.id, leagueId: teams.leagueId, name: teams.name }).from(teams).where(inArray(teams.leagueId, ids));
  const draftRows = await db
    .select({ id: drafts.id, leagueId: drafts.leagueId, status: drafts.status })
    .from(drafts)
    .where(inArray(drafts.leagueId, ids));

  return { leagueRows, teamRows, draftRows, myTeamByLeague: new Map(mine.map((row) => [row.leagueId, row.teamId])) };
}

/** The two numbers the league list needs beyond the raw rows: how full a league is, and what
 *  its draft is doing. */
export async function listLeaguesForUser(db: Db, userId: string): Promise<readonly LeagueSummary[]> {
  const { leagueRows, teamRows, draftRows, myTeamByLeague } = await myLeaguesOverview(db, userId);

  const filledByLeague = new Map<string, number>();
  for (const row of teamRows) filledByLeague.set(row.leagueId, (filledByLeague.get(row.leagueId) ?? 0) + 1);
  const draftByLeague = new Map(draftRows.map((row) => [row.leagueId, row]));

  return leagueRows.map((league) => ({
    id: league.id,
    name: league.name,
    format: league.format,
    teamCount: league.teamCount,
    filledTeams: filledByLeague.get(league.id) ?? 0,
    isCommissioner: league.commissionerUserId === userId,
    myTeamId: myTeamByLeague.get(league.id) ?? null,
    draftId: draftByLeague.get(league.id)?.id ?? null,
    draftStatus: draftByLeague.get(league.id)?.status ?? null,
  }));
}

/** One matchup row rendered as the summary every list and card shows: names resolved, `final`
 *  derived from whether both scores have landed, and the week's live status carried alongside
 *  it. Exported for `crossLeagueHome` (`@/league-service/home.ts`), which builds the exact same
 *  shape for a different set of matchup rows rather than re-deriving it. */
export function toSummary(row: typeof matchups.$inferSelect, nameById: ReadonlyMap<string, string>, weekStatus: WeekStatus): MatchupSummary {
  return {
    weekNumber: row.weekNumber,
    homeTeamId: row.homeTeamId,
    awayTeamId: row.awayTeamId,
    homeTeamName: nameById.get(row.homeTeamId) ?? row.homeTeamId,
    awayTeamName: nameById.get(row.awayTeamId) ?? row.awayTeamId,
    homeScore: row.homeScore,
    awayScore: row.awayScore,
    final: row.homeScore !== null && row.awayScore !== null,
    weekStatus,
  };
}

/**
 * Every read `leagueHome` runs, whichever league is asked: `leagues`, `matchups`, `teams`
 * (plain), `drafts`, `scoring_settings`, `stat_weeks` (`weekStatusFor`), the one team+owner
 * join (`listTeamCards`), and `leagueStandings`'s own `matchups` read — eight, bounded
 * regardless of team count. Pinned here, not just in the test, so a future caller who adds a
 * ninth read trips the same assertion `invitePreview`'s neighboring test would if it grew one.
 */
export const BASELINE_LEAGUE_HOME_QUERIES = 8;

/**
 * Everything the league home page renders, assembled once on the server. `listTeamCards` is
 * imported from `@/draft-service/teams` rather than re-implemented — it is already the one
 * "team + owner's public profile" query in this codebase, and a second would drift.
 */
export async function leagueHome(db: Db, leagueId: string, userId: string): Promise<LeagueHomeBody | null> {
  const [league] = await db.select().from(leagues).where(eq(leagues.id, leagueId));
  if (league === undefined) return null;

  const matchupRows = await db.select().from(matchups).where(eq(matchups.leagueId, leagueId));
  const teamRows = await db.select({ id: teams.id, name: teams.name, userId: teams.userId }).from(teams).where(eq(teams.leagueId, leagueId));
  const [draft] = await db.select({ id: drafts.id, status: drafts.status }).from(drafts).where(eq(drafts.leagueId, leagueId));
  // `leagueTerms`'s one input this function did not already hold — every other field it needs
  // (`league`'s own columns, `teamRows`/`teamCards` for filled count and the commissioner's
  // name) rides rows this function reads anyway. Falls back to `PPR_SCORING` for the same
  // never-true "row missing" case `matchupWeek` and `invitePreview` both guard defensively.
  const [weights] = await db.select().from(scoringSettings).where(eq(scoringSettings.leagueId, leagueId));

  const { totalWeeks, currentWeek } = seasonProgress(matchupRows, LEAGUE_CONFIG.regularSeasonWeeks);
  const myTeamId = teamRows.find((row) => row.userId === userId)?.id ?? null;
  const nameById = new Map(teamRows.map((row) => [row.id, row.name]));
  // `teamRows` above is the one place this function already knows each team's OWNER, not just
  // its owner's public profile — `listTeamCards` below never selects `userId` at all, on
  // purpose (it feeds the draft room too, and a team's owner id has no business on that wire).
  // Reusing this map rather than adding a second query is what keeps `listTeamCards` untouched.
  const ownerUserIdByTeamId = new Map(teamRows.map((row) => [row.id, row.userId]));

  const mine = matchupRows.find(
    (row) => row.weekNumber === currentWeek && (row.homeTeamId === myTeamId || row.awayTeamId === myTeamId),
  );
  const weekStatus = await weekStatusFor(db, currentWeek);

  // The one "team + owner's public profile" query, read once and shared: `listTeamCards`
  // enriches both `teams` (for the members panel) and `standings` (for the face beside each
  // row), so a page that already paid for this join never pays for it twice.
  const teamCards = await listTeamCards(db, leagueId);
  const members: readonly LeagueMemberCard[] = teamCards.map((card) => ({
    ...card,
    ownerUserId: ownerUserIdByTeamId.get(card.id) ?? card.id,
  }));

  // The commissioner has a team in every league (`createLeague` gives them one in the same
  // transaction it writes the league itself), so their card is already sitting in `teamCards`
  // above — no query beyond the one that already ran for the members panel.
  const commissionerTeamId = teamRows.find((row) => row.userId === league.commissionerUserId)?.id;
  const commissionerCard = teamCards.find((card) => card.id === commissionerTeamId);
  const terms = leagueTerms({
    name: league.name,
    format: league.format,
    teamCount: league.teamCount,
    filledTeams: teamCards.length,
    scoring: weights ?? PPR_SCORING,
    rosterSlots: league.rosterSlots,
    stakeTier: league.stakeTier,
    commissioner: {
      displayName: commissionerCard?.ownerDisplayName ?? "Commissioner",
      avatarUrl: commissionerCard?.ownerAvatarUrl ?? null,
    },
  });

  return {
    leagueId,
    name: league.name,
    format: league.format,
    teamCount: league.teamCount,
    rosterSlots: league.rosterSlots,
    isCommissioner: league.commissionerUserId === userId,
    commissionerUserId: league.commissionerUserId,
    myTeamId,
    teams: members,
    standings: await leagueStandings(db, leagueId, teamCards),
    terms,
    currentWeek,
    totalWeeks,
    myMatchup: mine === undefined ? null : toSummary(mine, nameById, weekStatus),
    weekStatus,
    draftId: draft?.id ?? null,
    draftStatus: draft?.status ?? null,
  };
}

/**
 * One week's matchups with both lineups and per-player points. Every number the page shows is
 * computed here — the matchup view does no arithmetic of its own.
 *
 * `referenceCache` is injected with a no-op default (falls straight through to the real read),
 * the same idiom `setLineup`'s score-cache parameter uses — so every existing caller keeps
 * working without a Redis connection. When a real cache is supplied, the whole-table `players`
 * read and the league's `scoringSettings` row become a cache hit on every request but the one
 * that populates or invalidates them, rather than two thousand-row reads on every matchup page
 * view.
 */
export async function matchupWeek(
  db: Db,
  leagueId: string,
  weekNumber: number,
  userId: string,
  referenceCache: Pick<ReferenceCache, "players" | "scoringSettings"> = NOOP_REFERENCE_CACHE,
): Promise<MatchupWeekBody | null> {
  const [league] = await db.select().from(leagues).where(eq(leagues.id, leagueId));
  if (league === undefined) return null;
  const slotConfig = league.rosterSlots;

  const week = await db.select().from(matchups).where(and(eq(matchups.leagueId, leagueId), eq(matchups.weekNumber, weekNumber)));
  const allRows = await db.select().from(matchups).where(eq(matchups.leagueId, leagueId));
  const { totalWeeks } = seasonProgress(allRows, LEAGUE_CONFIG.regularSeasonWeeks);
  const weekStatus = await weekStatusFor(db, weekNumber);
  if (week.length === 0) return { leagueId, weekNumber, totalWeeks, myTeamId: null, matchups: [], weekStatus };

  const teamRows = await db.select({ id: teams.id, name: teams.name, userId: teams.userId }).from(teams).where(eq(teams.leagueId, leagueId));
  const nameById = new Map(teamRows.map((row) => [row.id, row.name]));
  const myTeamId = teamRows.find((row) => row.userId === userId)?.id ?? null;

  const settings = await referenceCache.scoringSettings(leagueId, async (): Promise<ScoringSettings> => {
    const [row] = await db.select().from(scoringSettings).where(eq(scoringSettings.leagueId, leagueId));
    return row ?? { leagueId, ...PPR_SCORING };
  });
  const rules: ScoringRules = settings;
  const playerRows = await referenceCache.players(async () => db.select().from(players));
  const playerById = new Map(playerRows.map((row) => [row.id, row]));
  const lines = await db.select().from(playerStatLines).where(eq(playerStatLines.week, weekNumber));
  const statLines = new Map(lines.map((line) => [line.playerId, line]));

  const entryFor = (slot: { readonly slot: MatchupLineupEntry["slot"]; readonly slotIndex: number; readonly playerId: string | null }): MatchupLineupEntry => {
    const player = slot.playerId === null ? undefined : playerById.get(slot.playerId);
    const line = slot.playerId === null ? undefined : statLines.get(slot.playerId);
    return {
      slot: slot.slot,
      slotIndex: slot.slotIndex,
      playerId: slot.playerId,
      playerName: player?.name ?? null,
      position: player?.position ?? null,
      points: player === undefined || line === undefined ? 0 : computeFantasyPoints(line, player.position, rules),
    };
  };

  async function sideFor(teamId: string, score: number | null): Promise<MatchupSide> {
    const lineup = await getLineup(db, { teamId, weekNumber, slotConfig });
    return {
      teamId,
      teamName: nameById.get(teamId) ?? teamId,
      score,
      starters: startersOf(lineup).map(entryFor),
      bench: benchOf(lineup).map(entryFor),
    };
  }

  // Every matchup's two sides are independent `getLineup` round trips — run the whole week's
  // worth in parallel rather than awaiting each side, one matchup at a time.
  const details: MatchupDetail[] = await Promise.all(
    week.map(async (row): Promise<MatchupDetail> => {
      const [home, away] = await Promise.all([sideFor(row.homeTeamId, row.homeScore), sideFor(row.awayTeamId, row.awayScore)]);
      return { weekNumber, home, away, final: row.homeScore !== null && row.awayScore !== null, weekStatus };
    }),
  );

  return { leagueId, weekNumber, totalWeeks, myTeamId, matchups: details, weekStatus };
}
