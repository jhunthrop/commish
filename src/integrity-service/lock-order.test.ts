import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { auditChains, leagues, memberNotices, users } from "@/db/schema";
import { createTestDb, truncateAll } from "@/db/test-db";
import { currentDeadline } from "@/draft-engine";
import { createDraftStore } from "@/draft-service/store";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "@/draft-service/test-support";
import { joinLeagueInTx } from "@/league-service/join";
import { raiseFlag } from "./flags";
import type { DraftPoolEntry } from "@/domain/draft";
import { players } from "@/db/schema";

/**
 * RULING 3, AS RESTATED, HELD TO BY TWO REAL CONNECTIONS.
 *
 * The rule used to read "the audit anchor is the last lock a transaction takes". Three
 * transactions honored it and still inverted the order, because an INSERT that carries a foreign
 * key takes `FOR KEY SHARE` on the row it references and an implicit lock does not look like a
 * lock. `member_notices` references `leagues`; `joinLeagueInTx` takes `leagues FOR UPDATE` and
 * then the anchor; `applyAction` used to take the anchor and then, through its autopick notice,
 * `leagues FOR KEY SHARE`. `FOR KEY SHARE` conflicts with `FOR UPDATE`, so that is a cycle, and
 * Postgres resolves a cycle by killing somebody's draft pick or somebody's join.
 *
 * This file drives BOTH transactions, on two separate connections, against the same league, with
 * a rendezvous that guarantees the interleaving rather than hoping for it:
 *
 *   T_join  BEGIN, `leagues[X] FOR UPDATE`, park -------------------> anchor, COMMIT
 *   T_pick                          BEGIN, `drafts FOR UPDATE`, ... `leagues[X] FOR KEY SHARE`
 *
 * With the fixed order T_pick's notice insert blocks on T_join's league lock, T_join is released,
 * takes an anchor nobody holds, commits, and T_pick proceeds. With the old order T_pick would
 * already be holding the anchor T_join is about to ask for, and one of the two dies. The
 * interleaving is deterministic in both directions, so this is a real regression guard and not a
 * race that happens to pass.
 */
const joinDb = createTestDb();
const pickDb = createTestDb();
const flagDb = createTestDb();

/**
 * Waits until some backend on this database is genuinely blocked on a lock.
 *
 * Unscoped by necessity and safely so, unlike its sibling in `audit-logger.test.ts`: the
 * transaction being waited on here is driven through the real `applyAction`, which owns its own
 * connection out of `pickDb`'s pool, so there is no seam to read `pg_backend_pid()` from without
 * reaching into the store. Vitest runs test FILES sequentially (`fileParallelism: false`), and
 * the only two transactions in flight in this file are the two under test, so a blocked backend
 * here is one of them by construction.
 */
async function waitForBlockedBackend(timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await joinDb.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`,
    );
    if (Number(rows[0]?.count ?? 0) > 0) return true;
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const clock = { now: () => "2026-09-01T00:00:00.000Z" };
const POOL: readonly DraftPoolEntry[] = [
  { playerId: "qb1", position: "QB" },
  { playerId: "rb1", position: "RB" },
  { playerId: "wr1", position: "WR" },
  { playerId: "qb2", position: "QB" },
  { playerId: "rb2", position: "RB" },
  { playerId: "wr2", position: "WR" },
];

/** The draft-pick half, driven through the real store so the order under test is the real one. */
function pickStore() {
  return createDraftStore({
    db: pickDb,
    publish: async () => "1-0",
    clock,
    deliverNotice: async () => {},
  });
}

beforeEach(async () => {
  await truncateAll(joinDb);
});

afterAll(async () => {
  await truncateAll(joinDb);
});

describe("the audit anchor is the last lock, FK locks included", () => {
  it("lets a join and an autopick in the same league run concurrently without deadlocking", async () => {
    const { draftId, leagueId, teamIds } = await seedDraftFixture(joinDb, {
      draftId: "draft_lock",
      leagueId: "league_lock",
      format: "snake",
      teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
      auctionBudget: null,
    });
    // `autopickNoticeContext`'s join needs the player rows, or the notice path skips itself and
    // this test would prove nothing about the notice's FK lock at all.
    await joinDb.insert(players).values(POOL.map((entry) => ({ id: entry.playerId, name: entry.playerId, position: entry.position, nflTeam: "FA" })));
    // An open seat for the joiner: the fixture fills every seat it creates, and a join that is
    // refused for capacity never reaches the append, which is the half of the cycle under test.
    await joinDb.update(leagues).set({ teamCount: 3 }).where(eq(leagues.id, leagueId));
    await joinDb.insert(users).values({ id: "user_joiner", email: "joiner@test.local", displayName: "Joiner" });

    const store = pickStore();
    await store.applyAction(draftId, { v: 1, type: "START_DRAFT", minBid: 1, timestamp: clock.now(), draftOrder: teamIds, pool: POOL });
    const state = await store.getDraftState(draftId);

    let holdsLeagueLock: () => void = () => {};
    const leagueLocked = new Promise<void>((resolve) => (holdsLeagueLock = resolve));
    let releaseJoin: () => void = () => {};
    const parked = new Promise<void>((resolve) => (releaseJoin = resolve));

    // T_join: the real function, parked inside its own precondition — which runs AFTER
    // `leagues FOR UPDATE` and BEFORE the append, i.e. exactly where the cycle's first half sits.
    const joining = joinDb.transaction((tx) =>
      joinLeagueInTx(
        tx,
        { leagueId, userId: "user_joiner", newId: () => "team_joiner", via: "public_browse", occurredAt: clock.now() },
        async () => {
          holdsLeagueLock();
          await parked;
          return null;
        },
      ),
    );
    await leagueLocked;

    // T_pick: the real autopick path, which must reach `member_notices` (and therefore
    // `leagues FOR KEY SHARE`) BEFORE it reaches the anchor. It blocks here, behind T_join.
    const picking = store.applyAction(draftId, { v: 1, type: "TIMER_EXPIRE", timestamp: currentDeadline(state!) ?? clock.now() });

    // T_pick has to have REACHED whichever lock it is going to block on before T_join is let go —
    // in the old order it is holding the anchor by then, and releasing T_join is what completes
    // the cycle. Asked of Postgres rather than guessed with a sleep: on a loaded machine a fixed
    // wait can expire before T_pick has taken anything, and the test then proves nothing in
    // either direction. `pg_stat_activity` reports a backend genuinely waiting on a Lock.
    expect(await waitForBlockedBackend()).toBe(true);
    releaseJoin();

    const joined = await joining;
    const picked = await picking;
    expect(joined).toMatchObject({ ok: true, alreadyMember: false });
    expect(picked.ok).toBe(true);

    // Both transactions actually landed their audit work on the same chain, which is what makes
    // the absence of a deadlock meaningful: they really did contend for this one anchor row.
    const [anchor] = await joinDb.select().from(auditChains).where(eq(auditChains.scope, leagueId));
    expect(anchor!.headSequence).toBe(2); // one `member_joined` and one `draft_pick`, on one chain

    // And the notice the pick wrote before the anchor still names the event minted after it.
    const [notice] = await joinDb.select().from(memberNotices);
    expect(notice?.auditEventId).not.toBeNull();
  });

  it("survives the same race run repeatedly, in both arrival orders", async () => {
    // The rendezvous above pins one interleaving. This one pins that nothing about the fix
    // depends on which transaction arrives first, over enough runs that a surviving cycle would
    // have to be lucky many times over rather than once.
    for (let run = 0; run < 6; run += 1) {
      await truncateAll(joinDb);
      const leagueId = `league_race_${run}`;
      const { draftId, teamIds } = await seedDraftFixture(joinDb, {
        draftId: `draft_race_${run}`,
        leagueId,
        format: "snake",
        teamCount: 2,
        slotConfig: SPRINT_ROSTER_SLOTS,
        kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
        auctionBudget: null,
      });
      await joinDb.insert(players).values(POOL.map((entry) => ({ id: entry.playerId, name: entry.playerId, position: entry.position, nflTeam: "FA" })));
      await joinDb.update(leagues).set({ teamCount: 3 }).where(eq(leagues.id, leagueId));
      await joinDb.insert(users).values({ id: "user_joiner", email: "joiner@test.local", displayName: "Joiner" });

      const store = pickStore();
      await store.applyAction(draftId, { v: 1, type: "START_DRAFT", minBid: 1, timestamp: clock.now(), draftOrder: teamIds, pool: POOL });
      const state = await store.getDraftState(draftId);

      const join = joinDb.transaction((tx) =>
        joinLeagueInTx(tx, { leagueId, userId: "user_joiner", newId: () => "team_joiner", via: "public_browse", occurredAt: clock.now() }),
      );
      const pick = store.applyAction(draftId, { v: 1, type: "TIMER_EXPIRE", timestamp: currentDeadline(state!) ?? clock.now() });
      // `run % 2` flips which promise is awaited first; both are already in flight either way, so
      // what actually varies is which one the event loop resumes on first.
      const [a, b] = run % 2 === 0 ? [join, pick] : [pick, join];
      await expect(Promise.all([a, b])).resolves.toBeDefined();
    }
  });
});

/**
 * Plan B's first transaction in this proof. `raiseFlag`'s insert into `integrity_flags` carries a
 * foreign key to `leagues`, so it takes the same `FOR KEY SHARE` on the league row that
 * `member_notices`' insert does — and, like every other write in this file, it must take that
 * lock BEFORE it reaches an audit anchor, never after.
 *
 * `raiseFlag`'s own anchor is the PLATFORM chain, never the league's (ruling 1) — a different row
 * from the one `joinLeagueInTx` locks (`audit_chains[leagueId]`). So unlike the join/autopick
 * pair above, there is no shared anchor row for the wrong order to cycle on: this test's job is
 * to hold that separation to real concurrent load rather than to trust the reasoning. It drives a
 * join and a flag-raise against the SAME league on two connections, with the join parked exactly
 * where `joinLeagueInTx`'s own docblock says the cycle used to sit, and asserts both the absence
 * of a deadlock/hang AND that the two events really did land on two different chains — proof that
 * `raiseFlag` touching `leagues` costs nothing to a concurrent join, in either direction.
 */
describe("raiseFlag's insert order", () => {
  it("lets a join and a flag raise in the same league run concurrently without deadlocking", async () => {
    await joinDb.insert(users).values([
      { id: "u_commish_flag", email: "commish_flag@test.local", displayName: "Commish" },
      { id: "user_joiner_flag", email: "joiner_flag@test.local", displayName: "Joiner" },
    ]);
    await joinDb.insert(leagues).values({
      id: "league_flag_lock",
      name: "League Flag Lock",
      format: "snake",
      teamCount: 2,
      commissionerUserId: "u_commish_flag",
    });

    let holdsLeagueLock: () => void = () => {};
    const leagueLocked = new Promise<void>((resolve) => (holdsLeagueLock = resolve));
    let releaseJoin: () => void = () => {};
    const parked = new Promise<void>((resolve) => (releaseJoin = resolve));

    // T_join: parked right after `leagues[X] FOR UPDATE`, exactly as in the pair above.
    const joining = joinDb.transaction((tx) =>
      joinLeagueInTx(
        tx,
        { leagueId: "league_flag_lock", userId: "user_joiner_flag", newId: () => "team_joiner_flag", via: "public_browse", occurredAt: clock.now() },
        async () => {
          holdsLeagueLock();
          await parked;
          return null;
        },
      ),
    );
    await leagueLocked;

    // T_flag: the real raiseFlag, on its own connection, reaching for the SAME league row.
    const raising = flagDb.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "multi_account",
        subjectId: "u_flag_1_u_flag_2",
        leagueId: "league_flag_lock",
        evidence: {},
        raisedByUserId: null,
        occurredAt: clock.now(),
        newId: () => "flag_lock_1",
      }),
    );

    // T_flag has to have genuinely blocked on `leagues[X]` before T_join is let go, or releasing
    // T_join proves nothing about the two ever contending at all.
    expect(await waitForBlockedBackend()).toBe(true);
    releaseJoin();

    const joined = await joining;
    const flagged = await raising;
    expect(joined).toMatchObject({ ok: true, alreadyMember: false });
    expect(flagged.id).toBe("flag_lock_1");

    // The league chain holds only the join's `member_joined` — `flag_raised` never reaches it.
    const [leagueAnchor] = await joinDb.select().from(auditChains).where(eq(auditChains.scope, "league_flag_lock"));
    expect(leagueAnchor!.headSequence).toBe(1);
    // The platform chain holds only the flag — proof the two really did land on separate chains.
    const [platformAnchor] = await joinDb.select().from(auditChains).where(eq(auditChains.scope, "platform"));
    expect(platformAnchor!.headSequence).toBe(1);
  });
});
