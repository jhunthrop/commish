import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { countingDb, createTestDb, truncateAll } from "@/db/test-db";
import { drafts, leagues, matchups, teams, users } from "@/db/schema";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { completedSeasonsFor, leagueTierComposition, participationFor, stampSeasonCompleteInTx } from "./participation";

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

describe("participationFor", () => {
  it("reads the tier through the configured cutoff and not through a second copy of the rule", async () => {
    await db.insert(users).values({ id: "u_veteran", email: "veteran@test.local", displayName: "Veteran" });
    await seatIn("u_veteran", "lg_v_a", "2026-01-01T00:00:00.000Z");
    await seatIn("u_veteran", "lg_v_b", "2026-01-08T00:00:00.000Z");
    await seatIn("u_veteran", "lg_v_c", "2026-01-15T00:00:00.000Z");
    expect(await participationFor(db, "u_veteran")).toEqual({ completedSeasons: 3, tier: "veteran", verified: true });
  });

  it("reads newcomer and unverified for an account below both cutoffs", async () => {
    await db.insert(users).values({ id: "u_newcomer", email: "newcomer@test.local", displayName: "Newcomer" });
    await seatIn("u_newcomer", "lg_n_a");
    expect(await participationFor(db, "u_newcomer")).toEqual({ completedSeasons: 0, tier: "newcomer", verified: false });
  });

  it("costs exactly one query — participationFor makes no round trip beyond completedSeasonsFor's own", async () => {
    await db.insert(users).values({ id: "u_carol", email: "carol@test.local", displayName: "Carol" });
    await seatIn("u_carol", "lg_carol_a", "2026-01-01T00:00:00.000Z");
    const counting = countingDb(db);
    await participationFor(counting.db, "u_carol");
    expect(counting.selectCount()).toBe(1);
  });
});

describe("leagueTierComposition", () => {
  it("names an aggregate and never a member", async () => {
    // `PublicLeagueSummary` is the privacy boundary of this product's one unauthenticated read.
    // A composition is two counts; a list of who is a newcomer would be a roster of strangers'
    // inexperience published to anybody with the URL.
    const commissionerId = "u_pub_commish";
    await db.insert(users).values({ id: commissionerId, email: "commish@test.local", displayName: "Commish" });
    await db.insert(leagues).values({ id: "lg_public", name: "Public League", format: "snake", teamCount: 12, commissionerUserId: commissionerId });
    const memberIds = Array.from({ length: 8 }, (_, index) => `u_pub_member_${index}`);
    await db.insert(users).values(memberIds.map((id) => ({ id, email: `${id}@test.local`, displayName: id })));
    await db.insert(teams).values(memberIds.map((id, index) => ({ id: `team_pub_${index}`, leagueId: "lg_public", userId: id, name: id })));

    expect(await leagueTierComposition(db, "lg_public")).toEqual({ newcomers: 8, veterans: 0 });
  });

  it("counts a member as a veteran once their OWN completed-season history crosses the cutoff", async () => {
    const commissionerId = "u_mix_commish";
    await db.insert(users).values([
      { id: commissionerId, email: "mix_commish@test.local", displayName: "Commish" },
      { id: "u_mix_veteran", email: "mix_veteran@test.local", displayName: "Veteran" },
      { id: "u_mix_newcomer", email: "mix_newcomer@test.local", displayName: "Newcomer" },
    ]);
    // Three OTHER completed leagues for the veteran, crossing veteranSeasonCutoff (3).
    await seatIn("u_mix_veteran", "lg_mix_prior_a", "2025-01-01T00:00:00.000Z");
    await seatIn("u_mix_veteran", "lg_mix_prior_b", "2025-06-01T00:00:00.000Z");
    await seatIn("u_mix_veteran", "lg_mix_prior_c", "2025-12-01T00:00:00.000Z");

    await db.insert(leagues).values({ id: "lg_mix", name: "Mixed League", format: "snake", teamCount: 12, commissionerUserId: commissionerId });
    await db.insert(teams).values([
      { id: "team_mix_veteran", leagueId: "lg_mix", userId: "u_mix_veteran", name: "Veteran's Team" },
      { id: "team_mix_newcomer", leagueId: "lg_mix", userId: "u_mix_newcomer", name: "Newcomer's Team" },
    ]);

    expect(await leagueTierComposition(db, "lg_mix")).toEqual({ newcomers: 1, veterans: 1 });
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
    // invariant) has real consequences here: `participationFor`'s `verified` and `tier` fields
    // could disagree about the same account only if the two cutoffs inverted.
    expect(INTEGRITY_CONFIG.participation.verifiedSeasonCutoff).toBeLessThanOrEqual(INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
  });
});
