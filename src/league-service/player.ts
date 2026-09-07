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
import { and, desc, eq, lte, sql } from "drizzle-orm";
import { peekDocumentRowsFor } from "@/capsules/peek-document-store";
import type { PeekDocumentRequest } from "@/capsules/peek-document-inputs";
import { hydratePeekDocument } from "@/capsules/peek-document";
import type { PeekDocument } from "@/capsules/peek-document-row";
import type { Db } from "@/db/client";
import { leagues, matchups, playerPeekDocuments, rosterSlots, scoringSettings, teams } from "@/db/schema";
import { PPR_SCORING, type ScoringSettings } from "@/domain/scoring";
import type { Clock } from "@/domain/timing";
import { enqueuePeekDocumentRebuildsQuietly } from "@/jobs/defs/peek-document-job";
import { LEAGUE_CONFIG } from "@/league";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { scoringHashOf, type ScoringRules } from "@/scoring";
import type { PlayerSeasonBody } from "./player-body";
import { writeLeagueScoringHash } from "./scoring-hash";

export type { PlayerSeasonBody } from "./player-body";
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
  readonly ownedBy: string | null;
}

/**
 * WHO HOLDS HIM IN THIS LEAGUE RIGHT NOW, as a correlated scalar inside the one statement rather
 * than as a second round trip. `roster_slots` joined through `teams`, scoped to this league. A
 * roster move therefore changes no document at all, which is the last row of the design's own event
 * table (§3.4) and the reason an add, a drop or a trade enqueues nothing.
 */
function holderName(playerId: string) {
  return sql<string | null>`(
    select ${teams.name}
    from ${rosterSlots}
    inner join ${teams} on ${teams.id} = ${rosterSlots.teamId}
    where ${teams.leagueId} = ${leagues.id} and ${rosterSlots.playerId} = ${playerId}
    limit 1
  )`;
}

/**
 * HOW LONG THIS LEAGUE'S SEASON IS, as a correlated scalar in the same statement — the identical
 * question `seasonProgress().totalWeeks` answers from a full read of the league's fixtures, asked of
 * the database instead so the peek never pays a second round trip for it. Zero for a league whose
 * schedule has not been generated yet, which the caller reads as the configured default, exactly as
 * `seasonProgress` does.
 */
const scheduledWeeks = sql<number>`(
  select count(distinct ${matchups.weekNumber})::int
  from ${matchups}
  where ${matchups.leagueId} = ${leagues.id}
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
      ownedBy: holderName(playerId),
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
    ownedBy: row.ownedBy,
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
): Promise<PlayerSeasonBody | null> {
  const now = new Date(clock.now());
  const read = await readPeekDocumentForLeague(db, leagueId, playerId, now);
  if (read !== null) {
    return hydratePeekDocument(read.document, {
      ownedBy: read.ownedBy,
      isMockLeague: read.isMockLeague,
      seasonWeeks: read.seasonWeeks,
      requestedSeason,
    });
  }
  return await playerSeasonOnMiss(db, leagueId, playerId, now, clock, requestedSeason);
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
  readonly ownedBy: string | null;
}

async function leagueFactsFor(db: Db, leagueId: string, playerId: string): Promise<LeagueFacts | null> {
  const [league] = await db
    .select({ id: leagues.id, isMock: leagues.isMock, seasonWeeks: scheduledWeeks, ownedBy: holderName(playerId) })
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
    ownedBy: league.ownedBy,
  };
}

/**
 * THE MISS PATH (design §3.5).
 *
 * Three things happen here and they are deliberately in this order. The league's own rules are read
 * and its `scoring_hash` written, so the very next open can join; ONE player's document is built
 * through the writer's own builder, so nothing on the screen is assembled by code the stored
 * documents were not; and the whole-hash build is enqueued, so every other player in this league is
 * one statement from now on.
 *
 * IT IS SLOW ON PURPOSE AND ONLY ONCE. A novel scoring hash is a combination nobody has used before,
 * a fresh restore, or a player signed after the last build. Serving it live is the honest answer to
 * "we do not have this yet"; inventing one from a neighbouring rule set would not be.
 */
async function playerSeasonOnMiss(
  db: Db,
  leagueId: string,
  playerId: string,
  now: Date,
  clock: Clock,
  requestedSeason: number | undefined,
): Promise<PlayerSeasonBody | null> {
  const facts = await leagueFactsFor(db, leagueId, playerId);
  if (facts === null) return null;
  await writeLeagueScoringHash(db, leagueId, facts.rules);

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

  await enqueuePeekDocumentRebuildsQuietly(db, clock, {
    playerIds: null,
    scoringHashes: [facts.scoringHash],
    reason: `miss:${dayKeyOf(now)}`,
  });

  return hydratePeekDocument(row.document, {
    ownedBy: facts.ownedBy,
    isMockLeague: facts.isMockLeague,
    seasonWeeks: facts.seasonWeeks,
    requestedSeason,
  });
}
