import { and, asc, eq, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@research-ts/db/client";
import { drafts, leagues, mockRooms, teams } from "@/db/schema";
import type { DraftStatus } from "@research-ts/domain/draft";
import type { Clock } from "@research-ts/domain/timing";
import { MOCK_CONFIG, type MockMode } from "@/mock-draft/config";
import { MOCK_REFUSALS } from "./claim";

/**
 * The lobby's own reads (Task 7): the open rooms a stranger could join (`listOpenMockRooms`),
 * the caller's OWN unswept rooms for re-entry (`myMockRooms`), and one room's summary for a
 * share-link landing (`mockRoomSummary`). All three are level-triggered — request-time truth off
 * the same columns the ticker and the claim writer already trust, no stored "lobby" projection
 * anywhere (ruling 10: no anonymous or pre-seat SSE for a mock room). Every mock route requires a
 * signed-in caller (no anonymous rooms), so none of these needs its own no-existence-oracle
 * argument beyond the one `MOCK_REFUSALS.missing` already states.
 */

const systemClock: Clock = { now: () => new Date().toISOString() };

/** The league's own seats, aliased a second time so `myMockRoomsQuery` can ask "does THIS
 *  caller hold a seat here" without colliding with the same query's own unrestricted `teams`
 *  join (the fill count) — the identical two-alias shape `browseQuery`'s `seatTeams`
 *  (`@/league-service/browse`) already uses for the same reason. */
const myTeams = alias(teams, "my_teams");

export interface MockLobbyRoomSummary {
  readonly leagueId: string;
  readonly shareCode: string;
  readonly teamCount: number;
  readonly seatsOpen: number;
  readonly pickSeconds: number;
  /** `startsAt - now`, unclamped — a room already past its window (the ticker has not reached
   *  it yet) reads negative rather than a fabricated zero. The wire states the fact; rendering
   *  it is the component's job, the identical render-time-only clamp
   *  `formatRelativeCountdown` (`@/league-room/components/draft-schedule-panel`) already keeps
   *  for a real league's own countdown. */
  readonly startsInMs: number;
  /** The same instant as an absolute reading, for a ticking countdown that must not drift from a
   *  number computed once at request time (`CountdownLabel` owns its own clock). */
  readonly startsAtIso: string;
}

export interface MyMockRoomSummary extends MockLobbyRoomSummary {
  readonly draftId: string;
  readonly mode: MockMode;
  readonly status: DraftStatus;
  /** R4(b) (the lobby design review's carry): the caller's OWN team name in this room —
   *  `teams.name` is `NOT NULL` (`db/schema.ts`), and `createMockRoom` always writes one (the
   *  host's chosen name, else their profile display name, else "New team") — so a history row
   *  can name the room by what the caller actually called their team, not just its settings. */
  readonly teamName: string;
}

export interface MockRoomSummary extends MockLobbyRoomSummary {
  readonly mode: MockMode;
  /** Whether the draft behind this room has already started — a link landing needs to say so
   *  rather than offering a claim action that would only ever answer `MOCK_REFUSALS.started`. */
  readonly started: boolean;
  /** Whether the CALLER already holds a seat here — re-entry, never a roster leak: no other
   *  member's name or seat is ever named on this surface, matching the disclosure discipline
   *  `listPublicLeagues` already holds for a real league's browse card. */
  readonly alreadySeated: boolean;
}

/**
 * `lobby`-mode, unstarted, open-seat rooms only — never `link` (a share code is an invitation,
 * not a listing) and never `solo` (full from birth by construction, so it could never pass the
 * seats-open `HAVING` below regardless). Same shape as `browseQuery`/`houseShelfQuery`
 * (`@/league-service/browse`): one query, `LEFT JOIN teams` + `GROUP BY` + a `HAVING` on the
 * fill count, every narrowing applied BEFORE the `LIMIT` so a busy lobby never drops an open
 * room to make room for a fuller one the cap already excluded.
 *
 * `leagues.is_mock = true` rides the join's own `ON`, the identical second belt
 * `unstartedCandidatesQuery`/`startedExpiredQuery` (`./sweep`) already carry — this query can
 * never surface a real league even if `mock_rooms` somehow held a stray row.
 *
 * Exported as a builder, not just run inline, so `src/db/index-plans.test.ts` can `EXPLAIN`
 * exactly what production runs.
 */
export function listOpenMockRoomsQuery(db: Db) {
  return db
    .select({
      leagueId: mockRooms.leagueId,
      shareCode: mockRooms.shareCode,
      pickSeconds: mockRooms.pickSeconds,
      startsAt: mockRooms.startsAt,
      teamCount: leagues.teamCount,
      filledTeams: sql<number>`count(${teams.id})::int`,
    })
    .from(mockRooms)
    .innerJoin(leagues, and(eq(leagues.id, mockRooms.leagueId), eq(leagues.isMock, true)))
    .innerJoin(drafts, eq(drafts.leagueId, mockRooms.leagueId))
    .leftJoin(teams, eq(teams.leagueId, mockRooms.leagueId))
    .where(and(eq(mockRooms.mode, "lobby"), eq(drafts.status, "scheduled")))
    .groupBy(mockRooms.leagueId, leagues.id, drafts.id)
    .having(sql`count(${teams.id}) < ${leagues.teamCount}`)
    .orderBy(asc(mockRooms.startsAt))
    .limit(MOCK_CONFIG.maxLobbyListing);
}

export async function listOpenMockRooms(db: Db, clock: Clock = systemClock): Promise<readonly MockLobbyRoomSummary[]> {
  const nowMs = Date.parse(clock.now());
  const rows = await listOpenMockRoomsQuery(db);
  return rows.map((row) => ({
    leagueId: row.leagueId,
    shareCode: row.shareCode,
    teamCount: row.teamCount,
    seatsOpen: row.teamCount - row.filledTeams,
    pickSeconds: row.pickSeconds,
    startsInMs: row.startsAt.getTime() - nowMs,
    startsAtIso: row.startsAt.toISOString(),
  }));
}

/**
 * The caller's OWN mock rooms, any mode, not yet swept — lobby re-entry after a refresh or a
 * closed tab. The `myTeams` alias is joined as the membership TEST (does a seat for this
 * `userId` exist in this league — the unique `(league_id, user_id)` index makes it at most one
 * row, so no fan-out); the plain `teams` join stays the UNRESTRICTED fill count, exactly the
 * two-purpose split `browseQuery`'s `seatCompletedSeasonsQuery` already keeps for the same
 * table joined twice. A bot never carries a human's `userId`, so this can never surface a room
 * the caller only shares with bots.
 *
 * `myTeams.name` rides the same join, selected via the identical primary-key functional
 * dependency `leagues.teamCount`/`drafts.status` already lean on above (Postgres allows any
 * column from a table whose PRIMARY KEY is fully present in `GROUP BY` — `myTeams.id` here,
 * `leagues.id`/`drafts.id` there) rather than a second query for a fact this join already holds
 * (R4(b), the lobby design review's carry).
 *
 * D4 (the same review): a `dissolved` room is excluded outright — a room that cleared itself is
 * not history worth a row, and the results page it would have linked to already died with it.
 */
export function myMockRoomsQuery(db: Db, userId: string) {
  return db
    .select({
      leagueId: mockRooms.leagueId,
      draftId: drafts.id,
      shareCode: mockRooms.shareCode,
      mode: mockRooms.mode,
      status: drafts.status,
      pickSeconds: mockRooms.pickSeconds,
      startsAt: mockRooms.startsAt,
      teamCount: leagues.teamCount,
      teamName: myTeams.name,
      filledTeams: sql<number>`count(${teams.id})::int`,
    })
    .from(mockRooms)
    .innerJoin(leagues, and(eq(leagues.id, mockRooms.leagueId), eq(leagues.isMock, true)))
    .innerJoin(drafts, eq(drafts.leagueId, mockRooms.leagueId))
    .innerJoin(myTeams, and(eq(myTeams.leagueId, mockRooms.leagueId), eq(myTeams.userId, userId)))
    .leftJoin(teams, eq(teams.leagueId, mockRooms.leagueId))
    .where(ne(drafts.status, "dissolved"))
    .groupBy(mockRooms.leagueId, leagues.id, drafts.id, myTeams.id)
    .orderBy(asc(mockRooms.startsAt))
    .limit(MOCK_CONFIG.maxLobbyListing);
}

export async function myMockRooms(db: Db, userId: string, clock: Clock = systemClock): Promise<readonly MyMockRoomSummary[]> {
  const nowMs = Date.parse(clock.now());
  const rows = await myMockRoomsQuery(db, userId);
  return rows.map((row) => ({
    leagueId: row.leagueId,
    draftId: row.draftId,
    shareCode: row.shareCode,
    mode: row.mode,
    status: row.status,
    teamCount: row.teamCount,
    teamName: row.teamName,
    seatsOpen: row.teamCount - row.filledTeams,
    pickSeconds: row.pickSeconds,
    startsInMs: row.startsAt.getTime() - nowMs,
    startsAtIso: row.startsAt.toISOString(),
  }));
}

export type MockRoomLookup = { readonly ok: true; readonly summary: MockRoomSummary } | { readonly ok: false; readonly status: number; readonly reason: string };

/**
 * One room's summary, by its share code, for a link landing — stopping short of taking any lock
 * or writing anything, unlike `claimMockSeat`'s own lookup chain (`./claim`). ONE query for the
 * room, its league and its draft (never `claimMockSeatInTx`'s own staged reads, which exist only
 * because that writer eventually takes a `leagues FOR UPDATE` lock in between them) — a mock
 * league's `mock_rooms` and `drafts` rows are written together in `createMockRoom`'s one
 * transaction and never independently deleted, so a single join is both simpler and the true
 * shape of the fact being asked. The same no-existence-oracle collapse `claimMockSeatInTx`
 * already keeps: a stale code and a never-issued one answer identically (`MOCK_REFUSALS.missing`),
 * so a stranger holding an old link learns only that the room is gone, never whether it ever
 * existed.
 */
export async function mockRoomSummary(db: Db, code: string, userId: string, clock: Clock = systemClock): Promise<MockRoomLookup> {
  const [room] = await db
    .select({
      leagueId: mockRooms.leagueId,
      mode: mockRooms.mode,
      pickSeconds: mockRooms.pickSeconds,
      startsAt: mockRooms.startsAt,
      teamCount: leagues.teamCount,
      status: drafts.status,
    })
    .from(mockRooms)
    .innerJoin(leagues, and(eq(leagues.id, mockRooms.leagueId), eq(leagues.isMock, true)))
    .innerJoin(drafts, eq(drafts.leagueId, mockRooms.leagueId))
    .where(eq(mockRooms.shareCode, code));
  if (room === undefined) return { ok: false, status: 404, reason: MOCK_REFUSALS.missing };

  const seats = await db.select({ userId: teams.userId }).from(teams).where(eq(teams.leagueId, room.leagueId));

  return {
    ok: true,
    summary: {
      leagueId: room.leagueId,
      shareCode: code,
      mode: room.mode,
      teamCount: room.teamCount,
      seatsOpen: room.teamCount - seats.length,
      pickSeconds: room.pickSeconds,
      startsInMs: room.startsAt.getTime() - Date.parse(clock.now()),
      startsAtIso: room.startsAt.toISOString(),
      started: room.status !== "scheduled",
      alreadySeated: seats.some((seat) => seat.userId === userId),
    },
  };
}
