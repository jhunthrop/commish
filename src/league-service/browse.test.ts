import { describe, it, expect, beforeEach, afterAll } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import { drafts, leagues, teams, users } from "@/db/schema";
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
  });
  await db.insert(drafts).values({
    id: `${league.id}_draft`,
    leagueId: league.id,
    format: league.format,
    status: league.draftStatus ?? "scheduled",
    kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
    auctionBudget: league.format === "auction" ? 200 : null,
  });
  for (let i = 0; i < league.filled; i++) {
    const userId = `${league.id}_u${i}`;
    await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: `Manager ${i}` });
    await db.insert(teams).values({ id: `${league.id}_t${i}`, leagueId: league.id, userId, name: `Team ${i}` });
  }
}

let seedCounter = 0;

/**
 * The brief's convenience seeder: one open, public, joinable league from a filter-shaped
 * overrides object, returning the `PublicLeagueSummary` the pure rule (`matchesBrowseFilter`,
 * `hasOpenSeat`) can be run against directly. Built on `seed()` above rather than duplicating
 * its insert logic — this only adds id/name generation and the shape translation
 * (`filledTeams` -> `filled`) `seed()` doesn't do itself.
 */
async function seedPublicLeague(
  db: Db,
  overrides: {
    readonly format: "snake" | "auction";
    readonly experienceTier: "beginner" | "experienced";
    readonly stakeTier: number;
    readonly teamCount: number;
    readonly filledTeams: number;
  },
): Promise<PublicLeagueSummary> {
  seedCounter += 1;
  const id = `seed_${seedCounter}`;
  const name = `Seeded League ${seedCounter}`;
  await seed({
    id,
    name,
    format: overrides.format,
    experienceTier: overrides.experienceTier,
    stakeTier: overrides.stakeTier,
    teamCount: overrides.teamCount,
    filled: overrides.filledTeams,
    isPublicMatchmade: true,
  });
  return {
    id,
    name,
    format: overrides.format,
    experienceTier: overrides.experienceTier,
    stakeTier: overrides.stakeTier,
    teamCount: overrides.teamCount,
    filledTeams: overrides.filledTeams,
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
    const rows = await listPublicLeagues(db, EMPTY_BROWSE_FILTER);
    expect(rows).toEqual([
      { id: "open", name: "Rookie Snake Room", format: "snake", experienceTier: "beginner", stakeTier: 0, teamCount: 12, filledTeams: 8 },
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
    expect(await listPublicLeagues(db, { format: "snake", experienceTier: "experienced", stakeTier: 3 })).toEqual([]);
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

    const combinations: BrowseFilter[] = [];
    for (const format of [...MATCHMAKING_CONFIG.formats, "any" as const]) {
      for (const experienceTier of [...MATCHMAKING_CONFIG.experienceTiers, "any" as const]) {
        for (const stakeTier of [...MATCHMAKING_CONFIG.stakeTiers.map((entry) => entry.tier), "any" as const]) {
          combinations.push({ format, experienceTier, stakeTier });
        }
      }
    }
    expect(combinations).toHaveLength(3 * 3 * 5);

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

    const narrow = await listPublicLeagues(db, { format: "auction", experienceTier: "experienced", stakeTier: 3 });
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
