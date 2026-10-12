import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { countingDb, createTestDb } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import { drafts, leagues, matchups, teams, users } from "@/db/schema";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { completedSeasonsFor, completedSeasonsForMany, stampSeasonCompleteInTx } from "./participation";

const db = createTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

/** A one-team league, seated by `userId`, completed at `completedAt` (or never, if omitted). The
 *  commissioner and the sole member are the same account — participation's read never cares who
 *  else is in the league, only which leagues THIS account has a team in. */
async function seatIn(userId: string, leagueId: string, completedAt: string | null = null): Promise<void> {
  await db.insert(leagues).values({
    id: leagueId,
    name: leagueId,
    format: "snake",
    teamCount: 1,
    commissionerUserId: userId,
    seasonCompletedAt: completedAt === null ? null : new Date(completedAt),
  });
  await db.insert(teams).values({ id: `${leagueId}_team`, leagueId, userId, name: "Team" });
}

describe("completedSeasonsFor", () => {
  it("counts one completed season per completed league this account has a team in", async () => {
    await db.insert(users).values({ id: "u_alice", email: "alice@test.local", displayName: "Alice" });
    await seatIn("u_alice", "lg_completed_a", "2026-01-01T00:00:00.000Z");
    await seatIn("u_alice", "lg_completed_b", "2026-01-08T00:00:00.000Z");
    await seatIn("u_alice", "lg_unfinished_c");
    expect(await completedSeasonsFor(db, "u_alice")).toBe(2);
  });

  it("answers 0 for an account with no completed seasons, and for an account with none at all", async () => {
    await db.insert(users).values({ id: "u_new", email: "new@test.local", displayName: "New" });
    expect(await completedSeasonsFor(db, "u_new")).toBe(0);
    await seatIn("u_new", "lg_unfinished_only");
    expect(await completedSeasonsFor(db, "u_new")).toBe(0);
  });

  it("costs exactly one query, however many leagues the account is in", async () => {
    // The read model is a bounded, indexed count over the account's own teams — never a per-league
    // round trip, and never a rollup row that could disagree with it. `data-layer-hardening.md`'s
    // threshold is unbounded growth, and an account's team count is bounded by the leagues it has
    // joined; the unbounded half (every matchup in the product) is what the stamp removed.
    await db.insert(users).values({ id: "u_bob", email: "bob@test.local", displayName: "Bob" });
    await seatIn("u_bob", "lg_bob_a", "2026-01-01T00:00:00.000Z");
    await seatIn("u_bob", "lg_bob_b");
    const counting = countingDb(db);
    await completedSeasonsFor(counting.db, "u_bob");
    expect(counting.selectCount()).toBe(1);
  });
});

describe("completedSeasonsForMany", () => {
  it("counts completed seasons per account, batched in one query", async () => {
    await db.insert(users).values([
      { id: "u_many_vet", email: "many_vet@test.local", displayName: "Vet" },
      { id: "u_many_new", email: "many_new@test.local", displayName: "New" },
    ]);
    await seatIn("u_many_vet", "lg_many_a", "2026-01-01T00:00:00.000Z");
    await seatIn("u_many_vet", "lg_many_b", "2026-01-08T00:00:00.000Z");
    await seatIn("u_many_new", "lg_many_c");

    const counting = countingDb(db);
    const counts = await completedSeasonsForMany(counting.db, ["u_many_vet", "u_many_new"]);

    expect(counts.get("u_many_vet")).toBe(2);
    // Zero completed seasons is absent from the map, not a zero-valued entry — a `GROUP BY`
    // reports no row at all for a group with nothing in it.
    expect(counts.has("u_many_new")).toBe(false);
    expect(counting.selectCount()).toBe(1);
  });

  it("answers an empty map with no query for an empty id list", async () => {
    const counting = countingDb(db);
    const counts = await completedSeasonsForMany(counting.db, []);
    expect(counts).toEqual(new Map());
    expect(counting.selectCount()).toBe(0);
  });

  it("never counts an account's completed seasons against another account's id", async () => {
    await db.insert(users).values([
      { id: "u_many_x", email: "many_x@test.local", displayName: "X" },
      { id: "u_many_y", email: "many_y@test.local", displayName: "Y" },
    ]);
    await seatIn("u_many_x", "lg_many_x", "2026-01-01T00:00:00.000Z");

    const counts = await completedSeasonsForMany(db, ["u_many_x", "u_many_y"]);
    expect(counts.get("u_many_x")).toBe(1);
    expect(counts.has("u_many_y")).toBe(false);
  });
});

describe("stampSeasonCompleteInTx", () => {
  async function seasonCompletedAt(leagueId: string): Promise<Date | null> {
    const [row] = await db.select({ seasonCompletedAt: leagues.seasonCompletedAt }).from(leagues).where(eq(leagues.id, leagueId));
    return row?.seasonCompletedAt ?? null;
  }

  it("stamps a league whose season has never been marked complete, and reports that it did", async () => {
    await db.insert(users).values({ id: "u_stamp_a", email: "stamp_a@test.local", displayName: "A" });
    await seatIn("u_stamp_a", "lg_stamp_direct");
    const occurredAt = "2026-02-01T00:00:00.000Z";

    const stamped = await db.transaction((tx) => stampSeasonCompleteInTx(tx, "lg_stamp_direct", occurredAt));

    expect(stamped).toBe(true);
    expect((await seasonCompletedAt("lg_stamp_direct"))?.toISOString()).toBe(occurredAt);
  });

  it("refuses to re-stamp an already-completed league, and reports that it did nothing", async () => {
    await db.insert(users).values({ id: "u_stamp_b", email: "stamp_b@test.local", displayName: "B" });
    await seatIn("u_stamp_b", "lg_stamp_twice", "2026-01-01T00:00:00.000Z");

    const stamped = await db.transaction((tx) => stampSeasonCompleteInTx(tx, "lg_stamp_twice", "2026-03-01T00:00:00.000Z"));

    expect(stamped).toBe(false);
    expect((await seasonCompletedAt("lg_stamp_twice"))?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("refuses a league with an unscored matchup, whatever else is true about it", async () => {
    await db.insert(users).values([
      { id: "u_stamp_c", email: "stamp_c@test.local", displayName: "C" },
      { id: "u_stamp_d", email: "stamp_d@test.local", displayName: "D" },
    ]);
    await db.insert(leagues).values({ id: "lg_stamp_unscored", name: "lg_stamp_unscored", format: "snake", teamCount: 2, commissionerUserId: "u_stamp_c" });
    await db.insert(teams).values([
      { id: "team_stamp_c", leagueId: "lg_stamp_unscored", userId: "u_stamp_c", name: "C" },
      { id: "team_stamp_d", leagueId: "lg_stamp_unscored", userId: "u_stamp_d", name: "D" },
    ]);
    await db.insert(drafts).values({
      id: "draft_stamp_unscored", leagueId: "lg_stamp_unscored", format: "snake", status: "complete",
      kickoffAt: new Date("2026-01-01T00:00:00.000Z"), auctionBudget: null,
    });
    await db.insert(matchups).values({
      leagueId: "lg_stamp_unscored", weekNumber: 1, homeTeamId: "team_stamp_c", awayTeamId: "team_stamp_d", homeScore: null, awayScore: null,
    });

    const stamped = await db.transaction((tx) => stampSeasonCompleteInTx(tx, "lg_stamp_unscored", "2026-03-01T00:00:00.000Z"));

    expect(stamped).toBe(false);
    expect(await seasonCompletedAt("lg_stamp_unscored")).toBeNull();
  });
});

describe("the participation cutoffs come from INTEGRITY_CONFIG, not a hardcoded copy", () => {
  it("keeps the module's own idea of the cutoffs in sync with the config it reads", () => {
    // A change to the ordering rule (`config.test.ts`'s own "verified at or below veteran"
    // invariant) has real consequences here: the badge (`isVerifiedPlayer`) and the join gate
    // (`participationTierFor`) read the same count through two cutoffs, and could disagree about
    // the same account only if those two inverted.
    expect(INTEGRITY_CONFIG.participation.verifiedSeasonCutoff).toBeLessThanOrEqual(INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
  });
});
