import { describe, it, expect, afterEach, beforeEach, afterAll } from "vitest";
import { eq, isNotNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { countingDb, createTestDb, truncateAll } from "@/db/test-db";
import { drafts, leagues, scoringSettings, teams, users } from "@/db/schema";
import { STANDARD_SCORING, type ScoringSettings } from "@/domain/scoring";
import { SUPERFLEX_ROSTER_SLOTS } from "@/league";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { EMPTY_BROWSE_FILTER, hasOpenSeat, matchesBrowseFilter } from "@/matchmaking/filter";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { BrowseFilter, PublicLeagueSummary } from "@/matchmaking/contract";
import type { HouseRungName } from "@/matchmaking/house-catalog";
import { compositionCategoryFor } from "@/participation/composition";
import { listPublicLeagues, publicLeaguePreview, PUBLIC_LEAGUE_FIELDS } from "./browse";
import { joinPublicLeague } from "./join";
import { claimSeatHold } from "./seat-hold";

const db = createTestDb();

/**
 * The convenience wrapper almost every pre-existing test in this file uses: `listPublicLeagues`
 * now answers `BrowseBody` (`leagues` AND `house`, Phase 3.5 addendum, Task 14), and every test
 * below that predates the shelf is asking about the MEMBER list specifically — `seed()`/
 * `seedPublicLeague()` never set `houseRung`, so every league they create lands in `.leagues`
 * anyway. The shelf's own behavior is tested directly, through `listPublicLeagues` itself, in
 * `describe("listPublicLeagues house shelf")` below.
 */
async function browseLeagues(...args: Parameters<typeof listPublicLeagues>): Promise<readonly PublicLeagueSummary[]> {
  return (await listPublicLeagues(...args)).leagues;
}

/** One open, public, joinable HOUSE league — the shelf's own seeder, parallel to `seed()` above
 *  but for a row `leagues_house_commissioner_ck` requires a NULL `commissionerUserId` for. */
async function seedHouseLeague(league: {
  readonly id: string;
  readonly rung: HouseRungName;
  readonly kickoffAt: Date;
  readonly teamCount?: number;
  readonly filled?: number;
  /** Defaults to `'scheduled'` — the two `scheduled` rungs are what every case before the final
   *  review's F2 seeded. A `'when_full'` row is what proves the staleness predicate exempts a
   *  sit-and-go placeholder kickoff. */
  readonly startTrigger?: "scheduled" | "when_full";
  /** Defaults to `true`, which is the only value the real factory ever writes. `false` exists
   *  for exactly one test: the final review's F6, proving the shelf's privacy boundary is
   *  structural rather than conventional. */
  readonly isPublicMatchmade?: boolean;
  /** Defaults to `House ${id}` — set explicitly by D1's own fixture-name tests, which need a
   *  house row whose name actually starts with a real fixture prefix. */
  readonly name?: string;
}): Promise<void> {
  const teamCount = league.teamCount ?? 12;
  const filled = league.filled ?? 0;
  await db.insert(leagues).values({
    id: league.id,
    name: league.name ?? `House ${league.id}`,
    format: "snake",
    teamCount,
    stakeTier: 0,
    experienceTier: "experienced",
    isPublicMatchmade: league.isPublicMatchmade ?? true,
    commissionerUserId: null,
    houseRung: league.rung,
  });
  await db.insert(drafts).values({
    id: `${league.id}_draft`,
    leagueId: league.id,
    format: "snake",
    status: "scheduled",
    kickoffAt: league.kickoffAt,
    startTrigger: league.startTrigger ?? "scheduled",
  });
  await db.insert(scoringSettings).values({ leagueId: league.id, ...STANDARD_SCORING });
  for (let i = 0; i < filled; i++) {
    const userId = `${league.id}_u${i}`;
    await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: `Manager ${i}` }).onConflictDoNothing();
    await db.insert(teams).values({ id: `${league.id}_t${i}`, leagueId: league.id, userId, name: `Team ${i}` });
  }
}

/** Every house league this test database holds, gone — cascades to its draft, teams and scoring
 *  settings (`leagues.id`'s own `onDelete: "cascade"` FKs), leaving every member league untouched. */
async function removeHouseLeagues(db: Db): Promise<void> {
  await db.delete(leagues).where(isNotNull(leagues.houseRung));
}

interface SeedLeague {
  readonly id: string;
  readonly name: string;
  readonly format: "snake" | "auction";
  readonly experienceTier: "beginner" | "experienced";
  readonly stakeTier: number;
  readonly teamCount: number;
  readonly filled: number;
  readonly isPublicMatchmade: boolean;
  readonly draftStatus?: "scheduled" | "in_progress" | "complete";
  /** Defaults to `false` (the schema default) — set explicitly to prove the disclosure. */
  readonly medianGame?: boolean;
  /** Defaults to `${id}_u${index}` per seat. Set explicitly so a caller can give a specific seat
   *  a completed-season history (`giveCompletedSeasons`) before seating them here. */
  readonly seatUserIds?: readonly string[];
  /** Defaults to the row's own `defaultNow()`. Set explicitly to pin ordering in a test. */
  readonly createdAt?: Date;
  /** Defaults to `STANDARD_SCORING` — every real league has a scoring_settings row. */
  readonly scoring?: Omit<ScoringSettings, "leagueId">;
  /** Phase 4.5, Task 2. Defaults to `false` (the schema default) — set explicitly to prove that
   *  a mock league, which always ships `isPublicMatchmade: false` in production
   *  (`createMockRoom`, a later task), is excluded from browse by that SAME predicate rather
   *  than needing a second one here. */
  readonly isMock?: boolean;
}

async function seed(league: SeedLeague): Promise<void> {
  await db.insert(leagues).values({
    id: league.id,
    name: league.name,
    format: league.format,
    teamCount: league.teamCount,
    stakeTier: league.stakeTier,
    experienceTier: league.experienceTier,
    isPublicMatchmade: league.isPublicMatchmade,
    isMock: league.isMock ?? false,
    commissionerUserId: "owner",
    ...(league.createdAt === undefined ? {} : { createdAt: league.createdAt }),
    ...(league.medianGame === undefined ? {} : { medianGame: league.medianGame }),
  });
  await db.insert(drafts).values({
    id: `${league.id}_draft`,
    leagueId: league.id,
    format: league.format,
    status: league.draftStatus ?? "scheduled",
    kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
    auctionBudget: league.format === "auction" ? 200 : null,
  });
  await db.insert(scoringSettings).values({ leagueId: league.id, ...(league.scoring ?? STANDARD_SCORING) });
  for (let i = 0; i < league.filled; i++) {
    const userId = league.seatUserIds?.[i] ?? `${league.id}_u${i}`;
    // `onConflictDoNothing`: a caller may have already given this exact user id a completed-
    // season history (`giveCompletedSeasons`, below) before seating them here.
    await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: `Manager ${i}` }).onConflictDoNothing();
    await db.insert(teams).values({ id: `${league.id}_t${i}`, leagueId: league.id, userId, name: `Team ${i}` });
  }
}

/**
 * Gives `userId` `count` OTHER completed leagues — a one-team league apiece, matching
 * `participation.test.ts`'s own `seatIn` shape — so their seat in whatever league the caller
 * seeds them into next reads as a veteran's, per `INTEGRITY_CONFIG.participation
 * .veteranSeasonCutoff`. Called BEFORE `seed()`/`seedPublicLeague()` seats the same id, so the
 * user row already exists when those insert the league that references it.
 */
async function giveCompletedSeasons(userId: string, count: number): Promise<void> {
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: userId }).onConflictDoNothing();
  for (let i = 0; i < count; i++) {
    const leagueId = `${userId}_history_${i}`;
    await db.insert(leagues).values({
      id: leagueId,
      name: leagueId,
      format: "snake",
      teamCount: 1,
      commissionerUserId: userId,
      seasonCompletedAt: new Date("2025-01-01T00:00:00.000Z"),
    });
    await db.insert(teams).values({ id: `${leagueId}_team`, leagueId, userId, name: "Team" });
  }
}

let seedCounter = 0;

/**
 * The brief's convenience seeder: one open, public, joinable league from a filter-shaped
 * overrides object, returning the `PublicLeagueSummary` the pure rule (`matchesBrowseFilter`,
 * `hasOpenSeat`) can be run against directly. Built on `seed()` above rather than duplicating
 * its insert logic — this only adds id/name generation and the shape translation
 * (`filledTeams` -> `filled`) `seed()` doesn't do itself.
 *
 * `veteranSeats` (default 0, so every prior caller's composition is unchanged): the FIRST this
 * many of `filledTeams` seats belong to a manager `giveCompletedSeasons` has already given a real
 * completed-season history — fix round F3, so the SQL-vs-pure-rule matrix below has a real
 * newcomer/veteran mix to exercise `participationTier` narrowing against, not only the all-
 * newcomer corpus every prior test here built.
 */
async function seedPublicLeague(
  db: Db,
  overrides: {
    readonly format: "snake" | "auction";
    readonly experienceTier: "beginner" | "experienced";
    readonly stakeTier: number;
    readonly teamCount: number;
    readonly filledTeams: number;
    readonly veteranSeats?: number;
  },
): Promise<PublicLeagueSummary> {
  seedCounter += 1;
  const id = `seed_${seedCounter}`;
  const name = `Seeded League ${seedCounter}`;
  const veteranSeats = overrides.veteranSeats ?? 0;
  const seatUserIds = Array.from({ length: overrides.filledTeams }, (_, index) =>
    index < veteranSeats ? `${id}_veteran_${index}` : `${id}_u${index}`,
  );
  for (let i = 0; i < veteranSeats; i++) {
    await giveCompletedSeasons(`${id}_veteran_${i}`, INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
  }
  await seed({
    id,
    name,
    format: overrides.format,
    experienceTier: overrides.experienceTier,
    stakeTier: overrides.stakeTier,
    teamCount: overrides.teamCount,
    filled: overrides.filledTeams,
    isPublicMatchmade: true,
    seatUserIds,
  });
  return {
    id,
    name,
    format: overrides.format,
    experienceTier: overrides.experienceTier,
    stakeTier: overrides.stakeTier,
    entryFeeCents: 0,
    teamCount: overrides.teamCount,
    filledTeams: overrides.filledTeams,
    scoringLabel: "Standard",
    // `seed()` never gives a manager a completed league of their own UNLESS `veteranSeats` asked
    // for one — matching `listPublicLeagues`'s own answer for the same corpus. Reduced to the
    // COARSE bucket here (final review F6) by the same function production reduces with, so the
    // fixture and the wire cannot disagree about where a corpus lands.
    compositionCategory: compositionCategoryFor({ newcomers: overrides.filledTeams - veteranSeats, veterans: veteranSeats }),
    // `seed()` always schedules the draft for the same fixed instant — no caller of this
    // fixture compares `draftAt` (they compare against `matchesBrowseFilter`/`.id`, neither of
    // which reads it), so this only needs to satisfy `PublicLeagueSummary`'s shape.
    draftAt: "Thursday 10 September, 5:00 PM UTC",
    // `seed()` above never sets `medianGame` — the schema default, `false`, always applies here.
    medianGame: false,
    // `seed()` above never sets a start trigger — the schema default, `'scheduled'`, always
    // applies here.
    startTrigger: "scheduled",
    // `seed()` above never sets `houseRung` — every league this fixture builds is a member
    // league, so it always lands in `.leagues`, never `.house`.
    houseRung: null,
    // `seed()` above never claims a seat hold — no caller of this fixture is testing Task 6's
    // own mechanism, so every league it builds reads `0` held seats.
    heldSeats: 0,
    // `seed()` above never overrides `roster_slots` — the schema default (`STANDARD_ROSTER_SLOTS`)
    // always applies here, and every league on this platform shares the same playoff weeks
    // (Phase 3.6, Task 5: neither is a per-league override this codebase writes).
    rosterSummary: "15 slots, 1 flex",
    playoffWeeks: [15, 16, 17],
    // `seed()` above never rolls a kickoff — no caller of this fixture is testing Task 7's roll,
    // so every league it builds reads `0` rolls, the schema default.
    kickoffRolls: 0,
  };
}

beforeEach(async () => {
  await truncateAll(db);
  await db.insert(users).values({ id: "owner", email: "owner@test.local", displayName: "Commissioner Casey" });
});

afterAll(async () => {
  await truncateAll(db);
});

describe("listPublicLeagues", () => {
  it("answers open, publicly listed leagues with their fill count", async () => {
    await seed({
      id: "open", name: "Rookie Snake Room", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 8, isPublicMatchmade: true,
    });
    // `seed()` schedules the draft for "2026-09-10T17:00:00.000Z" (below) — pin `now` so
    // `draftAt`'s relative half is deterministic rather than measured against the real clock.
    const rows = await browseLeagues(db, EMPTY_BROWSE_FILTER, { now: () => "2026-08-17T12:00:00.000Z" });
    expect(rows).toEqual([
      {
        id: "open", name: "Rookie Snake Room", format: "snake", experienceTier: "beginner", stakeTier: 0,
        entryFeeCents: 0,
        teamCount: 12, filledTeams: 8, scoringLabel: "Standard", compositionCategory: "all_newcomers",
        draftAt: "Thursday 10 September, 5:00 PM UTC (in 24 days)", draftAtIso: "2026-09-10T17:00:00.000Z",
        medianGame: false, startTrigger: "scheduled",
        houseRung: null, heldSeats: 0, rosterSummary: "15 slots, 1 flex", playoffWeeks: [15, 16, 17],
        kickoffRolls: 0,
        // Front door blueprint (2026-09-02), the eighteenth field: `null` stated, never absent —
        // a free league publishes no prize table, and the wire says so explicitly.
        payoutTable: null,
      },
    ]);
  });

  // Task 3 (Phase 3.5): the eleventh field, the same disclosure decision `draftAt` and
  // `scoringLabel` already are — a stranger who can't see it can't tell what game they'd join.
  it("discloses whether the league plays a median game, honestly per league", async () => {
    await seed({
      id: "standard", name: "Standard Room", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
    });
    await seed({
      id: "median", name: "Median Room", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true, medianGame: true,
    });
    const rows = await browseLeagues(db, EMPTY_BROWSE_FILTER);
    const byId = new Map(rows.map((row) => [row.id, row.medianGame]));
    expect(byId.get("standard")).toBe(false);
    expect(byId.get("median")).toBe(true);
  });

  // Front door blueprint (2026-09-02): the eighteenth field — the STORED table, straight through.
  it("discloses a stored payout table straight through, and null for a league without one", async () => {
    await seed({
      id: "paid_shape", name: "Paid Shape Room", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
    });
    const table = [
      { place: 1, amountCents: 30000 },
      { place: 2, amountCents: 20000 },
      { place: 3, amountCents: 10000 },
    ];
    await db.update(leagues).set({ payoutTable: table }).where(eq(leagues.id, "paid_shape"));
    const rows = await browseLeagues(db, EMPTY_BROWSE_FILTER);
    expect(rows.find((row) => row.id === "paid_shape")?.payoutTable).toEqual(table);
  });

  // Phase 3.5, Task 8, Step 3: the twelfth field.
  it("discloses the start trigger, honestly per league", async () => {
    await seed({
      id: "scheduled_one", name: "Scheduled Room", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
    });
    await db.insert(leagues).values({
      id: "when_full_one", name: "Sit-and-Go Room", format: "snake", teamCount: 12, stakeTier: 0,
      experienceTier: "beginner", isPublicMatchmade: true, commissionerUserId: "owner",
    });
    await db.insert(drafts).values({
      id: "when_full_one_draft", leagueId: "when_full_one", format: "snake", status: "scheduled",
      kickoffAt: new Date("2026-09-10T17:00:00.000Z"), startTrigger: "when_full",
    });
    await db.insert(scoringSettings).values({ leagueId: "when_full_one", ...STANDARD_SCORING });

    const rows = await browseLeagues(db, EMPTY_BROWSE_FILTER);
    const byId = new Map(rows.map((row) => [row.id, row.startTrigger]));
    expect(byId.get("scheduled_one")).toBe("scheduled");
    expect(byId.get("when_full_one")).toBe("when_full");
  });

  it("discloses nothing beyond the named public fields", async () => {
    await seed({
      id: "open", name: "Rookie Snake Room", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
    });
    const [row] = await browseLeagues(db, EMPTY_BROWSE_FILTER);
    expect(Object.keys(row!).sort()).toEqual([...PUBLIC_LEAGUE_FIELDS].sort());
    // The facts a stranger must never learn from an unauthenticated read.
    expect(JSON.stringify(row)).not.toContain("owner");
    expect(JSON.stringify(row)).not.toContain("Commissioner Casey");
    expect(JSON.stringify(row)).not.toContain("open_draft");
  });

  it("derives the scoring label from the league's own weights, never a stored preset name", async () => {
    // `scoring_settings` never stores a preset name — this is the deliberate disclosure
    // (PublicLeagueSummary's docblock): a DERIVED label, never the fifteen raw weights.
    await seed({
      id: "ppr", name: "PPR Room", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
      scoring: { ...STANDARD_SCORING, pointsPerReception: 1 },
    });
    await seed({
      id: "custom", name: "House Rules", format: "snake", experienceTier: "experienced",
      stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
      scoring: { ...STANDARD_SCORING, pointsPerPassingTouchdown: 6 },
    });
    const rows = await browseLeagues(db, EMPTY_BROWSE_FILTER);
    const byId = new Map(rows.map((row) => [row.id, row.scoringLabel]));
    expect(byId.get("ppr")).toBe("PPR");
    expect(byId.get("custom")).toBe("Custom");
    // Never the raw weights, never a stored preset column — only the derived label.
    expect(JSON.stringify(rows)).not.toContain("pointsPerReception");
    expect(JSON.stringify(rows)).not.toContain("pointsPerPassingTouchdown");
  });

  it("labels a league honestly even if a scoring_settings row were somehow missing", async () => {
    // Never true in production (createLeague writes both rows in one transaction), but
    // listPublicLeagues must not throw, and must not silently mislabel, on a join miss.
    await seed({
      id: "no_scoring", name: "Edge Case Room", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
    });
    await db.delete(scoringSettings).where(eq(scoringSettings.leagueId, "no_scoring"));
    const rows = await browseLeagues(db, EMPTY_BROWSE_FILTER);
    expect(rows[0]?.scoringLabel).toBe("Custom");
  });

  it("never lists a private league, whatever it is filtered by", async () => {
    await seed({
      id: "private", name: "Group Chat Only", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 2, isPublicMatchmade: false,
    });
    expect(await browseLeagues(db, EMPTY_BROWSE_FILTER)).toEqual([]);
    expect(await browseLeagues(db, { ...EMPTY_BROWSE_FILTER, format: "snake" })).toEqual([]);
  });

  /**
   * Phase 4.5, Task 2 — the architecture call's own claim, pinned rather than trusted: a mock
   * league always ships `isPublicMatchmade: false`, so `browseQuery`'s existing
   * `eq(leagues.isPublicMatchmade, true)` predicate already excludes it BY CONSTRUCTION, with no
   * second `is_mock` check needed here. Seeded with `isMock: true` explicitly (not merely another
   * `isPublicMatchmade: false` row) so this reads as a claim about mocks specifically, not a
   * restatement of the private-league test above.
   */
  it("never lists a mock draft, on the shelf or in the member list", async () => {
    await seed({
      id: "mock_room", name: "Practice Room", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 2, isPublicMatchmade: false, isMock: true,
    });
    expect(await browseLeagues(db, EMPTY_BROWSE_FILTER)).toEqual([]);
  });

  it("never lists a full league", async () => {
    await seed({
      id: "full", name: "Packed House", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 4, filled: 4, isPublicMatchmade: true,
    });
    expect(await browseLeagues(db, EMPTY_BROWSE_FILTER)).toEqual([]);
  });

  it("never lists a league whose draft has already started or finished", async () => {
    await seed({
      id: "live", name: "Already Drafting", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 3, isPublicMatchmade: true, draftStatus: "in_progress",
    });
    await seed({
      id: "done", name: "Already Played", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 3, isPublicMatchmade: true, draftStatus: "complete",
    });
    expect(await browseLeagues(db, EMPTY_BROWSE_FILTER)).toEqual([]);
  });

  it("narrows by format, experience tier and stake tier", async () => {
    await seed({
      id: "a", name: "Rookie Snake Room", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
    });
    await seed({
      id: "b", name: "Sharks Auction", format: "auction", experienceTier: "experienced",
      stakeTier: 3, teamCount: 12, filled: 1, isPublicMatchmade: true,
    });

    expect((await browseLeagues(db, { ...EMPTY_BROWSE_FILTER, format: "auction" })).map((l) => l.id)).toEqual(["b"]);
    expect((await browseLeagues(db, { ...EMPTY_BROWSE_FILTER, experienceTier: "beginner" })).map((l) => l.id)).toEqual(["a"]);
    expect((await browseLeagues(db, { ...EMPTY_BROWSE_FILTER, stakeTier: 3 })).map((l) => l.id)).toEqual(["b"]);
    expect(
      await browseLeagues(db, { format: "snake", experienceTier: "experienced", stakeTier: 3, participationTier: "any" }),
    ).toEqual([]);
  });

  // PHASE 3.5, TASK 8, STEP 4. `browseQuery` used to order by `created_at` alone; it now orders
  // by seats-remaining ASC first, `created_at` ASC as the tiebreaker (§4.1's liquidity doctrine —
  // the lobby's job is to FILL leagues, and a nearly-full one is worth surfacing ahead of a
  // freshly created one nobody has joined yet).
  it("returns matching leagues by seats remaining first — the nearly-full league surfaces ahead of the freshly created one", async () => {
    // Mutation check: flipping `browse.ts`'s seats-remaining expression back to a bare
    // `asc(leagues.createdAt)` puts "newest" (created last, but with the FEWEST seats left)
    // first instead of last, reddening this exact assertion.
    await seed({
      id: "newest", name: "Newest League", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 11, isPublicMatchmade: true,
      createdAt: new Date("2026-09-03T00:00:00.000Z"),
    });
    await seed({
      id: "oldest", name: "Oldest League", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    await seed({
      id: "middle", name: "Middle League", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 6, isPublicMatchmade: true,
      createdAt: new Date("2026-09-02T00:00:00.000Z"),
    });
    const rows = await browseLeagues(db, EMPTY_BROWSE_FILTER);
    // "newest" has 1 seat left, "middle" has 6, "oldest" has 11 — seats-remaining ASC puts the
    // nearly-full league first, the opposite of creation order.
    expect(rows.map((league) => league.id)).toEqual(["newest", "middle", "oldest"]);
  });

  it("falls back to created_at ASC as the tiebreaker when leagues have the same seats remaining", async () => {
    await seed({
      id: "newest", name: "Newest League", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
      createdAt: new Date("2026-09-03T00:00:00.000Z"),
    });
    await seed({
      id: "oldest", name: "Oldest League", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    await seed({
      id: "middle", name: "Middle League", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
      createdAt: new Date("2026-09-02T00:00:00.000Z"),
    });
    const rows = await browseLeagues(db, EMPTY_BROWSE_FILTER);
    expect(rows.map((league) => league.id)).toEqual(["oldest", "middle", "newest"]);
  });

  it("caps how many leagues one browse can answer with", async () => {
    for (let i = 0; i < MATCHMAKING_CONFIG.maxResults + 3; i++) {
      await seed({
        id: `l${i}`, name: `Open League ${i}`, format: "snake", experienceTier: "beginner",
        stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
      });
    }
    expect(await browseLeagues(db, EMPTY_BROWSE_FILTER)).toHaveLength(MATCHMAKING_CONFIG.maxResults);
  });

});

/**
 * Phase 3.6, Task 6, Step 5: `heldSeats` is a live count off `seat_holds`, read at the SAME
 * instant `draftAt` is composed from — never a stale or a fresh-`now()` mismatch between the two.
 */
describe("listPublicLeagues held seats (Task 6)", () => {
  it("reports a live hold and stops counting one the moment it expires, with no sweeper", async () => {
    await seed({
      id: "held_live", name: "Held Live", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 9, isPublicMatchmade: true,
    });
    await claimSeatHold(db, { leagueId: "held_live", token: "hold_browse_a", now: "2026-08-17T12:00:00.000Z" });

    const live = await browseLeagues(db, EMPTY_BROWSE_FILTER, { now: () => "2026-08-17T12:00:00.000Z" });
    expect(live[0]).toMatchObject({ heldSeats: 1 });

    const afterExpiry = await browseLeagues(db, EMPTY_BROWSE_FILTER, { now: () => "2026-08-17T12:15:00.000Z" });
    expect(afterExpiry[0]).toMatchObject({ heldSeats: 0 });
  });

  it("never counts a consumed hold, even while it is still inside its own ten minutes", async () => {
    await seed({
      id: "held_consumed", name: "Held Consumed", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 0, isPublicMatchmade: true,
    });
    await claimSeatHold(db, { leagueId: "held_consumed", token: "hold_browse_b", now: "2026-08-17T12:00:00.000Z" });
    await joinPublicLeague(
      { db, newId: () => "team_browse_b", clock: { now: () => "2026-08-17T12:00:00.000Z" } },
      { leagueId: "held_consumed", userId: "owner", holdToken: "hold_browse_b" },
    );

    const rows = await browseLeagues(db, EMPTY_BROWSE_FILTER, { now: () => "2026-08-17T12:00:00.000Z" });
    const summary = rows.find((league) => league.id === "held_consumed");
    expect(summary).toMatchObject({ filledTeams: 1, heldSeats: 0 });
  });

  it("reports zero for a league nobody is claiming, never `undefined`", async () => {
    await seed({
      id: "held_none", name: "Held None", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
    });
    const [summary] = await browseLeagues(db, EMPTY_BROWSE_FILTER);
    expect(summary!.heldSeats).toBe(0);
  });
});

describe("listPublicLeagues tier composition", () => {
  it("carries the composition as ONE coarse bucket and nothing that names a person", async () => {
    await seed({
      id: "comp_all_newcomer", name: "Rookie Room", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 6, isPublicMatchmade: true,
    });
    const [summary] = await browseLeagues(db, EMPTY_BROWSE_FILTER);
    expect(summary!.compositionCategory).toBe("all_newcomers");
    expect(Object.keys(summary!).sort()).toEqual([...PUBLIC_LEAGUE_FIELDS].sort());
    expect(JSON.stringify(summary)).not.toContain("comp_all_newcomer_u0");
  });

  /**
   * FINAL REVIEW F6, at the wire. The counts used to ship and the client reduced them, which made
   * the coarse-label discipline a rendering convention rather than a boundary: an aggregate over
   * N=1 is not an aggregate, so a one-seat public league published that one manager's computed
   * participation tier to anybody holding the URL, and polling across joins published each new
   * member's tier as a delta.
   *
   * Asserted over the SERIALIZED body rather than the object's keys, because that is what actually
   * crosses the wire, and at `filledTeams: 1` — the worst case, not a comfortable one.
   */
  it("never serializes the raw counts, at the one filled seat where an aggregate is not an aggregate", async () => {
    await giveCompletedSeasons("solo_veteran", INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
    await seed({
      id: "solo", name: "One Seat Taken", format: "snake", experienceTier: "experienced",
      stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true, seatUserIds: ["solo_veteran"],
    });

    const [summary] = await browseLeagues(db, EMPTY_BROWSE_FILTER);
    const body = JSON.stringify(summary);

    expect(summary!.filledTeams).toBe(1);
    expect(body).not.toContain("newcomers");
    expect(body).not.toContain("veterans");
    expect(body).not.toContain("tierComposition");
    // The bucket still answers honestly: one veteran and no newcomers is not a newcomer lean.
    expect(summary!.compositionCategory).toBe("open");
    // And the allowlist itself no longer names the pair, so a spread cannot reintroduce it.
    expect(PUBLIC_LEAGUE_FIELDS).not.toContain("tierComposition" as never);
  });

  it("counts a seat as a veteran once that seat-holder's OWN completed-season history crosses the cutoff", async () => {
    await giveCompletedSeasons("mix_veteran", INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
    await seed({
      id: "mix", name: "Mixed League", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 2, isPublicMatchmade: true,
      seatUserIds: ["mix_veteran", "mix_newcomer"],
    });
    const [summary] = await browseLeagues(db, EMPTY_BROWSE_FILTER);
    // One each: `compositionCategoryFor`'s own `>` rather than `>=` puts an even split in `open`.
    expect(summary!.compositionCategory).toBe("open");
  });

  it("counts an empty seat as neither a newcomer nor a veteran", async () => {
    await seed({
      id: "empty_seats", name: "Just Opened", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 0, isPublicMatchmade: true,
    });
    const [summary] = await browseLeagues(db, EMPTY_BROWSE_FILTER);
    // An empty roster has signalled nothing, so it reads `open` rather than `all_newcomers`.
    expect(summary!.compositionCategory).toBe("open");
  });

  it("costs exactly four queries, whether or not any seat-holder has a completed-season history", async () => {
    // `listPublicLeagues` is `browseQuery` + `houseShelfQuery` + `scoringWeightsByLeagueId` +
    // `heldSeatsByLeagueId` (Phase 3.5 addendum, Task 14; Phase 3.6, Task 6) — the composition
    // join is FOLDED into each of the first two queries itself (measured in
    // `src/db/index-plans.test.ts`), never a fifth round trip, so this stays four queries
    // regardless of how many leagues, seats or house rungs it answers for. WAS three queries,
    // before Task 6 gave the held-seats count its own batched lookup.
    await giveCompletedSeasons("counting_veteran", INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
    await seed({
      id: "counting", name: "Counting League", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 2, isPublicMatchmade: true,
      seatUserIds: ["counting_veteran", "counting_newcomer"],
    });
    const counting = countingDb(db);
    await listPublicLeagues(counting.db, EMPTY_BROWSE_FILTER);
    expect(counting.selectCount()).toBe(4);
  });
});

describe("listPublicLeagues narrows on participation tier", () => {
  it("returns only leagues that lean newcomer when the filter asks for newcomers", async () => {
    await giveCompletedSeasons("pt_veteran", INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
    await seed({
      id: "pt_newcomer_league", name: "Newcomer Room", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 3, isPublicMatchmade: true,
    });
    await seed({
      id: "pt_veteran_league", name: "Veteran Room", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
      seatUserIds: ["pt_veteran"],
    });
    const rows = await browseLeagues(db, { ...EMPTY_BROWSE_FILTER, participationTier: "newcomer" });
    expect(rows.map((l) => l.id)).toEqual(["pt_newcomer_league"]);
  });

  it("returns only leagues that do not lean newcomer when the filter asks for veterans, including a tie", async () => {
    await giveCompletedSeasons("pt2_veteran", INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
    await seed({
      id: "pt2_newcomer_league", name: "Newcomer Room", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 3, isPublicMatchmade: true,
    });
    await seed({
      id: "pt2_veteran_league", name: "Veteran Room", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
      seatUserIds: ["pt2_veteran"],
    });
    const rows = await browseLeagues(db, { ...EMPTY_BROWSE_FILTER, participationTier: "veteran" });
    expect(rows.map((l) => l.id)).toEqual(["pt2_veteran_league"]);
  });

  it("agrees with the pure rule (matchesBrowseFilter) over the same corpus", async () => {
    await giveCompletedSeasons("pt3_veteran", INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
    await seed({
      id: "pt3_a", name: "A", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 3, isPublicMatchmade: true,
    });
    await seed({
      id: "pt3_b", name: "B", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
      seatUserIds: ["pt3_veteran"],
    });
    for (const participationTier of ["any", "newcomer", "veteran"] as const) {
      const filter = { ...EMPTY_BROWSE_FILTER, participationTier };
      const fromSql = (await browseLeagues(db, filter)).map((l) => l.id).sort();
      const fromRule = (await browseLeagues(db, EMPTY_BROWSE_FILTER))
        .filter((league) => matchesBrowseFilter(league, filter))
        .map((l) => l.id)
        .sort();
      expect(fromSql).toEqual(fromRule);
    }
  });

  it("narrows on participation tier BEFORE the cap, so a participation-narrowed browse never under-fills a page more matches exist for", async () => {
    for (let i = 0; i < MATCHMAKING_CONFIG.maxResults + 10; i += 1) {
      await seed({
        id: `pt_wide_${i}`, name: `Room ${i}`, format: "snake", experienceTier: "beginner",
        stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
      });
    }
    await giveCompletedSeasons("pt_wide_veteran", INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
    for (let i = 0; i < 5; i += 1) {
      await seed({
        id: `pt_wide_veteran_${i}`, name: `Veteran Room ${i}`, format: "snake", experienceTier: "beginner",
        stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
        seatUserIds: ["pt_wide_veteran"],
      });
    }
    const veteranOnly = await browseLeagues(db, { ...EMPTY_BROWSE_FILTER, participationTier: "veteran" });
    expect(veteranOnly).toHaveLength(5);
  });
});

describe("listPublicLeagues narrows in SQL", () => {
  /**
   * The anti-drift device. `matchesBrowseFilter`/`hasOpenSeat` are the product's ONE filter
   * rule and are gated at 100% coverage; the SQL is a second expression of the same rule, and
   * two expressions of one rule is exactly how a privacy/behavior drift starts. So rather than
   * asserting hand-picked cases, this runs EVERY filter combination over one corpus and demands
   * the database and the pure rule return the same league ids, in the same order.
   */
  it("agrees with the pure filter for every filter combination", async () => {
    const corpus: PublicLeagueSummary[] = [];
    for (const format of MATCHMAKING_CONFIG.formats) {
      for (const experienceTier of MATCHMAKING_CONFIG.experienceTiers) {
        for (const { tier } of MATCHMAKING_CONFIG.stakeTiers) {
          for (const filledTeams of [0, 6, 12]) {
            const league = await seedPublicLeague(db, { format, experienceTier, stakeTier: tier, teamCount: 12, filledTeams });
            corpus.push(league);
          }
        }
      }
    }

    // Fix round F3: `participationTier` IS a fourth axis below, and this small slice is what
    // gives it something real to exercise — the loop above never varies composition, so every
    // one of its leagues reads `all_newcomers` and a `veteran` filter would answer empty
    // regardless of whether the predicate were even wired up. `matchesBrowseFilter`'s own
    // reviewer note stands: the predicate sets are structurally independent (a raw `leagues`
    // column vs. an aggregate over `teams`), so this is cheap insurance against that changing,
    // not a claim that the two axes interact today.
    for (const veteranSeats of [0, 1, 6]) {
      for (const format of MATCHMAKING_CONFIG.formats) {
        const league = await seedPublicLeague(db, {
          format,
          experienceTier: "beginner",
          stakeTier: 0,
          teamCount: 12,
          filledTeams: 6,
          veteranSeats,
        });
        corpus.push(league);
      }
    }

    const combinations: BrowseFilter[] = [];
    for (const format of [...MATCHMAKING_CONFIG.formats, "any" as const]) {
      for (const experienceTier of [...MATCHMAKING_CONFIG.experienceTiers, "any" as const]) {
        for (const stakeTier of [...MATCHMAKING_CONFIG.stakeTiers.map((entry) => entry.tier), "any" as const]) {
          for (const participationTier of [...MATCHMAKING_CONFIG.participationTiers, "any" as const]) {
            combinations.push({ format, experienceTier, stakeTier, participationTier });
          }
        }
      }
    }
    expect(combinations).toHaveLength(3 * 3 * 5 * 3);

    for (const filter of combinations) {
      const fromSql = await browseLeagues(db, filter);
      const fromRule = corpus.filter((league) => hasOpenSeat(league) && matchesBrowseFilter(league, filter));
      expect(fromSql.map((league) => league.id).sort()).toEqual(fromRule.map((league) => league.id).sort());
    }
  });

  it("returns every match even when far more than maxResults public leagues exist", async () => {
    // The bug this task closes: the LIMIT used to be applied BEFORE the format/tier/open-seat
    // filters ran in JS, so a narrow filter over a large public pool returned an under-filled
    // page (often zero) while the database held plenty of matches.
    for (let i = 0; i < MATCHMAKING_CONFIG.maxResults + 10; i += 1) {
      await seedPublicLeague(db, { format: "snake", experienceTier: "beginner", stakeTier: 0, teamCount: 12, filledTeams: 0 });
    }
    for (let i = 0; i < 5; i += 1) {
      await seedPublicLeague(db, { format: "auction", experienceTier: "experienced", stakeTier: 3, teamCount: 12, filledTeams: 0 });
    }

    const narrow = await browseLeagues(db, {
      format: "auction",
      experienceTier: "experienced",
      stakeTier: 3,
      participationTier: "any",
    });
    expect(narrow).toHaveLength(5);
  });

  it("still caps an unnarrowed browse at maxResults", async () => {
    for (let i = 0; i < MATCHMAKING_CONFIG.maxResults + 10; i += 1) {
      await seedPublicLeague(db, { format: "snake", experienceTier: "beginner", stakeTier: 0, teamCount: 12, filledTeams: 0 });
    }
    const all = await browseLeagues(db, EMPTY_BROWSE_FILTER);
    expect(all).toHaveLength(MATCHMAKING_CONFIG.maxResults);
  });

  it("counts fill with a grouped count, so a full league is excluded by the database", async () => {
    await seedPublicLeague(db, { format: "snake", experienceTier: "beginner", stakeTier: 0, teamCount: 4, filledTeams: 4 });
    const open = await seedPublicLeague(db, { format: "snake", experienceTier: "beginner", stakeTier: 0, teamCount: 4, filledTeams: 3 });
    const rows = await browseLeagues(db, EMPTY_BROWSE_FILTER);
    expect(rows.map((league) => league.id)).toEqual([open.id]);
    expect(rows[0]?.filledTeams).toBe(3);
  });
});

/**
 * PHASE 3.5 ADDENDUM, TASK 14, STEP 1. The failing shelf tests, verbatim per the brief — the
 * front door: browse leads with the house shelf, as a SECOND list (`BrowseBody.house`) rather
 * than a `houseRung` sort key on the member list.
 */
describe("listPublicLeagues house shelf", () => {
  it("puts the house shelf and the member leagues in separate lists", async () => {
    await seed({
      id: "member", name: "A Member League", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
    });
    await seedHouseLeague({ id: "house_open_12_1", rung: "open_12", kickoffAt: new Date("2026-09-10T19:00:00.000Z") });
    const body = await listPublicLeagues(db, EMPTY_BROWSE_FILTER);
    expect(body.house.every((l) => l.houseRung !== null)).toBe(true);
    expect(body.leagues.every((l) => l.houseRung === null)).toBe(true);
  });

  it("orders the shelf by the draft a visitor can attend soonest", async () => {
    // Seeded out of both creation order AND rung order, and 7 days apart so every kickoff falls
    // on the SAME weekday (`formatDraftTime`'s absolute half leads with the weekday name) — the
    // one shape that lets a lexical sort of the rendered `draftAt` strings agree with the actual
    // chronological order, which is what this assertion (verbatim per the brief) compares.
    await seedHouseLeague({ id: "house_c", rung: "beginner_12", kickoffAt: new Date("2026-09-24T19:00:00.000Z") });
    await seedHouseLeague({ id: "house_a", rung: "open_12", kickoffAt: new Date("2026-09-10T19:00:00.000Z") });
    await seedHouseLeague({ id: "house_b", rung: "open_12", kickoffAt: new Date("2026-09-17T19:00:00.000Z") });
    const { house } = await listPublicLeagues(db, EMPTY_BROWSE_FILTER, { now: () => "2026-08-17T12:00:00.000Z" });
    expect(house.map((l) => l.draftAt)).toEqual([...house.map((l) => l.draftAt)].sort());
    // The stronger, non-lexical proof behind the brief's own assertion: the actual id order.
    expect(house.map((l) => l.id)).toEqual(["house_a", "house_b", "house_c"]);
  });

  it("still shows the member leagues when the shelf is empty, rather than an apology", async () => {
    // Never a dead end, in the form this addendum makes possible: the reconciler has not run yet.
    await seed({
      id: "member", name: "A Member League", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
    });
    await removeHouseLeagues(db);
    const body = await listPublicLeagues(db, EMPTY_BROWSE_FILTER);
    expect(body.house).toEqual([]);
    expect(body.leagues.length).toBeGreaterThan(0);
  });

  it("refuses to let a filter hide the shelf", () => {
    // Parent ruling 1: every filter axis is a way for an open seat to become invisible to
    // somebody who would have taken it. `houseRung` is a field on a card and is NOT a
    // `BrowseFilter` member, and this is the test that keeps it that way.
    expect(Object.keys(EMPTY_BROWSE_FILTER)).not.toContain("houseRung");
  });

  it("declares the new field on the wire, or fails", () => {
    // `PUBLIC_LEAGUE_FIELDS` plus this assertion are why adding a field to a public,
    // unauthenticated read is a deliberate disclosure decision rather than a diff nobody
    // reviewed.
    expect(PUBLIC_LEAGUE_FIELDS).toContain("houseRung");
  });

  it("carries the real catalog rung name on a house card, honestly per rung", async () => {
    await seedHouseLeague({ id: "house_open", rung: "open_12", kickoffAt: new Date("2026-09-10T19:00:00.000Z") });
    await seedHouseLeague({ id: "house_beg", rung: "beginner_12", kickoffAt: new Date("2026-09-11T19:00:00.000Z") });
    const { house } = await listPublicLeagues(db, EMPTY_BROWSE_FILTER);
    const byId = new Map(house.map((l) => [l.id, l.houseRung]));
    expect(byId.get("house_open")).toBe("open_12");
    expect(byId.get("house_beg")).toBe("beginner_12");
  });

  it("never lets a full house league sit on the shelf", async () => {
    await seedHouseLeague({
      id: "house_full", rung: "open_12", kickoffAt: new Date("2026-09-10T19:00:00.000Z"),
      teamCount: 2, filled: 2,
    });
    const { house } = await listPublicLeagues(db, EMPTY_BROWSE_FILTER);
    expect(house).toEqual([]);
  });

  /**
   * FINAL WHOLE-BRANCH REVIEW, F2. An under-filled `scheduled`-trigger house league whose kickoff
   * has passed used to render FIRST on the public shelf, forever: the shelf orders by
   * `kickoff_at` ASC, so the most-past time sorts to the top and reads "starting now". Nothing
   * could ever start it (`reduceStart` refuses a draft with fewer than two teams, so its status
   * never leaves `'scheduled'`) and nothing could repair it (a house league's kickoff refuses
   * edits by design). The same predicate that stops it counting toward the reconciler's shelf
   * width stops it rendering — one expression, `houseKickoffStillAhead`, shared by both queries.
   */
  const AFTER_A_STALE_KICKOFF = { now: () => "2026-09-11T19:00:00.000Z" };

  it("leaves a stale scheduled house league off the shelf rather than showing it as starting now", async () => {
    await seedHouseLeague({ id: "house_stale", rung: "open_12", kickoffAt: new Date("2026-09-10T19:00:00.000Z") });
    await seedHouseLeague({ id: "house_fresh", rung: "open_12", kickoffAt: new Date("2026-09-12T19:00:00.000Z") });

    const { house } = await listPublicLeagues(db, EMPTY_BROWSE_FILTER, AFTER_A_STALE_KICKOFF);

    // Not merely ranked below the fresh one — gone. Sorted by kickoff it would have led the shelf.
    expect(house.map((l) => l.id)).toEqual(["house_fresh"]);
  });

  it("keeps a sit-and-go league on the shelf however far its placeholder kickoff has drifted", async () => {
    // A `when_full` rung has no chosen time at all until the last seat lands (`fireWhenFullInTx`
    // writes one then). Until that moment `kickoff_at` is a placeholder, and judging it by the
    // clock would be judging a value that does not mean what the column's name says — so the
    // staleness predicate exempts the trigger outright rather than reaching for a wider margin.
    await seedHouseLeague({
      id: "house_sitandgo", rung: "sitandgo_12",
      kickoffAt: new Date("2026-09-10T19:00:00.000Z"), startTrigger: "when_full",
    });

    const { house } = await listPublicLeagues(db, EMPTY_BROWSE_FILTER, AFTER_A_STALE_KICKOFF);

    expect(house.map((l) => l.id)).toEqual(["house_sitandgo"]);
  });

  /**
   * FINAL WHOLE-BRANCH REVIEW, F6. `browseQuery`'s first safety property is that
   * `is_public_matchmade` is opt-in, and the shelf half shipped without checking it — resting
   * instead on the convention that the house factory always writes `true`. The row below cannot
   * exist through any code path this product has; seeding it directly is the point, because what
   * is under test is whether the boundary is structural or merely remembered.
   */
  it("refuses a house league that is not public-matchmade, on the one unauthenticated read", async () => {
    await seedHouseLeague({
      id: "house_private", rung: "open_12",
      kickoffAt: new Date("2026-09-10T19:00:00.000Z"), isPublicMatchmade: false,
    });

    const { house } = await listPublicLeagues(db, EMPTY_BROWSE_FILTER);

    expect(house).toEqual([]);
  });

  it("ignores every filter axis on the shelf, even one no house league matches", async () => {
    // The shelf is filter-immune by construction, not merely unfiltered by default — every
    // catalog rung shares one canonical format (`HOUSE_CATALOG`'s own `CANON`), so narrowing to
    // the format no house league plays is exactly the case that would empty the shelf if a
    // filter ever reached it.
    await seedHouseLeague({ id: "house_snake", rung: "open_12", kickoffAt: new Date("2026-09-10T19:00:00.000Z") });
    const { house } = await listPublicLeagues(db, { ...EMPTY_BROWSE_FILTER, format: "auction" });
    expect(house.map((l) => l.id)).toEqual(["house_snake"]);
  });
});

/**
 * D1 (storefront review; flow analysis J04) — `notAFixtureLeague()` proven against BOTH halves
 * of the shelf it governs. A fixture-named league is otherwise a perfectly normal, open, public
 * league in every other respect here (the point: name is the ONLY thing that should ever exclude
 * it), and a normally-named one seeded in the same call must still come through — the exclusion
 * must never widen into "nothing renders".
 */
describe("listPublicLeagues excludes dev/e2e fixture leagues (D1)", () => {
  it("never lists a member league whose name carries a fixture prefix, while a normal one still appears", async () => {
    await seed({
      id: "fixture_e2e", name: "E2E Money Dark 1787678163994", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
    });
    await seed({
      id: "fixture_mobile360", name: "Mobile360UnbrokenOverlongIdentifierFixture", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
    });
    await seed({
      id: "real", name: "The Longshot League 5", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
    });

    const rows = await browseLeagues(db, EMPTY_BROWSE_FILTER);

    expect(rows.map((row) => row.id)).toEqual(["real"]);
  });

  it("never lists a house-shelf league whose name carries a fixture prefix, while a normal one still appears", async () => {
    await seedHouseLeague({
      id: "house_fixture", rung: "open_12", kickoffAt: new Date("2026-09-10T19:00:00.000Z"),
      name: "E2E Held Trade League",
    });
    await seedHouseLeague({
      id: "house_real", rung: "beginner_12", kickoffAt: new Date("2026-09-11T19:00:00.000Z"),
    });

    const { house } = await listPublicLeagues(db, EMPTY_BROWSE_FILTER);

    expect(house.map((l) => l.id)).toEqual(["house_real"]);
  });

  /**
   * The ONE opt-out, pinned on both sides. The e2e suite's own `next start` process sets
   * `E2E_SHOW_FIXTURE_LEAGUES=1` so its specs can join their seeded league through the real
   * `/browse` shelf; every other process must keep the filter. The fail-CLOSED half is the half
   * worth a test — a truthy-looking value that is not the literal "1" has to keep hiding
   * fixtures, or a stray `E2E_SHOW_FIXTURE_LEAGUES=true` in someone's `.env.local` quietly puts
   * seeded junk back on the founder's shelf.
   */
  describe("E2E_SHOW_FIXTURE_LEAGUES", () => {
    const original = process.env.E2E_SHOW_FIXTURE_LEAGUES;
    afterEach(() => {
      if (original === undefined) delete process.env.E2E_SHOW_FIXTURE_LEAGUES;
      else process.env.E2E_SHOW_FIXTURE_LEAGUES = original;
    });

    async function seedOneOfEach(): Promise<void> {
      await seed({
        id: "gate_fixture", name: "E2E Money Dark 1787678163994", format: "snake", experienceTier: "beginner",
        stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
      });
      await seed({
        id: "gate_real", name: "The Longshot League 5", format: "snake", experienceTier: "beginner",
        stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
      });
    }

    it("lists a fixture league when the suite's own server opts in with the literal 1", async () => {
      process.env.E2E_SHOW_FIXTURE_LEAGUES = "1";
      await seedOneOfEach();

      const rows = await browseLeagues(db, EMPTY_BROWSE_FILTER);

      expect(rows.map((row) => row.id).sort()).toEqual(["gate_fixture", "gate_real"]);
    });

    it.each(["true", "0", "yes", ""])("keeps hiding fixtures when the value is %o rather than 1", async (value) => {
      process.env.E2E_SHOW_FIXTURE_LEAGUES = value;
      await seedOneOfEach();

      const rows = await browseLeagues(db, EMPTY_BROWSE_FILTER);

      expect(rows.map((row) => row.id)).toEqual(["gate_real"]);
    });
  });
});

/**
 * Phase 3.6, Task 6: the hold interstitial's own one-league read — reached by an id a visitor
 * already holds (the browse card they clicked, the hold cookie they are carrying), never
 * discovered by scanning a list, so it must answer regardless of whether `listPublicLeagues`'s
 * own narrowing would still surface this league right now.
 */
describe("publicLeaguePreview", () => {
  it("answers a public league's own facts by id, held seats included", async () => {
    await seed({
      id: "preview_open", name: "Preview League", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 9, isPublicMatchmade: true,
    });
    await claimSeatHold(db, { leagueId: "preview_open", token: "hold_preview", now: "2026-08-17T12:00:00.000Z" });

    const preview = await publicLeaguePreview(db, "preview_open", { now: () => "2026-08-17T12:00:00.000Z" });
    expect(preview).toMatchObject({ id: "preview_open", name: "Preview League", teamCount: 12, filledTeams: 9, heldSeats: 1, houseRung: null });
  });

  it("answers null for a private league, byte-identically to a missing one", async () => {
    await seed({
      id: "preview_private", name: "Preview Private", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: false,
    });
    expect(await publicLeaguePreview(db, "preview_private")).toBeNull();
    expect(await publicLeaguePreview(db, "does_not_exist")).toBeNull();
  });

  it("answers a house league too, carrying its own rung", async () => {
    await seedHouseLeague({ id: "preview_house", rung: "beginner_12", kickoffAt: new Date("2026-09-10T19:00:00.000Z") });
    const preview = await publicLeaguePreview(db, "preview_house");
    expect(preview).toMatchObject({ id: "preview_house", houseRung: "beginner_12" });
  });
});

/**
 * Phase 3.6, Task 5, Step 3: the two disclosure decisions `PublicLeagueSummary`'s docblock names
 * as the fourteenth and fifteenth fields.
 */
describe("listPublicLeagues roster and playoff facts (Task 5)", () => {
  it("derives the roster summary from the league's own stored slots, never a hand-typed default", async () => {
    await seed({
      id: "roster_standard", name: "Roster Standard", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
    });
    await db.insert(leagues).values({
      id: "roster_superflex", name: "Roster Superflex", format: "snake", teamCount: 12, stakeTier: 0,
      experienceTier: "beginner", isPublicMatchmade: true, commissionerUserId: "owner",
      rosterSlots: SUPERFLEX_ROSTER_SLOTS,
    });
    await db.insert(drafts).values({
      id: "roster_superflex_draft", leagueId: "roster_superflex", format: "snake", status: "scheduled",
      kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
    });
    await db.insert(scoringSettings).values({ leagueId: "roster_superflex", ...STANDARD_SCORING });

    const rows = await browseLeagues(db, EMPTY_BROWSE_FILTER);
    const byId = new Map(rows.map((row) => [row.id, row.rosterSummary]));
    expect(byId.get("roster_standard")).toBe("15 slots, 1 flex");
    expect(byId.get("roster_superflex")).toBe("16 slots, 2 flex, superflex");
  });

  it("gives every league the same platform-wide playoff weeks, computed from config", async () => {
    await seed({
      id: "playoffs_a", name: "Playoffs A", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
    });
    const [summary] = await browseLeagues(db, EMPTY_BROWSE_FILTER);
    expect(summary!.playoffWeeks).toEqual([15, 16, 17]);
  });
});

/**
 * Phase 3.6, Task 5, Step 4: the shelf's own sort pill and when-full toggle — separate
 * parameters `browseQuery`/`listPublicLeagues` read directly, never a `BrowseFilter` axis (see
 * `BrowseQueryOptions`'s own docblock). Every existing call above this describe block passes
 * neither, and keeps passing today's exact default ordering.
 */
describe("listPublicLeagues sort and when-full options (Task 5)", () => {
  it("defaults to seats-remaining ordering when no option is passed, unchanged from before this task", async () => {
    await seed({
      id: "sort_default_a", name: "Sort Default A", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 2, isPublicMatchmade: true,
    });
    await seed({
      id: "sort_default_b", name: "Sort Default B", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 10, isPublicMatchmade: true,
    });
    const rows = await browseLeagues(db, EMPTY_BROWSE_FILTER);
    expect(rows.map((row) => row.id)).toEqual(["sort_default_b", "sort_default_a"]);
  });

  it("'soonest' sorts the member list by kickoff time instead of seats remaining", async () => {
    // Direct inserts, not `seed()`: that helper always schedules the same fixed kickoff, and
    // this test's whole point is two DIFFERENT kickoffs the sort has to tell apart.
    for (const [id, kickoffAt, filled] of [
      ["sort_soon_later", "2026-09-20T00:00:00.000Z", 10],
      ["sort_soon_sooner", "2026-09-11T00:00:00.000Z", 2],
    ] as const) {
      await db.insert(leagues).values({
        id, name: id, format: "snake", teamCount: 12, stakeTier: 0, experienceTier: "beginner",
        isPublicMatchmade: true, commissionerUserId: "owner",
      });
      await db.insert(drafts).values({ id: `${id}_draft`, leagueId: id, format: "snake", status: "scheduled", kickoffAt: new Date(kickoffAt) });
      await db.insert(scoringSettings).values({ leagueId: id, ...STANDARD_SCORING });
      for (let i = 0; i < filled; i++) {
        const userId = `${id}_u${i}`;
        await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: `Manager ${i}` }).onConflictDoNothing();
        await db.insert(teams).values({ id: `${id}_t${i}`, leagueId: id, userId, name: `Team ${i}` });
      }
    }
    const { leagues: rows } = await listPublicLeagues(db, EMPTY_BROWSE_FILTER, undefined, { sort: "soonest" });
    expect(rows.map((row) => row.id)).toEqual(["sort_soon_sooner", "sort_soon_later"]);
  });

  it("'whenFullOnly' narrows the member list to when-full leagues, before the cap", async () => {
    await seed({
      id: "wf_only_scheduled", name: "WF Only Scheduled", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
    });
    await db.insert(leagues).values({
      id: "wf_only_when_full", name: "WF Only When Full", format: "snake", teamCount: 12, stakeTier: 0,
      experienceTier: "beginner", isPublicMatchmade: true, commissionerUserId: "owner",
    });
    await db.insert(drafts).values({
      id: "wf_only_when_full_draft", leagueId: "wf_only_when_full", format: "snake", status: "scheduled",
      kickoffAt: new Date("2026-09-10T17:00:00.000Z"), startTrigger: "when_full",
    });
    await db.insert(scoringSettings).values({ leagueId: "wf_only_when_full", ...STANDARD_SCORING });

    const { leagues: rows } = await listPublicLeagues(db, EMPTY_BROWSE_FILTER, undefined, { whenFullOnly: true });
    expect(rows.map((row) => row.id)).toEqual(["wf_only_when_full"]);
  });
});
