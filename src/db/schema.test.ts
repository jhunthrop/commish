import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { unwrapCauseChain } from "@research-ts/db/errors";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { statWeeks } from "@research-ts/db/schema";
import { users, leagues, teams, scoringSettings, leagueInvites, lineupSlots, userPreferences, reviews, reviewReports } from "@/db/schema";
import { PPR_SCORING } from "@research-ts/domain/scoring";

const db = createTestDb();

/** Postgres' generic check-violation SQLSTATE — shared by every CHECK constraint test in this
 *  file, since asserting only "it threw" would pass for any OTHER check on the same table too. */
const CHECK_VIOLATION_SQLSTATE = "23514";

/** The driver's own error fields sit one level down on `.cause` — `./errors`' own finding,
 *  reused here rather than re-derived. */
function violatedConstraint(error: unknown): { readonly code: unknown; readonly name: unknown } {
  const fields = (key: string) => {
    for (const link of unwrapCauseChain(error)) {
      if (typeof link === "object" && link !== null && key in link) return (link as Record<string, unknown>)[key];
    }
    return undefined;
  };
  return { code: fields("code"), name: fields("constraint_name") };
}

/** Asserts `insert` was refused BY NAME, the named CHECK constraint's own SQLSTATE — the same
 *  "assert the constraint's name, not just that it threw" discipline every CHECK test here
 *  follows, hoisted once (Phase 4.5, Task 2 review fix round 1) so a second CHECK constraint on
 *  `leagues` does not duplicate this helper alongside the first. */
async function expectCheckViolation(insert: Promise<unknown>, constraintName: string): Promise<void> {
  let caught: unknown;
  await insert.catch((error: unknown) => {
    caught = error;
  });
  expect(caught, "the row committed — the CHECK constraint is not enforcing").toBeDefined();
  expect(violatedConstraint(caught)).toEqual({ code: CHECK_VIOLATION_SQLSTATE, name: constraintName });
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("schema round-trip against Postgres", () => {
  it("creates a user, a league they commission, their team, and the league's scoring settings", async () => {
    await db.insert(users).values({
      id: "user_1",
      email: "jh@example.com",
      displayName: "JH",
    });

    await db.insert(leagues).values({
      id: "league_1",
      name: "Sunday Money",
      format: "snake",
      teamCount: 12,
      commissionerUserId: "user_1",
    });

    await db.insert(teams).values({
      id: "team_1",
      leagueId: "league_1",
      userId: "user_1",
      name: "The Commish",
    });

    await db.insert(scoringSettings).values({ leagueId: "league_1", ...PPR_SCORING });

    const [league] = await db.select().from(leagues).where(eq(leagues.id, "league_1"));
    const leagueTeams = await db.select().from(teams).where(eq(teams.leagueId, "league_1"));
    const [scoring] = await db
      .select()
      .from(scoringSettings)
      .where(eq(scoringSettings.leagueId, "league_1"));

    expect(league?.name).toBe("Sunday Money");
    expect(league?.format).toBe("snake");
    expect(leagueTeams).toHaveLength(1);
    expect(leagueTeams[0]?.name).toBe("The Commish");
    expect(scoring?.pointsPerReception).toBe(1);
  });

  it("rejects a second team for the same user in the same league", async () => {
    await db.insert(users).values({
      id: "user_1",
      email: "jh@example.com",
      displayName: "JH",
    });
    await db.insert(leagues).values({
      id: "league_1",
      name: "L",
      format: "auction",
      teamCount: 10,
      commissionerUserId: "user_1",
    });
    await db.insert(teams).values({ id: "team_1", leagueId: "league_1", userId: "user_1", name: "A" });

    await expect(
      db.insert(teams).values({ id: "team_2", leagueId: "league_1", userId: "user_1", name: "B" }),
    ).rejects.toThrow();
  });

  it("rejects duplicate emails", async () => {
    await db.insert(users).values({ id: "u1", email: "dup@example.com", displayName: "A" });
    await expect(
      db.insert(users).values({ id: "u2", email: "dup@example.com", displayName: "B" }),
    ).rejects.toThrow();
  });
});

const LEAGUE_ID = "league_invite_lineup";
const USER_ID = "user_invite_lineup";
const TEAM_ID = "team_invite_lineup";

/** Inserts a user, the league they commission, and their team — the fixture `league_invites` and `lineup_slots` hang off. */
async function seedLeague(): Promise<void> {
  await db.insert(users).values({ id: USER_ID, email: "invite-lineup@example.com", displayName: "Invite Lineup" });
  await db.insert(leagues).values({
    id: LEAGUE_ID,
    name: "Invite Lineup League",
    format: "snake",
    teamCount: 12,
    commissionerUserId: USER_ID,
  });
  await db.insert(teams).values({ id: TEAM_ID, leagueId: LEAGUE_ID, userId: USER_ID, name: "Fixture Team" });
}

/**
 * FINAL WHOLE-BRANCH REVIEW, F5 — THE GUARD NOTHING MEASURED.
 *
 * `leagues_house_commissioner_ck` (`drizzle/0032_house_leagues.sql`) is what makes "exactly one of
 * `commissioner_user_id` and `house_rung`" a fact about the DATABASE rather than a habit of the
 * two writers. Task 16's own mandate asked for this proof and it never landed: the constraint had
 * unit coverage only through `leagueAuthority` (`@/league-service/authority`), which THROWS on
 * either violating shape — and it throws on EVERY league read, for every member of that league,
 * forever. So the CHECK is the sole thing standing between one bad row and a permanent 500 on a
 * whole league, and "the DDL says so" is not a test.
 *
 * Both shapes, at the database, through drizzle's own insert path (each is type-valid: both
 * columns are nullable), asserting the CONSTRAINT'S NAME rather than just "it threw" — the same
 * reason `isUniqueViolation` (`./errors`) keys on a name: 23514 is the generic check-violation
 * code, and any other check on this table raises it too.
 */
describe("leagues_house_commissioner_ck", () => {
  it("refuses a league that names BOTH a commissioner and a house rung", async () => {
    await db.insert(users).values({ id: "user_ck", email: "ck@example.com", displayName: "CK" });

    await expectCheckViolation(
      db.insert(leagues).values({
        id: "league_ck_both",
        name: "Both",
        format: "snake",
        teamCount: 12,
        commissionerUserId: "user_ck",
        houseRung: "open_12",
      }),
      "leagues_house_commissioner_ck",
    );
    expect(await db.select().from(leagues)).toEqual([]);
  });

  it("refuses a league that names NEITHER a commissioner nor a house rung", async () => {
    await expectCheckViolation(
      db.insert(leagues).values({
        id: "league_ck_neither",
        name: "Neither",
        format: "snake",
        teamCount: 12,
        commissionerUserId: null,
        houseRung: null,
      }),
      "leagues_house_commissioner_ck",
    );
    expect(await db.select().from(leagues)).toEqual([]);
  });

  it("accepts each of the two legal shapes", async () => {
    // The other half of a constraint test: a rule that refuses everything is not the rule.
    await db.insert(users).values({ id: "user_ck_ok", email: "ck-ok@example.com", displayName: "CK OK" });
    await db.insert(leagues).values({
      id: "league_ck_member", name: "Member", format: "snake", teamCount: 12, commissionerUserId: "user_ck_ok",
    });
    await db.insert(leagues).values({
      id: "league_ck_house", name: "House", format: "snake", teamCount: 12, commissionerUserId: null, houseRung: "open_12",
    });

    const rows = await db.select({ id: leagues.id }).from(leagues);
    expect(rows.map((row) => row.id).sort()).toEqual(["league_ck_house", "league_ck_member"]);
  });
});

/**
 * PHASE 4.5, TASK 2 REVIEW (HIGH, fix round 1) — THE SAME GUARD, FOR THE SAME REASON.
 *
 * `isMock`'s own docblock (`./schema.ts`) states "every mock ships `is_public_matchmade = false`"
 * as the load-bearing fact that lets `ENFORCED_LEAGUE_SQL` (`@/league-service/enforcement`)
 * exclude a mock from browse, the wire and the proof strip's 48h/next-draft reads BY
 * CONSTRUCTION. Until `leagues_mock_private_ck` (migration `0042`) existed, that fact was
 * conventional — upheld only by every writer remembering to set both columns in step. A future
 * mock writer that set `is_public_matchmade: true` would silently leak a mock into every
 * `ENFORCED_LEAGUE_SQL` consumer with no test anywhere failing, because none of those consumers
 * know a mock exists — they trust the predicate they already have. The identical
 * `leagues_house_commissioner_ck` precedent above: an invariant load-bearing enough to sit in
 * prose belongs in the DDL, not in a writer's discipline.
 */
describe("leagues_mock_private_ck", () => {
  it("refuses a mock league declared public-matchmade", async () => {
    await db.insert(users).values({ id: "user_mck", email: "mck@example.com", displayName: "MCK" });

    await expectCheckViolation(
      db.insert(leagues).values({
        id: "league_mck_public_mock",
        name: "Leaky Mock",
        format: "snake",
        teamCount: 12,
        commissionerUserId: "user_mck",
        isMock: true,
        isPublicMatchmade: true,
      }),
      "leagues_mock_private_ck",
    );
    expect(await db.select().from(leagues)).toEqual([]);
  });

  it("accepts the one legal mock shape, and an ordinary public league untouched", async () => {
    // The other half of a constraint test: a rule that refuses everything is not the rule.
    await db.insert(users).values({ id: "user_mck_ok", email: "mck-ok@example.com", displayName: "MCK OK" });
    await db.insert(leagues).values({
      id: "league_mck_private_mock", name: "Practice Room", format: "snake", teamCount: 12,
      commissionerUserId: "user_mck_ok", isMock: true, isPublicMatchmade: false,
    });
    // `isMock` false makes the CHECK's left side true regardless of `isPublicMatchmade` — a real
    // public league is untouched by this constraint, the exact shape this row proves.
    await db.insert(leagues).values({
      id: "league_mck_real_public", name: "Open Room", format: "snake", teamCount: 12,
      commissionerUserId: "user_mck_ok", isMock: false, isPublicMatchmade: true,
    });

    const rows = await db.select({ id: leagues.id }).from(leagues);
    expect(rows.map((row) => row.id).sort()).toEqual(["league_mck_private_mock", "league_mck_real_public"]);
  });
});

describe("league_invites and lineup_slots", () => {
  it("stores an invite and enforces one row per code", async () => {
    await seedLeague();
    await db.insert(leagueInvites).values({
      code: "SUNDAY12",
      leagueId: LEAGUE_ID,
      createdByUserId: USER_ID,
      expiresAt: new Date("2026-09-30T00:00:00.000Z"),
      maxUses: 12,
    });
    const [row] = await db.select().from(leagueInvites).where(eq(leagueInvites.code, "SUNDAY12"));
    expect(row).toMatchObject({ leagueId: LEAGUE_ID, maxUses: 12, uses: 0 });
    await expect(
      db.insert(leagueInvites).values({
        code: "SUNDAY12", leagueId: LEAGUE_ID, createdByUserId: USER_ID,
        expiresAt: new Date("2026-09-30T00:00:00.000Z"), maxUses: 1,
      }),
    ).rejects.toThrow();
  });

  it("stores one lineup row per team, week and slot", async () => {
    await seedLeague();
    await db.insert(lineupSlots).values([
      { teamId: TEAM_ID, weekNumber: 1, slot: "QB", slotIndex: 0, playerId: "qb1" },
      { teamId: TEAM_ID, weekNumber: 2, slot: "QB", slotIndex: 0, playerId: "qb2" },
    ]);
    const rows = await db.select().from(lineupSlots).where(eq(lineupSlots.teamId, TEAM_ID));
    expect(rows).toHaveLength(2);
    await expect(
      db.insert(lineupSlots).values({ teamId: TEAM_ID, weekNumber: 1, slot: "QB", slotIndex: 0, playerId: "qb3" }),
    ).rejects.toThrow();
  });

  it("drops both when the league goes away", async () => {
    await seedLeague();
    await db.insert(leagueInvites).values({
      code: "GONE1234", leagueId: LEAGUE_ID, createdByUserId: USER_ID,
      expiresAt: new Date("2026-09-30T00:00:00.000Z"), maxUses: 1,
    });
    await db.insert(lineupSlots).values({ teamId: TEAM_ID, weekNumber: 1, slot: "QB", slotIndex: 0, playerId: "qb1" });
    await db.delete(leagues).where(eq(leagues.id, LEAGUE_ID));
    expect(await db.select().from(leagueInvites)).toEqual([]);
    expect(await db.select().from(lineupSlots)).toEqual([]);
  });
});

describe("stat_weeks", () => {
  it("round-trips the enum's three values and the row's defaults", async () => {
    await db.insert(statWeeks).values({ week: 1 });
    await db.insert(statWeeks).values({ week: 2, status: "in_progress" });
    await db.insert(statWeeks).values({ week: 3, status: "final", version: 5, gamesTotal: 16, gamesFinal: 16 });

    const [scheduled] = await db.select().from(statWeeks).where(eq(statWeeks.week, 1));
    expect(scheduled).toMatchObject({ status: "scheduled", version: 0, gamesTotal: 0, gamesFinal: 0 });

    const [inProgress] = await db.select().from(statWeeks).where(eq(statWeeks.week, 2));
    expect(inProgress?.status).toBe("in_progress");

    const [final] = await db.select().from(statWeeks).where(eq(statWeeks.week, 3));
    expect(final).toMatchObject({ status: "final", version: 5, gamesTotal: 16, gamesFinal: 16 });

    await expect(db.insert(statWeeks).values({ week: 1 })).rejects.toThrow();
  });
});

describe("user_preferences", () => {
  it("defaults to guided help and an undismissed tour, one row per user", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@example.com", displayName: "u1" });
    await db.insert(userPreferences).values({ userId: "u1" });

    const [row] = await db.select().from(userPreferences).where(eq(userPreferences.userId, "u1"));
    expect(row).toMatchObject({ userId: "u1", helpLevel: "guided", draftTourDismissedAt: null });

    await expect(db.insert(userPreferences).values({ userId: "u1" })).rejects.toThrow();
  });

  it("round-trips the standard help level and a dismissal timestamp", async () => {
    await db.insert(users).values({ id: "u2", email: "u2@example.com", displayName: "u2" });
    await db.insert(userPreferences).values({
      userId: "u2",
      helpLevel: "standard",
      draftTourDismissedAt: new Date("2026-08-19T00:00:00.000Z"),
    });

    const [row] = await db.select().from(userPreferences).where(eq(userPreferences.userId, "u2"));
    expect(row?.helpLevel).toBe("standard");
    expect(row?.draftTourDismissedAt?.toISOString()).toBe("2026-08-19T00:00:00.000Z");
  });

  it("drops the preferences row when the user goes away", async () => {
    await db.insert(users).values({ id: "u3", email: "u3@example.com", displayName: "u3" });
    await db.insert(userPreferences).values({ userId: "u3" });
    await db.delete(users).where(eq(users.id, "u3"));
    expect(await db.select().from(userPreferences).where(eq(userPreferences.userId, "u3"))).toEqual([]);
  });
});

describe("reviews", () => {
  it("enforces one review per user", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@example.com", displayName: "u1" });
    await db.insert(reviews).values({ id: "r1", userId: "u1", rating: 5, body: "Great platform, no complaints at all." });
    await expect(
      db.insert(reviews).values({ id: "r2", userId: "u1", rating: 1, body: "Changed my mind, this is terrible now." }),
    ).rejects.toThrow();
  });

  it("round-trips the removal stamp without deleting the row", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@example.com", displayName: "u1" });
    await db.insert(users).values({ id: "operator", email: "operator@example.com", displayName: "operator" });
    await db.insert(reviews).values({ id: "r1", userId: "u1", rating: 1, body: "This league ate my roster overnight." });
    await db
      .update(reviews)
      .set({ removedAt: new Date("2026-08-19T00:00:00.000Z"), removedByUserId: "operator", removalReason: "spam" })
      .where(eq(reviews.id, "r1"));

    const [row] = await db.select().from(reviews).where(eq(reviews.id, "r1"));
    expect(row).toMatchObject({
      userId: "u1",
      body: "This league ate my roster overnight.",
      removedByUserId: "operator",
      removalReason: "spam",
    });
    expect(row?.removedAt?.toISOString()).toBe("2026-08-19T00:00:00.000Z");
  });

  it("drops a user's review when the user goes away", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@example.com", displayName: "u1" });
    await db.insert(reviews).values({ id: "r1", userId: "u1", rating: 3, body: "Solid league, would recommend to friends." });
    await db.delete(users).where(eq(users.id, "u1"));
    expect(await db.select().from(reviews).where(eq(reviews.id, "r1"))).toEqual([]);
  });
});

describe("review_reports", () => {
  it("is idempotent by the (review, reporter) pair, and drops when the review goes away", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@example.com", displayName: "u1" });
    await db.insert(users).values({ id: "u2", email: "u2@example.com", displayName: "u2" });
    await db.insert(reviews).values({ id: "r1", userId: "u1", rating: 1, body: "This league ate my roster overnight." });
    await db.insert(reviewReports).values({ reviewId: "r1", reporterUserId: "u2", reason: "spam" });
    await expect(
      db.insert(reviewReports).values({ reviewId: "r1", reporterUserId: "u2", reason: "abusive" }),
    ).rejects.toThrow();

    await db.delete(reviews).where(eq(reviews.id, "r1"));
    expect(await db.select().from(reviewReports)).toEqual([]);
  });
});
