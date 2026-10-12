import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { buildPeekDocument } from "@/league-service/peek/peek-document";
import type { Db } from "@research-ts/db/client";
import { players } from "@research-ts/db/schema";
import { drafts, leagues, matchups, playerPeekDocuments, rosterSlots, teams, users, weeks } from "@/db/schema";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { BOARD_SOURCE } from "@research-ts/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@research-ts/projections/preseason/current";
import { createLeague } from "./creation";
import { playerSeason } from "./player";

/**
 * THE THREE LIVE LEAGUE FACTS, AGAINST A REAL DATABASE (2026-09-11).
 *
 * `playerSeason` answers in one statement by hanging three correlated scalars off the league row:
 * how long this league's season is, where its draft stands, and who holds this player right now.
 * All three are hand-written SQL, which buys the qualification Drizzle will not always render (see
 * that file's own docblock on the 42702 this test exists because of) and costs the compile-time
 * safety a column reference would have given. This test is the other half of that bargain: rename a
 * column those fragments name and it fails here, loudly, against Postgres.
 *
 * IT EXERCISES THE MISS PATH ON PURPOSE. `leagueFactsFor` reads `leagues` ALONE — no join — and that
 * is exactly the query shape where Drizzle dropped every table qualifier and the statement stopped
 * parsing. A league with no peek document is the shape a fresh league always has, so this is not a
 * corner: it is the first read of every new league in the product.
 *
 * `dissolved` and `in_progress` ride along because the phase is what the player header's one verb
 * turns on, and a boolean here was the bug fix round 2 landed.
 */

const NOW = new Date("2026-09-11T12:00:00.000Z");
const clock = { now: () => NOW.toISOString() };

const SLOTS = [
  { slot: "RB" as const, count: 1, eligiblePositions: ["RB" as const] },
  { slot: "BENCH" as const, count: 1, eligiblePositions: ["RB" as const] },
];

let nextId = 0;

/** The league both managers sit in, plus the one player this test hands around. */
async function seedLeague(db: Db): Promise<{ readonly leagueId: string; readonly teamIds: readonly string[] }> {
  await db.insert(users).values([
    { id: "u_holder", email: "holder@test.local", displayName: "Dana Whitfield", avatarUrl: "preset:owl" },
    { id: "u_reader", email: "reader@test.local", displayName: "Rey Okafor" },
  ]);
  const created = await createLeague({ db, clock, newId: () => `lf_${++nextId}` }, {
    name: "Live Facts League", format: "snake", teamCount: 2, scoringPreset: "ppr", auctionBudget: null,
    rosterSlots: SLOTS, owner: { kind: "member", userId: "u_holder", teamName: "Iron Owls" },
    experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false, medianGame: false, isMock: false,
  });
  if (!created.ok) throw new Error(created.reason);

  const [readerTeam] = await db.insert(teams).values({ id: "lf_team_reader", leagueId: created.leagueId, userId: "u_reader", name: "Turf Burners" }).returning();
  const seated = await db.select({ id: teams.id }).from(teams).where(eq(teams.leagueId, created.leagueId));
  await db.insert(players).values({ id: "rb_live", name: "James Cook", position: "RB", nflTeam: "BUF" });
  return { leagueId: created.leagueId, teamIds: [...seated.map((team) => team.id), readerTeam!.id] };
}

/** Three played weeks, as `seasonProgress` would find them: a `weeks` row and a fixture each. */
async function seedThreeWeeks(db: Db, leagueId: string, home: string, away: string): Promise<void> {
  await db.insert(weeks).values([1, 2, 3].map((weekNumber) => ({ leagueId, weekNumber })));
  await db.insert(matchups).values([1, 2, 3].map((weekNumber) => ({ leagueId, weekNumber, homeTeamId: home, awayTeamId: away })));
}

describe("the live league facts the peek reads in its own statement", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
  });

  it("answers the draft phase, the week count and the holder, all at once, off a real league", async () => {
    const { leagueId } = await seedLeague(db);
    const [ownerTeam] = await db.select({ id: teams.id }).from(teams).where(eq(teams.userId, "u_holder"));
    const [readerTeam] = await db.select({ id: teams.id }).from(teams).where(eq(teams.userId, "u_reader"));
    await seedThreeWeeks(db, leagueId, ownerTeam!.id, readerTeam!.id);
    // `createLeague` writes the league's one `drafts` row itself (unique per league), so the phase
    // is set by moving that row rather than by inserting a second one.
    await db.update(drafts).set({ status: "complete" }).where(eq(drafts.leagueId, leagueId));
    await db.insert(rosterSlots).values({ teamId: ownerTeam!.id, playerId: "rb_live", slot: "RB", slotIndex: 0 });

    // The MISS path: nothing has written a peek document for this league's hash, which is the
    // single-table query shape the qualification bug lived in.
    const body = await playerSeason(db, leagueId, "rb_live", clock, undefined, "u_reader");
    expect(body).not.toBeNull();

    // 1. The draft's own status, read through `drafts.status` and mapped to the body's three states.
    expect(body!.draftPhase).toBe("complete");

    // 3. Who holds him, as a person: the team, the manager behind it, and his stored avatar ref.
    expect(body!.ownedBy).toBe("Iron Owls");
    expect(body!.owner).toEqual({
      teamId: ownerTeam!.id,
      teamName: "Iron Owls",
      managerName: "Dana Whitfield",
      managerAvatar: "preset:owl",
      // The reader plays him in week 1, the league's current week, so he is the rival.
      relation: "rival",
    });
  });


  /**
   * THE WEEK COUNT, WHERE IT IS OBSERVABLE. `scheduledWeeks` does one job: it CAPS the current
   * season's axis, so a fourteen-week league never draws a week it does not play. The only way to
   * see it from the outside is to hand the read a document that holds more weeks than the league
   * has fixtures and watch the extra ones go — which also exercises the JOINED statement, the other
   * of the two query shapes those correlated scalars are rendered into.
   *
   * A zero would have fallen back to `LEAGUE_CONFIG.regularSeasonWeeks` (17) and quietly kept all
   * five, which is exactly how a silently-broken count hides.
   */
  it("caps the season's weeks to the fixtures the league actually holds", async () => {
    const { leagueId } = await seedLeague(db);
    const [ownerTeam] = await db.select({ id: teams.id }).from(teams).where(eq(teams.userId, "u_holder"));
    const [readerTeam] = await db.select({ id: teams.id }).from(teams).where(eq(teams.userId, "u_reader"));
    await seedThreeWeeks(db, leagueId, ownerTeam!.id, readerTeam!.id);

    // The first read is a miss, and writes the league's own scoring hash — which is the key the
    // document below has to be stored under for the joined statement to find it.
    await playerSeason(db, leagueId, "rb_live", clock);
    const [league] = await db.select({ hash: leagues.scoringHash }).from(leagues).where(eq(leagues.id, leagueId));

    const basis = { scoringHash: league!.hash!, factsAsOf: null, capsuleGeneratedAt: null, capsuleFactsHash: null, injuryCapturedAt: null, newsCapturedAt: null, lastFinalizedWeek: null, sourceKeys: [] };
    const document = buildPeekDocument({
      player: { id: "rb_live", name: "James Cook", position: "RB", nflTeam: "BUF", headshotUrl: null, adp: null },
      isRookie: false, positionRank: null, adpPercentile: null, expertRank: null, modelRank: null,
      injuryDesignation: null, news: [], reasons: [], capsule: null, dossier: null, asOf: NOW,
      seasons: [{
        season: PRODUCT_SEASON,
        stats: {
          weeks: [1, 2, 3, 4, 5].map((week) => ({ week, points: 10 + week, percentile: null })),
          pointsPerGame: 13, pointsPerGamePercentile: null, log: [], totals: null,
        },
      }],
      basis,
    });
    await db.insert(playerPeekDocuments).values({ season: PRODUCT_SEASON, scoringHash: league!.hash!, playerId: "rb_live", asOf: NOW, document, basis, source: BOARD_SOURCE });

    const body = await playerSeason(db, leagueId, "rb_live", clock);
    expect(body!.weeks.map((week) => week.week)).toEqual([1, 2, 3]);
  });

  it("reads a running draft as live and a scheduled one as pre-draft, never as the same thing", async () => {
    const { leagueId } = await seedLeague(db);
    await db.update(drafts).set({ status: "scheduled" }).where(eq(drafts.leagueId, leagueId));
    expect((await playerSeason(db, leagueId, "rb_live", clock))!.draftPhase).toBe("predraft");

    await db.update(drafts).set({ status: "in_progress" }).where(eq(drafts.leagueId, leagueId));
    expect((await playerSeason(db, leagueId, "rb_live", clock))!.draftPhase).toBe("live");

    await db.update(drafts).set({ status: "complete" }).where(eq(drafts.leagueId, leagueId));
    expect((await playerSeason(db, leagueId, "rb_live", clock))!.draftPhase).toBe("complete");
  });

  /** A league with no `drafts` row at all. The scalar answers `null` and the body reads pre-draft —
   *  the honest answer, and the one the old `where "league_id" = "id"` returned for every league by
   *  accident rather than on purpose. */
  it("reads a league with no draft row as pre-draft, and nobody as a free agent", async () => {
    const { leagueId } = await seedLeague(db);
    await db.delete(drafts).where(eq(drafts.leagueId, leagueId));
    const body = await playerSeason(db, leagueId, "rb_live", clock, undefined, "u_reader");
    expect(body!.draftPhase).toBe("predraft");
    expect(body!.owner).toBeNull();
    expect(body!.ownedBy).toBeNull();
  });

  /** The reader's OWN player wears the amber ring, not the rose one, and the distinction is a real
   *  join through `teams.user_id` rather than a string compare on a team name. */
  it("calls the reader's own team yours, and another manager with no fixture between them other", async () => {
    const { leagueId } = await seedLeague(db);
    const [readerTeam] = await db.select({ id: teams.id }).from(teams).where(eq(teams.userId, "u_reader"));
    await db.insert(rosterSlots).values({ teamId: readerTeam!.id, playerId: "rb_live", slot: "RB", slotIndex: 0 });

    const mine = await playerSeason(db, leagueId, "rb_live", clock, undefined, "u_reader");
    expect(mine!.owner?.relation).toBe("you");
    expect(mine!.owner?.managerName).toBe("Rey Okafor");

    // Read by the OTHER manager, with no schedule between them: another manager's player, no ring.
    const theirs = await playerSeason(db, leagueId, "rb_live", clock, undefined, "u_holder");
    expect(theirs!.owner?.relation).toBe("other");
  });
});
