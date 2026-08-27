import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { drafts, leagues, mockRooms, reviews, teams, users } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { LEAGUE_CONFIG } from "@/league/config";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import { EMPTY_BROWSE_FILTER } from "@/matchmaking/filter";
import { browseQuery } from "./browse";
import { completedSeasonsFor } from "./participation";
import { myLeaguesOverview } from "./read";
import { listWireItems } from "./wire";
import { leaguesFilledQuery, proofStats } from "./proof";

const db = createTestDb();

const fixedAt = (iso: string): Clock => ({ now: () => iso });

/** Comfortably inside `LEAGUE_CONFIG.season.startedAt` — every seeded league in this file uses
 *  it unless a test is specifically exercising the season boundary itself. */
const DEFAULT_CREATED_AT = new Date("2026-08-15T00:00:00.000Z");
/** The instant every test treats as "now" unless it overrides the clock — chosen so a 48-hour
 *  window from here lands cleanly inside `DEFAULT_KICKOFF`'s neighborhood below. */
const NOW = "2026-09-10T12:00:00.000Z";
const DEFAULT_KICKOFF = new Date("2026-09-20T00:00:00.000Z");

// `proofStats` (wave-1 review LOW) reads no clock of its own any more — `clock` below is still
// needed by `listWireItems` at the bottom of this file.
const clock = fixedAt(NOW);

let leagueSeq = 0;

/**
 * One league and its one draft — the whole shape `leaguesFilledQuery` and `reviewAggregateQuery`
 * read. No `teams` rows: neither query reads `teams` at all, so seeding them here would only be
 * decoration — `seedFillingLeague` below is the seeder for the two queries that do.
 */
async function seedLeague(opts: {
  readonly draftStatus: "scheduled" | "in_progress" | "complete";
  readonly createdAt?: Date;
  readonly kickoffAt?: Date;
  readonly isPublicMatchmade?: boolean;
}): Promise<string> {
  leagueSeq += 1;
  const id = `plg${leagueSeq}`;
  const commissionerId = `plg_owner_${leagueSeq}`;
  await db.insert(users).values({ id: commissionerId, email: `${commissionerId}@test.local`, displayName: commissionerId }).onConflictDoNothing();
  await db.insert(leagues).values({
    id,
    name: id,
    format: "snake",
    teamCount: 12,
    isPublicMatchmade: opts.isPublicMatchmade ?? true,
    commissionerUserId: commissionerId,
    createdAt: opts.createdAt ?? DEFAULT_CREATED_AT,
  });
  await db.insert(drafts).values({
    id: `${id}_draft`,
    leagueId: id,
    format: "snake",
    status: opts.draftStatus,
    kickoffAt: opts.kickoffAt ?? DEFAULT_KICKOFF,
  });
  return id;
}

/**
 * `drafted` leagues get a draft that actually ran (split between `in_progress` and `complete`,
 * proving neither status alone is what this counts); `full` and `filling` both get a
 * `'scheduled'` draft — team fill has no bearing on `leaguesFilled` at all (the query never
 * reads `teams`), so the only thing distinguishing them from `drafted` is the status column,
 * which is the exact claim this seeder exists to isolate.
 */
async function seedLeagues(counts: { readonly drafted: number; readonly full: number; readonly filling: number }): Promise<void> {
  for (let i = 0; i < counts.drafted; i += 1) {
    await seedLeague({ draftStatus: i % 2 === 0 ? "complete" : "in_progress" });
  }
  for (let i = 0; i < counts.full; i += 1) {
    await seedLeague({ draftStatus: "scheduled" });
  }
  for (let i = 0; i < counts.filling; i += 1) {
    await seedLeague({ draftStatus: "scheduled" });
  }
}

/**
 * A league, its one `'scheduled'` draft, and `filledTeams` real seats — the shape
 * `roomsFillingQuery`/`tightestRoomQuery` read (storefront review R1). Real teams through a
 * direct insert (not `joinPublicLeague`) because these two queries only ever read `teams`'
 * count, never the join door's own side effects.
 */
async function seedFillingLeague(opts: {
  readonly teamCount?: number;
  readonly filledTeams: number;
  readonly isPublicMatchmade?: boolean;
  readonly draftStatus?: "scheduled" | "in_progress" | "complete";
}): Promise<string> {
  leagueSeq += 1;
  const id = `fill${leagueSeq}`;
  const commissionerId = `fill_owner_${leagueSeq}`;
  const teamCount = opts.teamCount ?? 12;
  await db.insert(users).values({ id: commissionerId, email: `${commissionerId}@test.local`, displayName: commissionerId }).onConflictDoNothing();
  await db.insert(leagues).values({
    id,
    name: id,
    format: "snake",
    teamCount,
    isPublicMatchmade: opts.isPublicMatchmade ?? true,
    commissionerUserId: commissionerId,
    createdAt: DEFAULT_CREATED_AT,
  });
  await db.insert(drafts).values({
    id: `${id}_draft`,
    leagueId: id,
    format: "snake",
    status: opts.draftStatus ?? "scheduled",
    kickoffAt: DEFAULT_KICKOFF,
  });
  for (let i = 0; i < opts.filledTeams; i += 1) {
    const userId = `${id}_u${i}`;
    await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: userId }).onConflictDoNothing();
    await db.insert(teams).values({ id: `${id}_t${i}`, leagueId: id, userId, name: `${id} team ${i}` });
  }
  return id;
}

let reviewSeq = 0;

/** Ratings, one per review, so a caller can hit an exact average (`seedReviews`'s own docblock)
 *  rather than a rounded one. Defaults to five stars across the board. */
async function seedReviews(count: number, opts?: { readonly ratings?: readonly number[]; readonly removed?: boolean }): Promise<void> {
  const ratings = opts?.ratings ?? Array.from({ length: count }, () => 5);
  for (let i = 0; i < count; i += 1) {
    reviewSeq += 1;
    const userId = `rev_u${reviewSeq}`;
    await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: userId }).onConflictDoNothing();
    await db.insert(reviews).values({
      id: `rev_${reviewSeq}`,
      userId,
      rating: ratings[i] ?? 5,
      body: "A generic review body that clears the twenty character minimum with room to spare.",
      removedAt: opts?.removed === true ? new Date("2026-08-01T00:00:00.000Z") : null,
      removedByUserId: opts?.removed === true ? userId : null,
      removalReason: opts?.removed === true ? "other" : null,
    });
  }
}

let mockSeq = 0;

/**
 * A mock league that drafted all the way to completion — a league row (`isMock: true,
 * isPublicMatchmade: false`), its `mock_rooms` sidecar, a `'complete'` draft and a seated host —
 * the whole shape a real one has, so a test that finds this invisible to a real aggregate is a
 * genuine proof of the exclusion rather than an artifact of the shape being incomplete.
 */
async function seedCompletedMockRoom(): Promise<{ readonly leagueId: string; readonly hostUserId: string }> {
  mockSeq += 1;
  const leagueId = `mocklg${mockSeq}`;
  const hostUserId = `mock_host_${mockSeq}`;
  await db.insert(users).values({ id: hostUserId, email: `${hostUserId}@test.local`, displayName: hostUserId }).onConflictDoNothing();
  await db.insert(leagues).values({
    id: leagueId,
    name: `Practice Room ${mockSeq}`,
    format: "snake",
    teamCount: 12,
    isPublicMatchmade: false,
    isMock: true,
    commissionerUserId: hostUserId,
    createdAt: DEFAULT_CREATED_AT,
  });
  await db.insert(mockRooms).values({
    leagueId,
    hostUserId,
    mode: "solo",
    pickSeconds: 60,
    botSeed: mockSeq,
    shareCode: `code_${leagueId}`,
    startsAt: DEFAULT_CREATED_AT,
  });
  await db.insert(drafts).values({
    id: `${leagueId}_draft`,
    leagueId,
    format: "snake",
    status: "complete",
    kickoffAt: DEFAULT_KICKOFF,
  });
  await db.insert(teams).values({ id: `${leagueId}_host_team`, leagueId, userId: hostUserId, name: "Host" });
  return { leagueId, hostUserId };
}

beforeEach(async () => {
  await truncateAll(db);
  leagueSeq = 0;
  reviewSeq = 0;
  mockSeq = 0;
});

afterAll(async () => {
  await truncateAll(db);
});

describe("proofStats — leaguesFilled", () => {
  it("counts a league as filled only once its draft actually ran", async () => {
    // "Leagues filled this season" is a claim about rooms that got to draft, not about rows. A
    // league sitting at capacity with a scheduled draft has not yet done the thing being
    // counted, and counting it would inflate the number by exactly the leagues most likely to
    // still fall over. 30 clears the floor (25) so the assertion also proves the floor did not
    // silently swallow a real number.
    await seedLeagues({ drafted: 30, full: 5, filling: 10 });
    expect((await proofStats(db)).leaguesFilled).toBe(30);
  });

  it("excludes a league created before this season started, even once its draft has run", async () => {
    await seedLeagues({ drafted: 30, full: 0, filling: 0 });
    await seedLeague({
      draftStatus: "complete",
      createdAt: new Date(new Date(LEAGUE_CONFIG.season.startedAt).getTime() - 24 * 60 * 60 * 1000),
    });
    // Still 30, not 31 — the prior-season league drafted too, and does not count anyway.
    expect((await proofStats(db)).leaguesFilled).toBe(30);
  });

  it("hides leaguesFilled below its own floor, rather than printing a small number big", async () => {
    await seedLeagues({ drafted: MATCHMAKING_CONFIG.proof.floors.leaguesFilled - 1, full: 0, filling: 0 });
    expect((await proofStats(db)).leaguesFilled).toBeNull();
  });
});

describe("proofStats — roomsFillingNow (storefront review R1)", () => {
  it("counts only public, still-joinable rooms with at least one seat taken", async () => {
    // Three public, scheduled, genuinely filling rooms — clears the floor (3).
    await seedFillingLeague({ teamCount: 12, filledTeams: 5 });
    await seedFillingLeague({ teamCount: 12, filledTeams: 1 });
    await seedFillingLeague({ teamCount: 8, filledTeams: 7 });
    // A private league's room, filling — excluded by ENFORCED_LEAGUE_SQL so a private league's
    // membership is never disclosed in aggregate.
    await seedFillingLeague({ teamCount: 12, filledTeams: 3, isPublicMatchmade: false });
    // Nobody has joined yet — not "filling", just open.
    await seedFillingLeague({ teamCount: 12, filledTeams: 0 });
    // Already full — a room with nobody left to fill is done filling, not filling.
    await seedFillingLeague({ teamCount: 2, filledTeams: 2 });
    // Already drafting — a visitor cannot join a room that is no longer `'scheduled'`.
    await seedFillingLeague({ teamCount: 12, filledTeams: 5, draftStatus: "in_progress" });

    const stats = await proofStats(db);
    expect(stats.roomsFillingNow).toBe(3);
  });

  it("hides roomsFillingNow below its own floor", async () => {
    await seedFillingLeague({ teamCount: 12, filledTeams: 2 });
    expect(MATCHMAKING_CONFIG.proof.floors.roomsFillingNow).toBe(2);
    expect((await proofStats(db)).roomsFillingNow).toBeNull();
  });

  it("counts a when_full room exactly like a scheduled one — this fact never reads start_trigger", async () => {
    await db.insert(leagues).values({
      id: "wf_fill",
      name: "wf_fill",
      format: "snake",
      teamCount: 12,
      isPublicMatchmade: true,
      commissionerUserId: null,
      houseRung: "open_12",
      createdAt: DEFAULT_CREATED_AT,
    });
    await db.insert(drafts).values({
      id: "wf_fill_draft",
      leagueId: "wf_fill",
      format: "snake",
      status: "scheduled",
      startTrigger: "when_full",
      kickoffAt: new Date(Date.parse(NOW) + 7 * 24 * 60 * 60 * 1000),
    });
    for (let i = 0; i < 3; i += 1) {
      const userId = `wf_fill_u${i}`;
      await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: userId }).onConflictDoNothing();
      await db.insert(teams).values({ id: `wf_fill_t${i}`, leagueId: "wf_fill", userId, name: `wf_fill team ${i}` });
    }
    await seedFillingLeague({ teamCount: 12, filledTeams: 4 });
    await seedFillingLeague({ teamCount: 12, filledTeams: 1 });

    expect((await proofStats(db)).roomsFillingNow).toBe(3);
  });
});

describe("proofStats — rating", () => {
  it("hides a stat that has not earned belief yet, rather than printing a small number big", async () => {
    await seedReviews(MATCHMAKING_CONFIG.proof.floors.reviewCount - 1);
    expect((await proofStats(db)).rating).toBeNull();
  });

  it("reports the review count beside the average, because an average with no n is a slogan", async () => {
    // 51 five-star, 12 four-star: sum 303 / 63 = 4.8095... which rounds to 4.8, the same
    // one-decimal precision a stranger would actually read on the front door.
    const ratings = [...Array<number>(51).fill(5), ...Array<number>(12).fill(4)];
    await seedReviews(63, { ratings });
    expect((await proofStats(db)).rating).toEqual({ average: 4.8, count: 63 });
  });

  it("never lets a removed review nudge the average or the count", async () => {
    const ratings = [...Array<number>(51).fill(5), ...Array<number>(12).fill(4)];
    await seedReviews(63, { ratings });
    // A pile of one-star removed reviews that would drag the average down hard if counted.
    await seedReviews(10, { ratings: Array<number>(10).fill(1), removed: true });
    expect((await proofStats(db)).rating).toEqual({ average: 4.8, count: 63 });
  });
});

describe("proofStats — tightestRoomSeatsRemaining (storefront review R1)", () => {
  it("reports the fewest seats remaining among public, still-joinable, genuinely filling rooms", async () => {
    await seedFillingLeague({ teamCount: 12, filledTeams: 9 }); // 3 remaining
    await seedFillingLeague({ teamCount: 12, filledTeams: 11 }); // 1 remaining — the tightest
    // A private league's tighter room never wins: ENFORCED_LEAGUE_SQL keeps a private
    // membership out of the aggregate, the identical reasoning `roomsFillingNow` documents.
    await seedFillingLeague({ teamCount: 2, filledTeams: 1, isPublicMatchmade: false }); // 1, hidden
    // A room already drafting is not a room anybody can still sit down in.
    await seedFillingLeague({ teamCount: 2, filledTeams: 1, draftStatus: "in_progress" });
    expect((await proofStats(db)).tightestRoomSeatsRemaining).toBe(1);
  });

  it("is null when nothing is filling, and never counts an empty or already-full room", async () => {
    await seedFillingLeague({ teamCount: 12, filledTeams: 0 });
    await seedFillingLeague({ teamCount: 2, filledTeams: 2 });
    expect((await proofStats(db)).tightestRoomSeatsRemaining).toBeNull();
  });

  it("never lets tightestRoomSeatsRemaining alone show the strip: `any` is untouched and ignores it", async () => {
    await seedFillingLeague({ teamCount: 12, filledTeams: 4 });
    const stats = await proofStats(db);
    expect(stats.tightestRoomSeatsRemaining).not.toBeNull();
    // One filling room is below every floor — the chip rides a strip other numbers earned, it
    // never carries the strip itself.
    expect(stats.any).toBe(false);
  });
});

describe("proofStats — the whole strip", () => {
  it("hides the whole strip when every stat is below its floor, and says nothing at all", async () => {
    await truncateAll(db);
    expect(await proofStats(db)).toEqual({
      leaguesFilled: null,
      roomsFillingNow: null,
      rating: null,
      tightestRoomSeatsRemaining: null,
      any: false,
    });
  });

  it("shows the strip once even one stat clears its floor", async () => {
    await seedLeagues({ drafted: MATCHMAKING_CONFIG.proof.floors.leaguesFilled, full: 0, filling: 0 });
    const stats = await proofStats(db);
    expect(stats.any).toBe(true);
    expect(stats.leaguesFilled).not.toBeNull();
    expect(stats.roomsFillingNow).toBeNull();
    expect(stats.rating).toBeNull();
  });

  it("defaults to the real wall clock when no clock is injected", async () => {
    // Not asserting a value — only that the edge default exists and the call does not throw,
    // the same smoke-test shape `listPublicLeagues`'s own `clock = systemClock` default gets.
    await expect(proofStats(db)).resolves.toBeDefined();
  });
});

/**
 * THE EXCLUSION SUITE (Phase 4.5, Task 2). One describe block, named once, that every later task
 * touching a real aggregate extends rather than duplicating: a mock league mirrors a real one in
 * every shape a real one has (`seedCompletedMockRoom` above), and every public aggregate this
 * phase's own architecture call names stays blind to it. Task 4 adds the audit/notice/money
 * trace proof beside this; Task 9 adds the lobby's own "this mock is mine" read, which is the
 * ONE place a mock is allowed to reappear.
 *
 * `leaguesFilledQuery` is asked directly here, not through `proofStats`'s floor-gated field —
 * the floor would hide a count of 1 either way, which proves nothing about the predicate this
 * suite exists to pin. `listWireItems` and `browseQuery` get their own dedicated pins in
 * `wire.test.ts` and `browse.test.ts` (all four wire reads, and the browse shelf); the two
 * assertions here are the brief's own literal shape, kept beside the query they exercise most
 * directly.
 */
describe("the exclusion suite — a mock draft counts nowhere a real aggregate would (Phase 4.5, Task 2)", () => {
  it("never counts a drafted mock in leagues filled this season", async () => {
    await seedLeague({ draftStatus: "complete" });
    await seedCompletedMockRoom();
    const [row] = await leaguesFilledQuery(db);
    expect(row!.count).toBe(1);
  });

  it("keeps every mock off the wire, the browse shelf and the locker room", async () => {
    const { leagueId, hostUserId } = await seedCompletedMockRoom();

    expect(await listWireItems(db, clock)).toHaveLength(0);
    expect(await browseQuery(db, EMPTY_BROWSE_FILTER)).toHaveLength(0);

    const overview = await myLeaguesOverview(db, hostUserId);
    expect(overview.leagueRows.map((row) => row.id)).not.toContain(leagueId);
    expect(overview.leagueRows).toHaveLength(0);
  });

  it("never lets a completed mock season count toward an account's veteran history", async () => {
    // Belt, not braces: a mock never grows a matchup and so can never earn `seasonCompletedAt`
    // (Task 4 skips the season commit for the mock lane), which is what already keeps
    // `completedSeasonsQuery` (gated on that column alone) blind to it with no predicate of its
    // own. This test outlives that reasoning — if a future writer ever DID stamp a mock's season
    // complete, this is the assertion that would catch it.
    const { hostUserId } = await seedCompletedMockRoom();
    expect(await completedSeasonsFor(db, hostUserId)).toBe(0);
  });
});
