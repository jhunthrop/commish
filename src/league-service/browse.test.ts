import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, isNotNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { countingDb, createTestDb, truncateAll } from "@/db/test-db";
import { drafts, leagues, scoringSettings, teams, users } from "@/db/schema";
import { STANDARD_SCORING, type ScoringSettings } from "@/domain/scoring";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { EMPTY_BROWSE_FILTER, hasOpenSeat, matchesBrowseFilter } from "@/matchmaking/filter";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { BrowseFilter, PublicLeagueSummary } from "@/matchmaking/contract";
import type { HouseRungName } from "@/matchmaking/house-catalog";
import { compositionCategoryFor } from "@/participation/composition";
import { listPublicLeagues, PUBLIC_LEAGUE_FIELDS } from "./browse";

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
}): Promise<void> {
  const teamCount = league.teamCount ?? 12;
  const filled = league.filled ?? 0;
  await db.insert(leagues).values({
    id: league.id,
    name: `House ${league.id}`,
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
        teamCount: 12, filledTeams: 8, scoringLabel: "Standard", compositionCategory: "all_newcomers",
        draftAt: "Thursday 10 September, 5:00 PM UTC (in 24 days)", medianGame: false, startTrigger: "scheduled",
        houseRung: null,
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

  it("costs exactly three queries, whether or not any seat-holder has a completed-season history", async () => {
    // `listPublicLeagues` is `browseQuery` + `houseShelfQuery` + `scoringWeightsByLeagueId`
    // (Phase 3.5 addendum, Task 14) — the composition join is FOLDED into each of the first two
    // queries itself (measured in `src/db/index-plans.test.ts`), never a fourth round trip, so
    // this stays three queries regardless of how many leagues, seats or house rungs it answers
    // for. WAS two queries, before the shelf gained its own query alongside the member list's.
    await giveCompletedSeasons("counting_veteran", INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
    await seed({
      id: "counting", name: "Counting League", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 2, isPublicMatchmade: true,
      seatUserIds: ["counting_veteran", "counting_newcomer"],
    });
    const counting = countingDb(db);
    await listPublicLeagues(counting.db, EMPTY_BROWSE_FILTER);
    expect(counting.selectCount()).toBe(3);
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
