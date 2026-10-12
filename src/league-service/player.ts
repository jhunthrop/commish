// A PLAYER'S WHOLE SEASON ON ONE SCREEN, IN ONE DATABASE ROUND TRIP (peek document design §3.2,
// 2026-09-07).
//
// WHAT THIS FILE USED TO BE. Every open of a peek assembled the page from live tables: the player
// row, the league row, the fixtures, the played weeks, the scoring settings, the whole product
// player universe, the crosswalk, the precomputed facts row, the roster holder, the injuries
// snapshot, the news snapshot, the capsule, then the season's own chart and the four draft-outlook
// reads. Nineteen statements at the end of the peek-facts round, seventy-three before it. Every one
// of them answered the same question for the same player every time it was asked.
//
// WHAT IT IS NOW. `player_peek_documents` holds the finished body, keyed by the rules that scored it
// (`scoringHashOf`), rebuilt by events rather than by a request. This file joins the league to its
// document and applies the three things one league contributes that a shared document cannot know:
// who holds the man right now, whether the room is a mock, and how long this league's season is.
// One statement, asserted as an equality in `player.document.test.ts`.
//
// THE MISS PATH IS NOT A SECOND ASSEMBLY. A league whose hash has no documents yet, or a player no
// build has reached, is served by the SAME builder the writer uses (`peekDocumentRowsFor`), for one
// player, and the whole-hash build is enqueued so the next open is one statement again.
import { and, desc, eq, lte, or, sql } from "drizzle-orm";
import { peekDocumentRowsFor } from "@/league-service/peek/peek-document-store";
import type { PeekDocumentRequest } from "@/league-service/peek/peek-document-inputs";
import { buildPeekDocument, hydratePeekDocument } from "@/league-service/peek/peek-document";
import type { PeekDocument } from "@/league-service/peek/peek-document-row";
import type { Db } from "@research-ts/db/client";
import { playerCrosswalk, players, preseasonProjections } from "@research-ts/db/schema";
import { leagues, matchups, playerPeekDocuments, scoringSettings, teams } from "@/db/schema";
import { PPR_SCORING, type ScoringSettings } from "@research-ts/domain/scoring";
import type { Clock } from "@research-ts/domain/timing";
import { enqueuePeekDocumentRebuildsQuietly } from "@/jobs/defs/peek-document-job";
import { LEAGUE_CONFIG } from "@/league";
import type { Player } from "@research-ts/domain/player";
import { boardFormatForRules, boardSourceFor } from "@research-ts/projections/preseason/board-formats";
import { PRODUCT_SEASON } from "@research-ts/projections/preseason/current";
import { type ScoringRules } from "@research-ts/scoring";
import { scoringHashOf } from "@research-ts/scoring/hash";
import type { PlayerLeagueDraftPhase, PlayerOwner, PlayerOwnerRelation, PlayerSeasonBody } from "./player-body";
import { currentWeekOf } from "./schedule";
import { writeLeagueScoringHash } from "./scoring-hash";

export type { PlayerLeagueDraftPhase, PlayerOwner, PlayerOwnerRelation, PlayerSeasonBody } from "./player-body";
export type { PlayerGameLogRow, PlayerSeasonTotals, PlayerWeekView } from "./player-season-stats";

/** The outermost edge is the only place a wall clock is allowed, exactly as every other service
 *  in this directory has it. */
const systemClock: Clock = { now: () => new Date().toISOString() };

/** The earliest season this product will ever entertain as a real request — nowhere near the peek's
 *  own three-year lookback, just a sanity floor against garbage input. */
const EARLIEST_PLAUSIBLE_SEASON = 2000;

/**
 * THE ONE PLACE A `season` QUERY PARAM BECOMES A NUMBER — both the API route and the player page
 * parsed this identically inline before this extraction, which is exactly the kind of duplication
 * that drifts the moment one call site gets a bound the other does not.
 *
 * `undefined` in, `undefined` out: an absent or empty param means "let the service pick its own
 * default", never a fabricated year. Anything that is not a clean, in-range integer — `"2025.5"`,
 * `"2025e2"`, `"abc"`, a season before this product's earliest plausible one, or one after the
 * season being drafted for — is REJECTED here rather than surviving to the document's own
 * `availableSeasons` membership check. Both would end up at the same fallback (the newest available
 * season), but rejecting malformed input up front, in one place, is the difference between "this
 * looks like validation" and "this happens to work because a later filter also failed to match".
 */
export function parseSeasonParam(raw: string | null | undefined): number | undefined {
  if (raw === null || raw === undefined || raw === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return undefined;
  if (parsed < EARLIEST_PLAUSIBLE_SEASON || parsed > PRODUCT_SEASON) return undefined;
  return parsed;
}

/** What the one statement returns: the finished document plus the three live league facts. */
interface DocumentRead {
  readonly document: PeekDocument;
  readonly isMockLeague: boolean;
  readonly seasonWeeks: number;
  readonly draftPhase: PlayerLeagueDraftPhase;
  readonly holder: HolderRow | null;
}

/** The holder, as the one correlated scalar returns him. `relation` is not here: it is a fact about
 *  the READER, which this statement has no seat for, and is resolved separately. */
interface HolderRow {
  readonly teamId: string;
  readonly teamName: string;
  readonly managerName: string;
  readonly managerAvatar: string | null;
}

/**
 * EVERY CORRELATED SCALAR IN THIS FILE WRITES ITS OWN IDENTIFIERS, QUALIFIED, IN LITERAL SQL — and
 * that is a bug fix, not a style (2026-09-11).
 *
 * Drizzle decides whether to qualify a column with its table PER QUERY, not per fragment: a select
 * with a join renders `"teams"."id"`, and a select from ONE table renders a bare `"id"` because
 * nothing in that query could be ambiguous. That optimisation is correct for the outer columns and
 * catastrophic inside a correlated subquery, which brings tables of its own that the optimisation
 * never looked at. `readPeekDocumentForLeague` joins, so it rendered fine; `leagueFactsFor` — the
 * MISS path, the one a fresh league always takes — reads `leagues` alone, and the identical
 * fragments came out as `select "id", "name" ... from "roster_slots" inner join "teams" on "id" =
 * "team_id"`, which Postgres refuses outright: 42702, "column reference id is ambiguous".
 *
 * The two older scalars had the same defect and it was SILENT, which is worse. `where "league_id" =
 * "id"` inside `from "drafts"` resolves both names against `drafts` itself, so it compared a draft's
 * league to the draft's own id, matched nothing, and answered `null` — every league on the miss path
 * would have read as pre-draft forever, with no error anywhere.
 *
 * So these three fragments no longer ask Drizzle to render their columns. The inner tables carry
 * short aliases, every column names one, and the only interpolation left is the BOUND parameter.
 * `leagues.id` is unqualified-by-alias on purpose: it is the OUTER query's table, and both call
 * sites select from `leagues` under its own name. The compile-time safety this trades away is paid
 * back by `player.live-facts.test.ts`, which asserts all three answers against a real database.
 */

/**
 * WHO HOLDS HIM IN THIS LEAGUE RIGHT NOW, as a correlated scalar inside the one statement rather
 * than as a second round trip. `roster_slots` joined through `teams` and on to the person who runs
 * the team, scoped to this league. A roster move therefore changes no document at all, which is the
 * last row of the design's own event table (§3.4) and the reason an add, a drop or a trade enqueues
 * nothing.
 *
 * ONE SCALAR, NOT FOUR. The Sideline round needed the manager's name and avatar beside the team's
 * (P1: the person comes before the number), and four correlated subselects over the same one-row
 * lookup would be four index scans for one answer. `json_build_object` keeps it at one.
 */
function holder(playerId: string) {
  return sql<HolderRow | null>`(
    select json_build_object(
      'teamId', h_team.id,
      'teamName', h_team.name,
      'managerName', h_user.display_name,
      'managerAvatar', h_user.avatar_url
    )
    from roster_slots h_slot
    inner join teams h_team on h_team.id = h_slot.team_id
    inner join users h_user on h_user.id = h_team.user_id
    where h_team.league_id = leagues.id and h_slot.player_id = ${playerId}
    limit 1
  )`;
}

/**
 * WHAT THE HOLDER IS TO THE READER (P6) — `"you"`, `"rival"` (he is on the team you play THIS WEEK),
 * or `"other"`. Two small reads, and only ever for a player somebody actually holds: a free agent
 * has no relation to resolve and a read with no reader (`viewerUserId` absent, which is every
 * background rebuild) answers `"other"` without asking the database anything.
 *
 * The week is `currentWeekOf`'s — the product's single definition of which week a league is living
 * in — never a wall clock and never a second opinion computed here.
 */
async function ownerRelationFor(db: Db, leagueId: string, holderTeamId: string, viewerUserId: string | undefined): Promise<PlayerOwnerRelation> {
  if (viewerUserId === undefined) return "other";
  const [mine] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.leagueId, leagueId), eq(teams.userId, viewerUserId)));
  // A commissioner with no team of his own, or a reader who is not in this league at all: nobody
  // here is his rival, and nothing on the screen claims one.
  if (mine === undefined) return "other";
  if (mine.id === holderTeamId) return "you";
  const week = await currentWeekOf(db, leagueId);
  const [fixture] = await db
    .select({ home: matchups.homeTeamId, away: matchups.awayTeamId })
    .from(matchups)
    .where(
      and(
        eq(matchups.leagueId, leagueId),
        eq(matchups.weekNumber, week),
        or(eq(matchups.homeTeamId, mine.id), eq(matchups.awayTeamId, mine.id)),
      ),
    );
  if (fixture === undefined) return "other";
  const opponent = fixture.home === mine.id ? fixture.away : fixture.home;
  return opponent === holderTeamId ? "rival" : "other";
}

/** The holder row plus the reader's relation to him, as the body carries it. `null` in, `null` out:
 *  a free agent in this league is an absence, never an owner object with empty strings in it. */
async function ownerFor(db: Db, leagueId: string, row: HolderRow | null, viewerUserId: string | undefined): Promise<PlayerOwner | null> {
  if (row === null) return null;
  return { ...row, relation: await ownerRelationFor(db, leagueId, row.teamId, viewerUserId) };
}

/**
 * HOW LONG THIS LEAGUE'S SEASON IS, as a correlated scalar in the same statement — the identical
 * question `seasonProgress().totalWeeks` answers from a full read of the league's fixtures, asked of
 * the database instead so the peek never pays a second round trip for it. Zero for a league whose
 * schedule has not been generated yet, which the caller reads as the configured default, exactly as
 * `seasonProgress` does.
 */
/**
 * WHERE THIS LEAGUE'S DRAFT STANDS, as a correlated scalar in the same statement — `drafts.status`
 * is the product's single definition of it (`commitDraftResults` is what writes `'complete'`), so
 * this is a read of that authority and never a second opinion inferred from empty rosters. A league
 * with no `drafts` row answers `null`, which `draftPhaseOf` reads as pre-draft, the same thing that
 * authority would say.
 *
 * THREE STATES, NOT A BOOLEAN (fix round 2, H1). The first cut asked only "has it drafted", which
 * folded a RUNNING draft in with a scheduled one — and the peek is mounted inside the draft room
 * (`draft-room.tsx`), so a live room offered a solid pill linking OUT of the draft the manager was
 * in the middle of. The middle state is the whole reason this is not a flag.
 */
const leagueDraftStatus = sql<string | null>`(
  select d.status from drafts d where d.league_id = leagues.id limit 1
)`;

/** `drafts.status` as the body's own three states. `'dissolved'` and an absent row are pre-draft:
 *  no draft has happened, so no season verb can be honest. */
function draftPhaseOf(status: string | null): PlayerLeagueDraftPhase {
  if (status === "complete") return "complete";
  if (status === "in_progress") return "live";
  return "predraft";
}

const scheduledWeeks = sql<number>`(
  select count(distinct m.week_number)::int
  from matchups m
  where m.league_id = leagues.id
)`;

/**
 * THE ONE STATEMENT (design §3.2). One `select` from `leagues`, inner joined to this player's
 * documents on (season, scoring hash, player id), gated by `as_of <= now`, newest first, one row.
 *
 * `null` means one of three honest things and the miss path tells them apart: no such league, a
 * league whose `scoring_hash` has never been computed, or a hash nothing has built documents for.
 */
async function readPeekDocumentForLeague(db: Db, leagueId: string, playerId: string, now: Date): Promise<DocumentRead | null> {
  const [row] = await db
    .select({
      document: playerPeekDocuments.document,
      isMock: leagues.isMock,
      seasonWeeks: scheduledWeeks,
      draftStatus: leagueDraftStatus,
      holder: holder(playerId),
    })
    .from(leagues)
    .innerJoin(
      playerPeekDocuments,
      and(
        eq(playerPeekDocuments.season, PRODUCT_SEASON),
        eq(playerPeekDocuments.scoringHash, leagues.scoringHash),
        eq(playerPeekDocuments.playerId, playerId),
        lte(playerPeekDocuments.asOf, now),
      ),
    )
    .where(eq(leagues.id, leagueId))
    .orderBy(desc(playerPeekDocuments.asOf))
    .limit(1);
  if (row === undefined) return null;
  return {
    document: row.document,
    isMockLeague: row.isMock,
    seasonWeeks: row.seasonWeeks === 0 ? LEAGUE_CONFIG.regularSeasonWeeks : row.seasonWeeks,
    draftPhase: draftPhaseOf(row.draftStatus),
    holder: row.holder,
  };
}

/**
 * A player's whole season on one screen, read under one league's scoring rules.
 *
 * WHY THE LEAGUE IS A PARAMETER AND NOT A CONVENIENCE. A fantasy point is not a property of a
 * player, it is a property of a player inside a rule set: the same catch is 1.0 points in this
 * league and 0.5 in the one next door. There is no honest league-free version of this page, which is
 * why it lives under `/leagues/[leagueId]/` and why the stored document is keyed by
 * `scoringHashOf(the league's rules)` rather than shared across every rule set alike.
 *
 * `null` means there is no such player. A player who EXISTS but has no facts yet gets a body full of
 * honest absence, which is a different answer and a different screen.
 */
export async function playerSeason(
  db: Db,
  leagueId: string,
  playerId: string,
  clock: Clock = systemClock,
  requestedSeason?: number,
  viewerUserId?: string,
): Promise<PlayerSeasonBody | null> {
  const now = new Date(clock.now());
  const read = await readPeekDocumentForLeague(db, leagueId, playerId, now);
  if (read !== null) {
    const owner = await ownerFor(db, leagueId, read.holder, viewerUserId);
    return hydratePeekDocument(read.document, {
      ownedBy: owner?.teamName ?? null,
      owner,
      isMockLeague: read.isMockLeague,
      draftPhase: read.draftPhase,
      seasonWeeks: read.seasonWeeks,
      requestedSeason,
    });
  }
  return await playerSeasonOnMiss(db, leagueId, playerId, now, clock, requestedSeason, viewerUserId);
}

/**
 * THE MISS'S OWN GENERATION STAMP (fix round, 2026-09-07) — the UTC calendar day.
 *
 * WHY A MISS NEEDS ONE AT ALL. `enqueueJob` dedupes on the idempotency key across every status a
 * job can be in, forever: a key that has already been used is refused whether that job succeeded,
 * is still pending, or DEAD-LETTERED. A miss keyed on the hash alone would therefore mean that if
 * the very first build for a novel scoring hash failed its attempts, no later open of any peek in
 * any league sharing that hash could ever ask for it again, and every one of them would pay the miss
 * path forever with no queued work to fix it.
 *
 * A DAY, not an instant: every miss inside one day still coalesces into a single build, which is the
 * whole point of the key (a league opening thirty peeks in a row must not enqueue thirty whole-hash
 * builds), while the next day is a fresh chance for a build that never landed.
 */
function dayKeyOf(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** What the miss path has to read for itself, because there was no document row to carry it. */
interface LeagueFacts {
  readonly rules: ScoringRules;
  readonly scoringHash: string;
  readonly isMockLeague: boolean;
  readonly seasonWeeks: number;
  readonly draftPhase: PlayerLeagueDraftPhase;
  readonly holder: HolderRow | null;
}

async function leagueFactsFor(db: Db, leagueId: string, playerId: string): Promise<LeagueFacts | null> {
  const [league] = await db
    .select({ id: leagues.id, isMock: leagues.isMock, seasonWeeks: scheduledWeeks, draftStatus: leagueDraftStatus, holder: holder(playerId) })
    .from(leagues)
    .where(eq(leagues.id, leagueId));
  if (league === undefined) return null;

  const [settings] = await db.select().from(scoringSettings).where(eq(scoringSettings.leagueId, leagueId));
  // The same `PPR_SCORING` fallback this function has always used for a league whose settings row
  // was never written.
  const rules: ScoringSettings = settings ?? { leagueId, ...PPR_SCORING };
  return {
    rules,
    scoringHash: scoringHashOf(rules),
    isMockLeague: league.isMock,
    seasonWeeks: league.seasonWeeks === 0 ? LEAGUE_CONFIG.regularSeasonWeeks : league.seasonWeeks,
    draftPhase: draftPhaseOf(league.draftStatus),
    holder: league.holder,
  };
}

/** Whether this hash has ANY documents for the season — the difference between "a scoring
 *  combination nobody has ever used" and "a league we have built, asked about a player we have
 *  not". Counted rather than fetched: the answer is one bit and the rows are large. */
async function hashHasDocuments(db: Db, scoringHash: string): Promise<boolean> {
  const [row] = await db
    .select({ playerId: playerPeekDocuments.playerId })
    .from(playerPeekDocuments)
    .where(and(eq(playerPeekDocuments.season, PRODUCT_SEASON), eq(playerPeekDocuments.scoringHash, scoringHash)))
    .limit(1);
  return row !== undefined;
}

/**
 * Is he on the board at all? A player with no projected row is one this engine has nothing to say
 * about beyond his name and position: no rank, no dossier, no capsule, no reasons. Reading one
 * crosswalk row and one projection row is the whole question, and it is a great deal cheaper than
 * the assembly that would answer it by producing nothing.
 */
async function isOnTheBoard(db: Db, playerId: string, rules: ScoringRules): Promise<boolean> {
  // The league's own board (the scoring-formats round): the source follows its scoring row.
  const source = boardSourceFor(boardFormatForRules(rules).format);
  const [row] = await db
    .select({ playerId: preseasonProjections.playerId })
    .from(preseasonProjections)
    .innerJoin(playerCrosswalk, eq(playerCrosswalk.nflPlayerId, preseasonProjections.playerId))
    .where(
      and(
        eq(playerCrosswalk.playerId, playerId),
        eq(preseasonProjections.season, PRODUCT_SEASON),
        eq(preseasonProjections.source, source),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * THE OFF-BOARD ABSENCE BODY (review, addition B) — his name, his position, and the absence copy
 * every module already renders for a player nothing has been measured about.
 *
 * IT IS NOT A SECOND ASSEMBLY, the rule this module's own header sets: it goes through
 * `buildPeekDocument`, the same pure builder every stored document is made by, handed empty inputs
 * because empty is what the stores actually hold for him. What it skips is the READING
 * (`collectPeekDocumentInputs`), which for an off-board player is a board join, a facts read, a
 * capsule read and three seasons of stat lines, all to discover there is nothing there. That was
 * five to fifteen seconds of a manager's time to be told a name and a position.
 */
function offBoardBody(player: Player, facts: LeagueFacts, now: Date, requestedSeason: number | undefined, owner: PlayerOwner | null): PlayerSeasonBody {
  const document = buildPeekDocument({
    player,
    isRookie: false,
    positionRank: null,
    adpPercentile: null,
    expertRank: null,
    modelRank: null,
    injuryDesignation: null,
    news: [],
    reasons: [],
    capsule: null,
    dossier: null,
    seasons: [],
    asOf: now,
    basis: {
      scoringHash: facts.scoringHash,
      factsAsOf: null,
      capsuleGeneratedAt: null,
      capsuleFactsHash: null,
      injuryCapturedAt: null,
      newsCapturedAt: null,
      lastFinalizedWeek: null,
      sourceKeys: [],
    },
  });
  return hydratePeekDocument(document, {
    ownedBy: owner?.teamName ?? null,
    owner,
    isMockLeague: facts.isMockLeague,
    draftPhase: facts.draftPhase,
    seasonWeeks: facts.seasonWeeks,
    requestedSeason,
  });
}

/**
 * THE MISS PATH (design §3.5, narrowed by the review's addition B).
 *
 * The league's own rules are read and its `scoring_hash` written, so the very next open can join,
 * and the whole-hash build is enqueued, so every other player in this league is one statement from
 * now on. What happens in between depends on WHY this was a miss:
 *
 * A NOVEL SCORING HASH (nothing has ever been built for it) still builds this one player
 * synchronously, through the writer's own builder. It is slow on purpose and only once: serving it
 * live is the honest answer to "we do not have this yet", and inventing one from a neighbouring
 * rule set would not be.
 *
 * A PLAYER THIS BUILT HASH SIMPLY HAS NO ROW FOR is answered immediately. If he is not on the
 * board, the synchronous build can only ever produce the absence body `offBoardBody` returns
 * directly, so paying for it is paying to be told nothing slowly (the founder's own screenshot: a
 * blank sheet for five to fifteen seconds). If he IS on the board, the build is worth its cost and
 * still runs: he has a rank, a dossier and a capsule to state.
 */
async function playerSeasonOnMiss(
  db: Db,
  leagueId: string,
  playerId: string,
  now: Date,
  clock: Clock,
  requestedSeason: number | undefined,
  viewerUserId: string | undefined,
): Promise<PlayerSeasonBody | null> {
  const facts = await leagueFactsFor(db, leagueId, playerId);
  if (facts === null) return null;
  const owner = await ownerFor(db, leagueId, facts.holder, viewerUserId);
  await writeLeagueScoringHash(db, leagueId, facts.rules);

  // The rebuild is enqueued whichever branch answers below: this league's hash needs its documents
  // either way, and a coalescing key means a second miss the same day costs nothing.
  await enqueuePeekDocumentRebuildsQuietly(db, clock, {
    playerIds: null,
    scoringHashes: [facts.scoringHash],
    reason: `miss:${dayKeyOf(now)}`,
  });

  if (await hashHasDocuments(db, facts.scoringHash)) {
    const [player] = await db.select().from(players).where(eq(players.id, playerId));
    // No such player in `players` at all — the one case that is a 404 rather than a body of absence.
    if (player === undefined) return null;
    if (!(await isOnTheBoard(db, playerId, facts.rules))) {
      return offBoardBody({ ...player, headshotUrl: player.headshotUrl ?? null, adp: player.adp ?? null }, facts, now, requestedSeason, owner);
    }
  }

  const request: PeekDocumentRequest = {
    season: PRODUCT_SEASON,
    scoringHash: facts.scoringHash,
    rules: facts.rules,
    playerIds: [playerId],
    asOf: now,
  };
  const [row] = await peekDocumentRowsFor(db, request);
  // No row means no such player in `players` at all — the one case that is a 404 rather than a body
  // full of absence.
  if (row === undefined) return null;

  return hydratePeekDocument(row.document, {
    ownedBy: owner?.teamName ?? null,
    owner,
    isMockLeague: facts.isMockLeague,
    draftPhase: facts.draftPhase,
    seasonWeeks: facts.seasonWeeks,
    requestedSeason,
  });
}
