import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@research-ts/db/client";
import { players, playerStatLines, statWeeks } from "@research-ts/db/schema";
import { drafts, leagues, matchups, scoringSettings, teams, users, weeks } from "@/db/schema";
import { UI_CONFIG } from "@/components/ui/config";
import type { DraftStatus } from "@research-ts/domain/draft";
import { PPR_SCORING, type ScoringSettings } from "@research-ts/domain/scoring";
import type { Clock } from "@research-ts/domain/timing";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { listTeamCards } from "@/draft-service/teams";
import { benchOf, LEAGUE_CONFIG, leagueTerms, medianResultFor, seasonProgress, startersOf, type WeekStatus } from "@/league";
import { compositionCategoryFor, tierCompositionFor } from "@/participation/composition";
import { isCommissionerOf, leagueAuthority } from "./authority";
import { joinedAtFor, missedDraftFrom, slotPreferenceViewFor } from "./draft-schedule";
import { completedSeasonsForMany } from "./participation";
import type {
  DraftScheduleBody,
  LeagueHomeBody,
  LeagueMemberCard,
  LeagueSummary,
  MatchupDetail,
  MatchupLineupEntry,
  MatchupMedian,
  MatchupSide,
  MatchupSummary,
  MatchupWeekBody,
} from "@/league-room/contract";
import { computeFantasyPoints, type ScoringRules } from "@research-ts/scoring";
import type { ReferenceCache } from "@/stats-pipeline/reference-cache";
import { getLineup, weekStatusFor } from "./lineups";
import { leagueStandings } from "./results";

/** The outermost edge is the only place a wall clock is allowed — see every other service
 *  module's identical constant (`creation.ts`, `invites.ts`, ...). Read here, once, so
 *  `leagueTerms`'s `draftAt` field has a `now` to measure "in 3 days" against. */
const systemClock: Clock = { now: () => new Date().toISOString() };

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
/** `kickoffAt`/`startTrigger`/`kickoffRolls` (Phase 3.6, Task 10, Step 2b) ride the SAME
 *  `drafts` select `crossLeagueHome` already paid for — three more columns off one row, never a
 *  second query — so the pre-draft home's hero can be built from data this read already holds. */
export interface DraftMembershipRow {
  readonly id: string;
  readonly leagueId: string;
  readonly status: DraftStatus;
  readonly kickoffAt: Date;
  readonly startTrigger: "scheduled" | "when_full";
  readonly kickoffRolls: number;
}

/**
 * One seat in one league, with the PERSON in it (Sideline P1, 2026-09-11): the manager stack on
 * the signed-in home draws faces, and a face needs a name and an avatar ref. The `users` join
 * rides the SAME grouped `teams` select this read already paid for — one more join on one
 * statement, never a lookup per league, which is the N+1 this whole read exists to refuse.
 *
 * Members only, by construction rather than by filter: `teams.user_id` is `NOT NULL` with a
 * foreign key, so the inner join drops nothing and can never invent a seat with nobody in it.
 * An empty seat is the absence of a row here, and the surfaces that draw open seats count them
 * (`teamCount - filledTeams`) rather than reading a face with no person behind it.
 */
export interface TeamMembershipRow {
  readonly id: string;
  readonly leagueId: string;
  readonly name: string;
  readonly userId: string;
  readonly managerName: string;
  readonly managerAvatar: string | null;
}

export interface LeagueMembershipRows {
  readonly leagueRows: readonly LeagueRow[];
  readonly teamRows: readonly TeamMembershipRow[];
  readonly draftRows: readonly DraftMembershipRow[];
  /** This user's own team in each league they're in. */
  readonly myTeamByLeague: ReadonlyMap<string, string>;
}

/**
 * Every league the given user fields a team in, with every OTHER team, and every draft, over
 * that same league-id set. Nothing here is scoped to a single league or filtered by anything but
 * membership, which is what makes the authorization guarantee simple to state: a league this
 * user has no team in never enters `ids`, so it can never appear in any of the three row sets
 * below, no matter what a caller does with them afterward.
 *
 * `AND NOT is_mock` (Phase 4.5, Task 2): the locker room this feeds (`listLeaguesForUser`) and
 * the cross-league home it also feeds (`crossLeagueHome`, `@/league-service/home.ts`) are both
 * membership-scoped reads, not `is_public_matchmade`-scoped ones — `ENFORCED_LEAGUE_SQL`
 * (`@/league-service/enforcement`) never touches this query, so a mock the caller is seated in
 * (the host, or a bot's own team never has a real caller) would otherwise show up as an ordinary
 * league. Excluded at THIS read, before `teamRows`/`draftRows` ever run, rather than filtered out
 * of the returned rows afterward: a mock league's id never enters `ids` at all, so nothing
 * downstream has to remember to re-check it. Practice re-entry lives in the mock lobby instead
 * (Task 9), never in the room of real leagues this function is the one source of.
 */
export async function myLeaguesOverview(db: Db, userId: string): Promise<LeagueMembershipRows> {
  const mine = await db.select({ leagueId: teams.leagueId, teamId: teams.id }).from(teams).where(eq(teams.userId, userId));
  if (mine.length === 0) return { leagueRows: [], teamRows: [], draftRows: [], myTeamByLeague: new Map() };
  const candidateIds = mine.map((row) => row.leagueId);

  const leagueRows = await db
    .select()
    .from(leagues)
    .where(and(inArray(leagues.id, candidateIds), eq(leagues.isMock, false)))
    .orderBy(asc(leagues.createdAt));
  if (leagueRows.length === 0) return { leagueRows: [], teamRows: [], draftRows: [], myTeamByLeague: new Map() };
  const ids = leagueRows.map((row) => row.id);

  const teamRows = await db
    .select({
      id: teams.id,
      leagueId: teams.leagueId,
      name: teams.name,
      userId: teams.userId,
      managerName: users.displayName,
      managerAvatar: users.avatarUrl,
    })
    .from(teams)
    // See `TeamMembershipRow`: the person in the seat, on the statement that already reads the
    // seats. `innerJoin` rather than `leftJoin` because `teams.user_id` is `NOT NULL` with a
    // foreign key, so the two are the same row set and the inner form says so in the type.
    .innerJoin(users, eq(teams.userId, users.id))
    .where(inArray(teams.leagueId, ids));
  const draftRows = await db
    .select({
      id: drafts.id,
      leagueId: drafts.leagueId,
      status: drafts.status,
      kickoffAt: drafts.kickoffAt,
      startTrigger: drafts.startTrigger,
      kickoffRolls: drafts.kickoffRolls,
    })
    .from(drafts)
    .where(inArray(drafts.leagueId, ids));

  const realIds = new Set(ids);
  return {
    leagueRows,
    teamRows,
    draftRows,
    myTeamByLeague: new Map(mine.filter((row) => realIds.has(row.leagueId)).map((row) => [row.leagueId, row.teamId])),
  };
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
    isCommissioner: isCommissionerOf(league, userId),
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
 * join (`listTeamCards`), `leagueStandings`'s own `matchups` read, `leagueStandings`'s `weeks`
 * read for the league's stored medians (Phase 3.5, Task 2), and (Phase 3.5, Task 6)
 * `slotPreferenceViewFor`'s own `draft_slot_preferences` read — ten, bounded regardless of team
 * count. That tenth read only fires for a caller WITH a team here (`myTeamId !== null`); a
 * caller with none (a commissioner without one of their own) short-circuits to `null` before
 * any query, the same "no team, no query" shape `myMatchup`'s own lookup already has. This test
 * signs in as a manager with a team, so it pays the full ten. `leagueStandings` is handed
 * `league.medianGame` straight from the row this function already selected above, rather than
 * re-querying `leagues` for it, which is what keeps this bounded rather than growing with every
 * later read that also wants a `leagues` column. Pinned here, not just in the test, so a future
 * caller who adds an eleventh read trips the same assertion `invitePreview`'s neighboring test
 * would if it grew one.
 */
/**
 * Phase 3.6, Task 9: two more than the ten Fix round 1 pinned. `joinedAtQuery` below answers D1's
 * seating moment and `DraftScheduleBody.missedDraft` from the SAME row (the caller's own
 * `member_joined` audit event) — `teams.created_at` does not exist in this schema, so this is the
 * durable fact this codebase already writes that stands in for it. `completedSeasonsForMany`
 * answers `compositionCategory` for `RoomRoster`'s coarse composition line (ruling 19). Both are
 * cheap, indexed, single reads over a league's own bounded team list — never a per-team round
 * trip.
 *
 * Neon cost audit 2026-09-07, finding 7: one fewer. `leagueStandings` used to re-select the
 * league's whole `matchups` table this function had already read; it now receives those rows.
 */
export const BASELINE_LEAGUE_HOME_QUERIES = 11;

/**
 * Everything the league home page renders, assembled once on the server. `listTeamCards` is
 * imported from `@/draft-service/teams` rather than re-implemented — it is already the one
 * "team + owner's public profile" query in this codebase, and a second would drift.
 */
export async function leagueHome(db: Db, leagueId: string, userId: string, clock: Clock = systemClock): Promise<LeagueHomeBody | null> {
  const [league] = await db.select().from(leagues).where(eq(leagues.id, leagueId));
  if (league === undefined) return null;

  const matchupRows = await db.select().from(matchups).where(eq(matchups.leagueId, leagueId));
  const teamRows = await db.select({ id: teams.id, name: teams.name, userId: teams.userId }).from(teams).where(eq(teams.leagueId, leagueId));
  const [draft] = await db
    .select({ id: drafts.id, status: drafts.status, kickoffAt: drafts.kickoffAt, startTrigger: drafts.startTrigger, kickoffRolls: drafts.kickoffRolls })
    .from(drafts)
    .where(eq(drafts.leagueId, leagueId));
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

  // Task 9, D1 and `DraftScheduleBody.missedDraft`: the caller's own MOST RECENT `member_joined`
  // audit event for this league — the durable, already-written fact that stands in for a
  // `teams.created_at` column this schema does not carry. Shared with `draftScheduleView`
  // (`./draft-schedule`) so the two readers can never disagree about the same moment.
  const joinedAt = await joinedAtFor(db, { leagueId, userId: myTeamId === null ? null : userId });
  const justSeated =
    joinedAt !== null && Date.parse(clock.now()) - joinedAt.getTime() < UI_CONFIG.waitingRoom.justSeatedMinutes * 60_000;

  // Task 9, Step 3 (ruling 19): the SAME coarse reduction `PublicLeagueSummary` discloses to a
  // stranger, computed here for the league's own members rather than re-derived by a component —
  // `RoomRoster` is never handed the raw newcomer/veteran counts this reduces, only the bucket.
  const cutoff = INTEGRITY_CONFIG.participation.veteranSeasonCutoff;
  const completedSeasonsByUserId = await completedSeasonsForMany(db, teamRows.map((row) => row.userId));
  const veterans = teamRows.filter((row) => (completedSeasonsByUserId.get(row.userId) ?? 0) >= cutoff).length;
  const compositionCategory = compositionCategoryFor(tierCompositionFor({ newcomers: teamRows.length - veterans, veterans }));

  // A MEMBER league's commissioner has a team in every league (`createLeague` gives them one in
  // the same transaction it writes the league itself), so their card is already sitting in
  // `teamCards` above — no query beyond the one that already ran for the members panel. A HOUSE
  // league has no commissioner row to look up at all — `leagueAuthority`'s `house` branch
  // short-circuits `commissionerTeamId` to `undefined` before this `find` ever runs, matching
  // ruling 28: a house league has no commissioner seat for anybody to occupy.
  const authority = leagueAuthority(league);
  const commissionerTeamId = authority.kind === "member" ? teamRows.find((row) => row.userId === authority.userId)?.id : undefined;
  const commissionerCard = teamCards.find((card) => card.id === commissionerTeamId);
  const terms = leagueTerms({
    name: league.name,
    format: league.format,
    teamCount: league.teamCount,
    filledTeams: teamCards.length,
    scoring: weights ?? PPR_SCORING,
    rosterSlots: league.rosterSlots,
    stakeTier: league.stakeTier,
    // Phase 4, Task 13: straight off the SAME locked-free `league` row this function already
    // read above — `0`/`null` for every league that exists today (`moneyIsLive()` gates paid
    // creation dark), no new query.
    entryFeeCents: league.entryFeeCents,
    platformFeeCents: league.platformFeeCents,
    payoutTable: league.payoutTable,
    medianGame: league.medianGame,
    commissioner: {
      displayName: commissionerCard?.ownerDisplayName ?? "Commissioner",
      avatarUrl: commissionerCard?.ownerAvatarUrl ?? null,
    },
    // `drafts` is written in the same transaction as `leagues` (`createLeague`), so a missing
    // row here never happens in production — falling back to `clock.now()` mirrors the same
    // never-true defensive fallback `weights ?? PPR_SCORING` uses two lines above.
    kickoffAt: draft?.kickoffAt.toISOString() ?? clock.now(),
    now: clock.now(),
    // Phase 3.5, Task 8 fix round 1 (review HIGH): the SAME `draft.startTrigger` this function
    // already reads for `home.draftSchedule` two lines below, off the SAME select — `leagueTerms`
    // needs it to know whether `kickoffAt` above is a real time or still the creation placeholder.
    startTrigger: draft?.startTrigger ?? "scheduled",
  });

  // Fix round 1 (review MEDIUM): `DraftSchedulePanel`'s entire initial read, assembled from rows
  // this function already selected above (`draft`, `league.isPublicMatchmade`) — zero extra
  // queries. Null in the same never-true case `draftId`/`draftStatus` below are already null for.
  const draftSchedule: DraftScheduleBody | null =
    draft === undefined
      ? null
      : {
          draftId: draft.id,
          leagueId,
          status: draft.status,
          kickoffAt: draft.kickoffAt.toISOString(),
          isPublicMatchmade: league.isPublicMatchmade,
          // Phase 3.5, Task 8. `startTrigger` rides the SAME `draft` row this function already
          // selected above (one extra column, zero extra queries); `filledTeams` is `teamCards
          // .length`, already computed for `terms` a few lines up — `LeagueHome` reads both to
          // decide between `WaitingRoom` and `DraftSchedulePanel`, and `WaitingRoom`'s own fill
          // line.
          startTrigger: draft.startTrigger,
          kickoffRolls: draft.kickoffRolls,
          filledTeams: teamCards.length,
          // Task 6: NFFC's Kentucky Derby System. Shared with `draftScheduleView`
          // (`./draft-schedule`, the route's own read) so this page's initial render and a
          // later refetch can never compute the caller's own ranking/result differently.
          slotPreference: await slotPreferenceViewFor(db, {
            draftId: draft.id,
            status: draft.status,
            teamId: myTeamId,
            slotCount: league.teamCount,
          }),
          missedDraft: missedDraftFrom(draft.status, joinedAt, draft.kickoffAt),
        };

  return {
    leagueId,
    name: league.name,
    format: league.format,
    teamCount: league.teamCount,
    rosterSlots: league.rosterSlots,
    isCommissioner: isCommissionerOf(league, userId),
    authority,
    myTeamId,
    teams: members,
    standings: await leagueStandings(db, leagueId, teamCards, league.medianGame, matchupRows),
    medianGame: league.medianGame,
    terms,
    currentWeek,
    totalWeeks,
    myMatchup: mine === undefined ? null : toSummary(mine, nameById, weekStatus),
    weekStatus,
    draftId: draft?.id ?? null,
    draftStatus: draft?.status ?? null,
    draftSchedule,
    justSeated,
    compositionCategory,
    draftGradesVisible: league.draftGradesVisible,
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
  // E1(a)/D2: the same two columns `ScoreUpdatePayload` rides on every live frame
  // (`parseScoreFrame`, `use-live-scores.ts`) — read here so the server-rendered snapshot and
  // the live socket agree on where they start. `0`/`0` for a week with no `stat_weeks` row yet,
  // the same "nothing recorded" default `weekStatusFor` already takes for `status`.
  const [statWeekRow] = await db.select({ gamesFinal: statWeeks.gamesFinal, gamesTotal: statWeeks.gamesTotal }).from(statWeeks).where(eq(statWeeks.week, weekNumber));
  const gamesFinal = statWeekRow?.gamesFinal ?? 0;
  const gamesTotal = statWeekRow?.gamesTotal ?? 0;
  if (week.length === 0) return { leagueId, weekNumber, totalWeeks, myTeamId: null, matchups: [], weekStatus, gamesFinal, gamesTotal };

  // `null` for a non-median league (`leagues.median_game` off) and for a week that hasn't
  // settled yet — `finalizeWeekInTx` (`@/stats-pipeline/finalize`) only ever writes this column
  // when the toggle is on, so a single read answers both cases without a second `leagues.median_
  // game` check here.
  const [weekRow] = await db.select({ medianScore: weeks.medianScore }).from(weeks).where(and(eq(weeks.leagueId, leagueId), eq(weeks.weekNumber, weekNumber)));
  const leagueMedianScore = weekRow?.medianScore ?? null;

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
      // Gameday law 3 ("a player is an object"): the club code and the headshot the season
      // surfaces draw a player WITH. Free — `playerById` above already holds the whole row, so
      // this is three more fields off a map lookup that had already happened, not a fourth read.
      // `adp` rides with them because `Player` (`@research-ts/domain/player`) requires it, and a surface
      // that wants to hand this entry to `PlayerFace`/`PlayerRow` needs a whole `Player`.
      nflTeam: player?.nflTeam ?? null,
      headshotUrl: player?.headshotUrl ?? null,
      adp: player?.adp ?? null,
      // D4: "has not played" and "played and scored nothing" are different facts — the SAME
      // rule `MatchupSide.score` already honors at the team level (`null` for no live value
      // yet), stated one layer up by `initialScores`' own docblock (`live-matchup-week.tsx`).
      // A player with no stat line for the week has not been coalesced to zero since a real
      // stat set only ever covers the players who actually took the field.
      points: player === undefined || line === undefined ? null : computeFantasyPoints(line, player.position, rules),
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

  // Never true alongside a non-null `leagueMedianScore`: `finalizeWeekInTx` derives the median
  // from the SAME `scores` map it writes both matchup rows from, in the same transaction — but
  // guarded rather than asserted, the same defensive posture `nameById.get(teamId) ?? teamId`
  // takes two independent reads above.
  const medianFor = (homeScore: number | null, awayScore: number | null): MatchupMedian | null =>
    leagueMedianScore === null || homeScore === null || awayScore === null
      ? null
      : {
          score: leagueMedianScore,
          homeResult: medianResultFor(homeScore, leagueMedianScore),
          awayResult: medianResultFor(awayScore, leagueMedianScore),
        };

  // Every matchup's two sides are independent `getLineup` round trips — run the whole week's
  // worth in parallel rather than awaiting each side, one matchup at a time.
  const details: MatchupDetail[] = await Promise.all(
    week.map(async (row): Promise<MatchupDetail> => {
      const [home, away] = await Promise.all([sideFor(row.homeTeamId, row.homeScore), sideFor(row.awayTeamId, row.awayScore)]);
      return {
        weekNumber,
        home,
        away,
        final: row.homeScore !== null && row.awayScore !== null,
        weekStatus,
        median: medianFor(row.homeScore, row.awayScore),
      };
    }),
  );

  return { leagueId, weekNumber, totalWeeks, myTeamId, matchups: details, weekStatus, gamesFinal, gamesTotal };
}
