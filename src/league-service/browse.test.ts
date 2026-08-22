import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { countingDb, createTestDb, truncateAll } from "@/db/test-db";
import { drafts, leagues, scoringSettings, teams, users } from "@/db/schema";
import { STANDARD_SCORING, type ScoringSettings } from "@/domain/scoring";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { EMPTY_BROWSE_FILTER, hasOpenSeat, matchesBrowseFilter } from "@/matchmaking/filter";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { BrowseFilter, PublicLeagueSummary } from "@/matchmaking/contract";
import { listPublicLeagues, PUBLIC_LEAGUE_FIELDS } from "./browse";

const db = createTestDb();

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
    // for one — matching `listPublicLeagues`'s own answer for the same corpus.
    tierComposition: { newcomers: overrides.filledTeams - veteranSeats, veterans: veteranSeats },
    // `seed()` always schedules the draft for the same fixed instant — no caller of this
    // fixture compares `draftAt` (they compare against `matchesBrowseFilter`/`.id`, neither of
    // which reads it), so this only needs to satisfy `PublicLeagueSummary`'s shape.
    draftAt: "Thursday 10 September, 5:00 PM UTC",
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
    const rows = await listPublicLeagues(db, EMPTY_BROWSE_FILTER, { now: () => "2026-08-17T12:00:00.000Z" });
    expect(rows).toEqual([
      {
        id: "open", name: "Rookie Snake Room", format: "snake", experienceTier: "beginner", stakeTier: 0,
        teamCount: 12, filledTeams: 8, scoringLabel: "Standard", tierComposition: { newcomers: 8, veterans: 0 },
        draftAt: "Thursday 10 September, 5:00 PM UTC (in 24 days)",
      },
    ]);
  });

  it("discloses nothing beyond the named public fields", async () => {
    await seed({
      id: "open", name: "Rookie Snake Room", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
    });
    const [row] = await listPublicLeagues(db, EMPTY_BROWSE_FILTER);
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
    const rows = await listPublicLeagues(db, EMPTY_BROWSE_FILTER);
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
    const rows = await listPublicLeagues(db, EMPTY_BROWSE_FILTER);
    expect(rows[0]?.scoringLabel).toBe("Custom");
  });

  it("never lists a private league, whatever it is filtered by", async () => {
    await seed({
      id: "private", name: "Group Chat Only", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 2, isPublicMatchmade: false,
    });
    expect(await listPublicLeagues(db, EMPTY_BROWSE_FILTER)).toEqual([]);
    expect(await listPublicLeagues(db, { ...EMPTY_BROWSE_FILTER, format: "snake" })).toEqual([]);
  });

  it("never lists a full league", async () => {
    await seed({
      id: "full", name: "Packed House", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 4, filled: 4, isPublicMatchmade: true,
    });
    expect(await listPublicLeagues(db, EMPTY_BROWSE_FILTER)).toEqual([]);
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
    expect(await listPublicLeagues(db, EMPTY_BROWSE_FILTER)).toEqual([]);
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

    expect((await listPublicLeagues(db, { ...EMPTY_BROWSE_FILTER, format: "auction" })).map((l) => l.id)).toEqual(["b"]);
    expect((await listPublicLeagues(db, { ...EMPTY_BROWSE_FILTER, experienceTier: "beginner" })).map((l) => l.id)).toEqual(["a"]);
    expect((await listPublicLeagues(db, { ...EMPTY_BROWSE_FILTER, stakeTier: 3 })).map((l) => l.id)).toEqual(["b"]);
    expect(
      await listPublicLeagues(db, { format: "snake", experienceTier: "experienced", stakeTier: 3, participationTier: "any" }),
    ).toEqual([]);
  });

  it("returns matching leagues oldest-first, per the docblock's own promise", async () => {
    // Seeded newest-first so a bug that returned insertion order (or any order but createdAt
    // asc) would show up as a wrong sequence, not just a wrong set. Mutation check: flipping
    // browse.ts's `asc(leagues.createdAt)` to `asc(leagues.name)` changes this order — see
    // fix-wave-report.md for the before/after transcript.
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
    const rows = await listPublicLeagues(db, EMPTY_BROWSE_FILTER);
    expect(rows.map((league) => league.id)).toEqual(["oldest", "middle", "newest"]);
  });

  it("caps how many leagues one browse can answer with", async () => {
    for (let i = 0; i < MATCHMAKING_CONFIG.maxResults + 3; i++) {
      await seed({
        id: `l${i}`, name: `Open League ${i}`, format: "snake", experienceTier: "beginner",
        stakeTier: 0, teamCount: 12, filled: 1, isPublicMatchmade: true,
      });
    }
    expect(await listPublicLeagues(db, EMPTY_BROWSE_FILTER)).toHaveLength(MATCHMAKING_CONFIG.maxResults);
  });

});

describe("listPublicLeagues tier composition", () => {
  it("carries the composition as two counts and nothing that names a person", async () => {
    await seed({
      id: "comp_all_newcomer", name: "Rookie Room", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 6, isPublicMatchmade: true,
    });
    const [summary] = await listPublicLeagues(db, EMPTY_BROWSE_FILTER);
    expect(summary!.tierComposition).toEqual({ newcomers: 6, veterans: 0 });
    expect(Object.keys(summary!).sort()).toEqual([...PUBLIC_LEAGUE_FIELDS].sort());
    expect(JSON.stringify(summary)).not.toContain("comp_all_newcomer_u0");
  });

  it("counts a seat as a veteran once that seat-holder's OWN completed-season history crosses the cutoff", async () => {
    await giveCompletedSeasons("mix_veteran", INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
    await seed({
      id: "mix", name: "Mixed League", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 2, isPublicMatchmade: true,
      seatUserIds: ["mix_veteran", "mix_newcomer"],
    });
    const [summary] = await listPublicLeagues(db, EMPTY_BROWSE_FILTER);
    expect(summary!.tierComposition).toEqual({ newcomers: 1, veterans: 1 });
  });

  it("counts an empty seat as neither a newcomer nor a veteran", async () => {
    await seed({
      id: "empty_seats", name: "Just Opened", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 0, isPublicMatchmade: true,
    });
    const [summary] = await listPublicLeagues(db, EMPTY_BROWSE_FILTER);
    expect(summary!.tierComposition).toEqual({ newcomers: 0, veterans: 0 });
  });

  it("costs exactly two queries, whether or not any seat-holder has a completed-season history", async () => {
    // `listPublicLeagues` is `browseQuery` + `scoringWeightsByLeagueId` — the composition join is
    // FOLDED into `browseQuery` itself (measured in `src/db/index-plans.test.ts`), never a third
    // round trip, so this stays two queries regardless of how many leagues or seats it answers
    // for.
    await giveCompletedSeasons("counting_veteran", INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
    await seed({
      id: "counting", name: "Counting League", format: "snake", experienceTier: "beginner",
      stakeTier: 0, teamCount: 12, filled: 2, isPublicMatchmade: true,
      seatUserIds: ["counting_veteran", "counting_newcomer"],
    });
    const counting = countingDb(db);
    await listPublicLeagues(counting.db, EMPTY_BROWSE_FILTER);
    expect(counting.selectCount()).toBe(2);
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
    const rows = await listPublicLeagues(db, { ...EMPTY_BROWSE_FILTER, participationTier: "newcomer" });
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
    const rows = await listPublicLeagues(db, { ...EMPTY_BROWSE_FILTER, participationTier: "veteran" });
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
      const fromSql = (await listPublicLeagues(db, filter)).map((l) => l.id).sort();
      const fromRule = (await listPublicLeagues(db, EMPTY_BROWSE_FILTER))
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
    const veteranOnly = await listPublicLeagues(db, { ...EMPTY_BROWSE_FILTER, participationTier: "veteran" });
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
      const fromSql = await listPublicLeagues(db, filter);
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

    const narrow = await listPublicLeagues(db, {
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
    const all = await listPublicLeagues(db, EMPTY_BROWSE_FILTER);
    expect(all).toHaveLength(MATCHMAKING_CONFIG.maxResults);
  });

  it("counts fill with a grouped count, so a full league is excluded by the database", async () => {
    await seedPublicLeague(db, { format: "snake", experienceTier: "beginner", stakeTier: 0, teamCount: 4, filledTeams: 4 });
    const open = await seedPublicLeague(db, { format: "snake", experienceTier: "beginner", stakeTier: 0, teamCount: 4, filledTeams: 3 });
    const rows = await listPublicLeagues(db, EMPTY_BROWSE_FILTER);
    expect(rows.map((league) => league.id)).toEqual([open.id]);
    expect(rows[0]?.filledTeams).toBe(3);
  });
});
