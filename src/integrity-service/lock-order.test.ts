import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { auditChains, chatMessages, drafts, leagues, memberNotices, playerStatLines, reviews, rosterSlots, sessionSignals, statWeeks, teams, tradeProposals, users } from "@/db/schema";
import { createTestDb, truncateAll } from "@/db/test-db";
import { currentDeadline } from "@/draft-engine";
import { createDraftStore } from "@/draft-service/store";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "@/draft-service/test-support";
import { joinLeagueInTx } from "@/league-service/join";
import { writeSchedule } from "@/league-service/schedule";
import { acceptTrade, proposeTrade, rejectTrade } from "@/league-service/trades";
import type { StatLine } from "@/domain/player";
import { correctSettledWeek } from "@/stats-pipeline/correction";
import { finalizeWeek } from "@/stats-pipeline/finalize";
import { fakeStatsProvider } from "@/stats-pipeline/test-support";
import { syncUserFromWorkOS } from "@/lib/auth/user-sync";
import { reportMessage } from "@/chat-service/moderation";
import { reportReview } from "@/review-service/reviews";
import { raiseFlag, resolveFlag } from "./flags";
import { grantAdmin } from "./grant-admin";
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
const resolveDb = createTestDb();

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

/**
 * Task 3's own transaction in this proof. `resolveFlag`'s `warned_user` branch inserts a member
 * notice BEFORE its anchor, exactly like `raiseFlag`'s insert above and `grantAdmin`'s grant
 * branch — the same implicit `leagues FOR KEY SHARE` a concurrent join might be holding
 * `FOR UPDATE`. This drives a real join and a real flag RESOLUTION (on a real chat message, with
 * a real author to notice) against the SAME league on two connections, with the join parked
 * exactly where the cycle used to sit, and asserts no deadlock plus the correct chain split: the
 * league chain holds only the join, the platform chain holds the setup's `flag_raised` and this
 * transaction's own `flag_resolved`.
 */
describe("resolveFlag's notice order", () => {
  it("lets a join and a flag resolution in the same league run concurrently without deadlocking", async () => {
    await joinDb.insert(users).values([
      { id: "u_commish_resolve", email: "commish_resolve@test.local", displayName: "Commish" },
      { id: "user_joiner_resolve", email: "joiner_resolve@test.local", displayName: "Joiner" },
      { id: "u_member_resolve", email: "member_resolve@test.local", displayName: "Member" },
      { id: "u_op_resolve", email: "op_resolve@test.local", displayName: "Operator" },
    ]);
    await joinDb.insert(leagues).values({
      id: "league_resolve_lock",
      name: "League Resolve Lock",
      format: "snake",
      teamCount: 2,
      commissionerUserId: "u_commish_resolve",
    });
    const [message] = await joinDb
      .insert(chatMessages)
      .values({ leagueId: "league_resolve_lock", authorUserId: "u_member_resolve", body: "hello" })
      .returning({ id: chatMessages.id });
    const flag = await joinDb.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "chat_report",
        subjectId: String(message!.id),
        leagueId: "league_resolve_lock",
        evidence: {},
        raisedByUserId: null,
        occurredAt: clock.now(),
        newId: () => "flag_resolve_lock_1",
      }),
    );

    let holdsLeagueLock: () => void = () => {};
    const leagueLocked = new Promise<void>((resolve) => (holdsLeagueLock = resolve));
    let releaseJoin: () => void = () => {};
    const parked = new Promise<void>((resolve) => (releaseJoin = resolve));

    // T_join: parked right after `leagues[X] FOR UPDATE`, exactly as in the pairs above.
    const joining = joinDb.transaction((tx) =>
      joinLeagueInTx(
        tx,
        { leagueId: "league_resolve_lock", userId: "user_joiner_resolve", newId: () => "team_joiner_resolve", via: "public_browse", occurredAt: clock.now() },
        async () => {
          holdsLeagueLock();
          await parked;
          return null;
        },
      ),
    );
    await leagueLocked;

    // T_resolve: the real resolveFlag, `warned_user` branch, on its own connection, reaching for
    // the SAME league row through its notice insert.
    const resolving = resolveFlag(resolveDb, {
      flagId: flag.id,
      decision: "warned_user",
      note: "Keep the trash talk about the teams.",
      operatorUserId: "u_op_resolve",
    });

    // T_resolve has to have genuinely blocked on `leagues[X]` before T_join is let go, or
    // releasing T_join proves nothing about the two ever contending at all.
    expect(await waitForBlockedBackend()).toBe(true);
    releaseJoin();

    const joined = await joining;
    const resolved = await resolving;
    expect(joined).toMatchObject({ ok: true, alreadyMember: false });
    expect(resolved.ok).toBe(true);

    // The league chain holds only the join's `member_joined` — `flag_resolved` never reaches it.
    const [leagueAnchor] = await joinDb.select().from(auditChains).where(eq(auditChains.scope, "league_resolve_lock"));
    expect(leagueAnchor!.headSequence).toBe(1);
    // The platform chain holds the setup's `flag_raised` AND this transaction's `flag_resolved`.
    const [platformAnchor] = await joinDb.select().from(auditChains).where(eq(auditChains.scope, "platform"));
    expect(platformAnchor!.headSequence).toBe(2);

    // And the notice resolveFlag wrote before the anchor still names the event minted after it.
    const [notice] = await joinDb.select().from(memberNotices).where(eq(memberNotices.userId, "u_member_resolve"));
    expect(notice?.auditEventId).not.toBeNull();
  });
});

/**
 * Task 7's own transaction in this proof. `recordSessionSignals`' insert into `session_signals`
 * carries a foreign key to `users`, so it takes the same implicit `FOR KEY SHARE` on that row
 * `member_notices`' and `integrity_flags`' inserts take on `leagues` above — and `syncUserFromWorkOS`
 * runs it BEFORE the `session_started` append, never after, exactly like every sibling in this file.
 *
 * Unlike `leagues` (which `joinLeagueInTx` already locks `FOR UPDATE`), no real caller in this
 * codebase takes a `users` row `FOR UPDATE` today, so there is no existing second transaction to
 * race against for a genuine two-resource cycle. This drives the real `syncUserFromWorkOS`
 * against a `users` row a BYSTANDER transaction holds `FOR UPDATE` — standing in for that missing
 * caller — to prove the dependency is real (the sign-in genuinely blocks on the held row rather
 * than skipping past it) and that releasing the hold lets both finish with no deadlock, the
 * session-signals row it wrote, and the `session_started` event that follows it.
 */
describe("recordSessionSignals' insert order", () => {
  it("blocks behind a concurrent hold on the SAME user row and completes without deadlocking once it releases", async () => {
    await joinDb.insert(users).values({ id: "u_signal_lock", email: "signal_lock@test.local", displayName: "Signal" });

    let holdsUserLock: () => void = () => {};
    const userLocked = new Promise<void>((resolve) => (holdsUserLock = resolve));
    let releaseHold: () => void = () => {};
    const parked = new Promise<void>((resolve) => (releaseHold = resolve));

    // The bystander: holds an exclusive lock on the exact row `recordSessionSignals`' foreign
    // key is about to reach for, then parks until released.
    const holding = joinDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM users WHERE id = ${"u_signal_lock"} FOR UPDATE`);
      holdsUserLock();
      await parked;
    });
    await userLocked;

    // T_sync: the real syncUserFromWorkOS, on its own connection, signing the SAME user back in.
    // Its user upsert and `recordSessionSignals`' FK-taking insert both reach for `users[u_signal_
    // lock]` and must block here, behind the bystander's hold, before either can reach the anchor.
    const signingIn = syncUserFromWorkOS(
      { db: pickDb, clock, via: "callback" },
      { id: "u_signal_lock", email: "signal_lock@test.local", firstName: "Signal", lastName: null },
    );

    expect(await waitForBlockedBackend()).toBe(true);
    releaseHold();

    await expect(holding).resolves.toBeUndefined();
    await expect(signingIn).resolves.toBeDefined();

    const [signal] = await joinDb.select().from(sessionSignals).where(eq(sessionSignals.userId, "u_signal_lock"));
    expect(signal).toBeDefined();
    const [platformAnchor] = await joinDb.select().from(auditChains).where(eq(auditChains.scope, "platform"));
    expect(platformAnchor!.headSequence).toBe(1); // the sign-in's own session_started, and nothing else
  });
});

/**
 * THE REMAINING FIVE WRITERS (final review, LOW 17). Everything above proves the rule for
 * `raiseFlag`, `resolveFlag`'s `warned_user` branch and `recordSessionSignals`. The reviewer
 * walked the other five by hand and found no inversion — which is a property asserted by review
 * rather than by the suite, and this codebase's whole position on lock order is that reasoning
 * about implicit foreign-key locks is exactly what got it wrong the first time.
 *
 * Each of the five follows the identical rendezvous: a real transaction is parked holding the row
 * the writer's own FK is about to reach for, the writer is driven on a second connection, Postgres
 * is ASKED whether a backend is genuinely blocked (never a sleep), the park is released, and both
 * sides are required to finish. With an inverted order the writer would already be holding the
 * anchor the parked transaction is about to want, and one of the two would die.
 */

/** Parks a real join inside its own precondition — after `leagues[X] FOR UPDATE`, before the
 *  append — and hands back the release. The exact shape the three tests above build inline;
 *  extracted here because five more of them would be five more copies of it. */
function parkedJoin(leagueId: string, userId: string, teamId: string) {
  let holdsLeagueLock: () => void = () => {};
  const leagueLocked = new Promise<void>((resolve) => (holdsLeagueLock = resolve));
  let release: () => void = () => {};
  const parked = new Promise<void>((resolve) => (release = resolve));

  const joining = joinDb.transaction((tx) =>
    joinLeagueInTx(
      tx,
      { leagueId, userId, newId: () => teamId, via: "public_browse", occurredAt: clock.now() },
      async () => {
        holdsLeagueLock();
        await parked;
        return null;
      },
    ),
  );
  return { joining, leagueLocked, release: () => release() };
}

/** Users, a league and (optionally) a team — the shell every case below needs. */
async function seedLeagueWith(leagueId: string, userIds: readonly string[]): Promise<void> {
  await joinDb.insert(users).values(userIds.map((id) => ({ id, email: `${id}@test.local`, displayName: id })));
  await joinDb.insert(leagues).values({ id: leagueId, name: leagueId, format: "snake", teamCount: 3, commissionerUserId: userIds[0]! });
}

describe("resolveFlag's content_removed branches", () => {
  it("removes a CHAT MESSAGE beside a concurrent join in the same league without deadlocking", async () => {
    await seedLeagueWith("lg_cr_chat", ["u_cr_commish", "u_cr_author", "u_cr_op", "u_cr_joiner"]);
    const [message] = await joinDb
      .insert(chatMessages)
      .values({ leagueId: "lg_cr_chat", authorUserId: "u_cr_author", body: "hello" })
      .returning({ id: chatMessages.id });
    const flag = await joinDb.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "chat_report",
        subjectId: String(message!.id),
        leagueId: "lg_cr_chat",
        evidence: {},
        raisedByUserId: null,
        occurredAt: clock.now(),
        newId: () => "flag_cr_chat",
      }),
    );

    const join = parkedJoin("lg_cr_chat", "u_cr_joiner", "team_cr_chat");
    await join.leagueLocked;

    // The chat removal writes a `chat_message_removed` notice (leagues FOR KEY SHARE) and
    // appends TWICE to the platform chain — `admin_action` then `flag_resolved` — so this is also
    // the re-entrant-anchor case, driven rather than reasoned about.
    const resolving = resolveFlag(resolveDb, {
      flagId: flag.id,
      decision: "content_removed",
      note: "spam",
      operatorUserId: "u_cr_op",
      publish: async () => null,
    });

    expect(await waitForBlockedBackend()).toBe(true);
    join.release();

    expect(await join.joining).toMatchObject({ ok: true, alreadyMember: false });
    expect(await resolving).toMatchObject({ ok: true });

    const [leagueAnchor] = await joinDb.select().from(auditChains).where(eq(auditChains.scope, "lg_cr_chat"));
    expect(leagueAnchor!.headSequence).toBe(1); // the join's member_joined, and nothing else
    const [platformAnchor] = await joinDb.select().from(auditChains).where(eq(auditChains.scope, "platform"));
    expect(platformAnchor!.headSequence).toBe(3); // flag_raised, then admin_action + flag_resolved
  });

  it("removes a REVIEW beside a concurrent join without deadlocking", async () => {
    await seedLeagueWith("lg_cr_review", ["u_rv_commish", "u_rv_author", "u_rv_op", "u_rv_joiner"]);
    await joinDb.insert(reviews).values({
      id: "review_cr_1", userId: "u_rv_author", rating: 4, body: "meh",
      createdAt: new Date(clock.now()), updatedAt: new Date(clock.now()),
    });
    const flag = await joinDb.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "review_report",
        subjectId: "review_cr_1",
        leagueId: null, // reviews are platform-scoped (ruling 1) — no league on the flag at all
        evidence: {},
        raisedByUserId: null,
        occurredAt: clock.now(),
        newId: () => "flag_cr_review",
      }),
    );

    // The review removal's own notice has `leagueId: null`, so it never reaches `leagues` — the
    // contended row here is the AUTHOR's `users` row, which the notice's FK takes KEY SHARE on.
    let holdsUserLock: () => void = () => {};
    const userLocked = new Promise<void>((resolve) => (holdsUserLock = resolve));
    let releaseHold: () => void = () => {};
    const parked = new Promise<void>((resolve) => (releaseHold = resolve));
    const holding = joinDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM users WHERE id = ${"u_rv_author"} FOR UPDATE`);
      holdsUserLock();
      await parked;
    });
    await userLocked;

    const resolving = resolveFlag(resolveDb, { flagId: flag.id, decision: "content_removed", note: "spam", operatorUserId: "u_rv_op" });

    expect(await waitForBlockedBackend()).toBe(true);
    releaseHold();

    await expect(holding).resolves.toBeUndefined();
    expect(await resolving).toMatchObject({ ok: true });
    const [platformAnchor] = await joinDb.select().from(auditChains).where(eq(auditChains.scope, "platform"));
    expect(platformAnchor!.headSequence).toBe(3);
  });
});

describe("reportMessage's and reportReview's insert order", () => {
  it("reports a chat message beside a concurrent join in the same league without deadlocking", async () => {
    await seedLeagueWith("lg_report_chat", ["u_rc_commish", "u_rc_author", "u_rc_reporter", "u_rc_joiner"]);
    const [message] = await joinDb
      .insert(chatMessages)
      .values({ leagueId: "lg_report_chat", authorUserId: "u_rc_author", body: "hello" })
      .returning({ id: chatMessages.id });

    const join = parkedJoin("lg_report_chat", "u_rc_joiner", "team_rc");
    await join.leagueLocked;

    // `reportMessage` opens its own transaction: the report row (FK to `chat_messages` and
    // `users`) first, then `raiseFlag`'s insert, then the platform anchor. Its flag carries
    // `leagueId: null` (ruling 1), so it never takes a lock on the row the join is holding — this
    // proves that separation under real contention rather than asserting it.
    const reporting = reportMessage(flagDb, {
      messageId: String(message!.id),
      leagueId: "lg_report_chat",
      reporterUserId: "u_rc_reporter",
      reason: "spam",
      newId: () => "flag_report_chat",
      clock,
    });

    expect(await reporting).toMatchObject({ ok: true });
    join.release();
    expect(await join.joining).toMatchObject({ ok: true, alreadyMember: false });

    const [leagueAnchor] = await joinDb.select().from(auditChains).where(eq(auditChains.scope, "lg_report_chat"));
    expect(leagueAnchor!.headSequence).toBe(1);
    const [platformAnchor] = await joinDb.select().from(auditChains).where(eq(auditChains.scope, "platform"));
    expect(platformAnchor!.headSequence).toBe(1);
  });

  it("reports a review beside a concurrent hold on its author's row without deadlocking", async () => {
    await seedLeagueWith("lg_report_review", ["u_rr_commish", "u_rr_author", "u_rr_reporter"]);
    await joinDb.insert(reviews).values({
      id: "review_report_1", userId: "u_rr_author", rating: 4, body: "meh",
      createdAt: new Date(clock.now()), updatedAt: new Date(clock.now()),
    });

    // The contended row is the REPORTER's `users` row, which `review_reports`' own FK takes
    // KEY SHARE on before `reportReview` reaches the platform anchor.
    let holdsUserLock: () => void = () => {};
    const userLocked = new Promise<void>((resolve) => (holdsUserLock = resolve));
    let releaseHold: () => void = () => {};
    const parked = new Promise<void>((resolve) => (releaseHold = resolve));
    const holding = joinDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM users WHERE id = ${"u_rr_reporter"} FOR UPDATE`);
      holdsUserLock();
      await parked;
    });
    await userLocked;

    const reporting = reportReview(flagDb, {
      reviewId: "review_report_1",
      reporterUserId: "u_rr_reporter",
      reason: "spam",
      newId: () => "flag_report_review",
      clock,
    });

    expect(await waitForBlockedBackend()).toBe(true);
    releaseHold();

    await expect(holding).resolves.toBeUndefined();
    expect(await reporting).toMatchObject({ ok: true });
    const [platformAnchor] = await joinDb.select().from(auditChains).where(eq(auditChains.scope, "platform"));
    expect(platformAnchor!.headSequence).toBe(1);
  });
});

describe("grantAdmin's notice order", () => {
  it("grants beside a concurrent hold on the SAME user row and completes without deadlocking", async () => {
    await joinDb.insert(users).values([
      { id: "u_grant_subject", email: "grant_subject@test.local", displayName: "Subject" },
      { id: "u_grant_by", email: "grant_by@test.local", displayName: "Granter", isAdmin: true },
    ]);

    // `grantAdmin` UPDATEs `users[subject]` and then writes an `admin_granted` notice whose FK
    // takes KEY SHARE on the same row — both before the platform anchor. No production caller
    // takes a `users` row `FOR UPDATE`, so a bystander stands in for one, exactly as
    // `recordSessionSignals`' own case above does.
    let holdsUserLock: () => void = () => {};
    const userLocked = new Promise<void>((resolve) => (holdsUserLock = resolve));
    let releaseHold: () => void = () => {};
    const parked = new Promise<void>((resolve) => (releaseHold = resolve));
    const holding = joinDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM users WHERE id = ${"u_grant_subject"} FOR UPDATE`);
      holdsUserLock();
      await parked;
    });
    await userLocked;

    const granting = grantAdmin(resolveDb, { userId: "u_grant_subject", grant: true, grantedBy: "u_grant_by", clock });

    expect(await waitForBlockedBackend()).toBe(true);
    releaseHold();

    await expect(holding).resolves.toBeUndefined();
    expect(await granting).toMatchObject({ ok: true, isAdmin: true });
    const [platformAnchor] = await joinDb.select().from(auditChains).where(eq(auditChains.scope, "platform"));
    expect(platformAnchor!.headSequence).toBe(1);
    const [notice] = await joinDb.select().from(memberNotices).where(eq(memberNotices.userId, "u_grant_subject"));
    expect(notice?.auditEventId).not.toBeNull();
  });
});

/**
 * Plan C's actual first transaction in this proof (Task 3, fix round 1: F2's review named this
 * gap — `proposeTrade`'s own sequence had no lock-order proof of its own, only `rejectTrade`'s
 * did). `proposeTrade`'s `trade_proposals` insert carries a foreign key to `leagues`, so it
 * reaches for `leagues FOR KEY SHARE` before its anchor — the SAME row `joinLeagueInTx` holds
 * `FOR UPDATE`. It ALSO takes `teams[proposerTeamId] FOR UPDATE` first (F2's own fix, the
 * open-offer-cap race guard) — a DIFFERENT row than the one the join holds, so that lock costs
 * nothing here and is not what this test is driving at.
 *
 * This drives a real join and a real trade proposal against the SAME league on two connections,
 * with the join parked exactly where the cycle used to sit, and asserts no deadlock plus the
 * correct chain: `trade_proposed` lands on the LEAGUE chain beside the join's own
 * `member_joined` (ruling 1 — a trade is league content even though its `ACTIVITY_VISIBILITY`
 * is `"hidden"`, and the two are independent on purpose).
 */
describe("proposeTrade's insert order", () => {
  it("lets a join and a trade proposal in the same league run concurrently without deadlocking", async () => {
    await seedLeagueWith("lg_propose_lock", ["u_propose_commish", "u_propose_alice", "u_propose_bob", "u_propose_joiner"]);
    await joinDb.insert(teams).values([
      { id: "team_propose_alice", leagueId: "lg_propose_lock", userId: "u_propose_alice", name: "Alice's Team" },
      { id: "team_propose_bob", leagueId: "lg_propose_lock", userId: "u_propose_bob", name: "Bob's Team" },
    ]);
    await joinDb.insert(players).values([
      { id: "p_propose_a", name: "Propose A", position: "RB", nflTeam: "KC" },
      { id: "p_propose_b", name: "Propose B", position: "RB", nflTeam: "SF" },
    ]);
    await joinDb.insert(rosterSlots).values([
      { teamId: "team_propose_alice", slot: "BENCH", slotIndex: 0, playerId: "p_propose_a" },
      { teamId: "team_propose_bob", slot: "BENCH", slotIndex: 0, playerId: "p_propose_b" },
    ]);

    const join = parkedJoin("lg_propose_lock", "u_propose_joiner", "team_propose_joiner");
    await join.leagueLocked;

    // T_propose: the real proposeTrade, on its own connection, reaching for the SAME league row
    // through its trade_proposals insert (the leagueId FK -> leagues FOR KEY SHARE) before it
    // reaches the league anchor.
    const proposing = proposeTrade(pickDb, {
      leagueId: "lg_propose_lock",
      userId: "u_propose_alice",
      counterpartyTeamId: "team_propose_bob",
      weekNumber: 1,
      proposerAssets: [{ kind: "player", playerId: "p_propose_a" }],
      counterpartyAssets: [{ kind: "player", playerId: "p_propose_b" }],
      note: null,
      clock,
      deliver: async () => {},
    });

    expect(await waitForBlockedBackend()).toBe(true);
    join.release();

    expect(await join.joining).toMatchObject({ ok: true, alreadyMember: false });
    expect(await proposing).toMatchObject({ ok: true });

    // Both transactions really did land on the SAME league chain: the join's member_joined and
    // the proposal's trade_proposed.
    const [leagueAnchor] = await joinDb.select().from(auditChains).where(eq(auditChains.scope, "lg_propose_lock"));
    expect(leagueAnchor!.headSequence).toBe(2);
  });
});

describe("rejectTrade's notice order", () => {
  it("lets a join and a trade rejection in the same league run concurrently without deadlocking", async () => {
    await seedLeagueWith("lg_trade_lock", ["u_trade_commish", "u_trade_alice", "u_trade_bob", "u_trade_joiner"]);
    await joinDb.insert(teams).values([
      { id: "team_trade_alice", leagueId: "lg_trade_lock", userId: "u_trade_alice", name: "Alice's Team" },
      { id: "team_trade_bob", leagueId: "lg_trade_lock", userId: "u_trade_bob", name: "Bob's Team" },
    ]);
    const proposedAt = new Date(clock.now());
    const expiresAt = new Date(proposedAt.getTime() + 72 * 60 * 60 * 1000);
    await joinDb.insert(tradeProposals).values({
      id: "trade_lock_1",
      leagueId: "lg_trade_lock",
      proposerTeamId: "team_trade_alice",
      counterpartyTeamId: "team_trade_bob",
      weekNumber: 1,
      proposerAssets: [{ kind: "player", playerId: "p_lock_1" }],
      counterpartyAssets: [{ kind: "player", playerId: "p_lock_2" }],
      fingerprint: "fp_trade_lock_1",
      note: null,
      status: "open",
      proposedAt,
      expiresAt,
    });

    const join = parkedJoin("lg_trade_lock", "u_trade_joiner", "team_trade_joiner");
    await join.leagueLocked;

    // T_reject: the real rejectTrade, on its own connection, reaching for the SAME league row
    // through its notice insert (leagues FOR KEY SHARE) before it reaches the league anchor.
    const rejecting = rejectTrade(resolveDb, { tradeId: "trade_lock_1", leagueId: "lg_trade_lock", userId: "u_trade_bob", clock, deliver: async () => {} });

    expect(await waitForBlockedBackend()).toBe(true);
    join.release();

    expect(await join.joining).toMatchObject({ ok: true, alreadyMember: false });
    expect(await rejecting).toMatchObject({ ok: true });

    // Both transactions really did land on the SAME league chain: the join's member_joined and
    // the rejection's trade_rejected.
    const [leagueAnchor] = await joinDb.select().from(auditChains).where(eq(auditChains.scope, "lg_trade_lock"));
    expect(leagueAnchor!.headSequence).toBe(2);

    // And the notice rejectTrade wrote before the anchor still names the event minted after it.
    const [notice] = await joinDb.select().from(memberNotices).where(eq(memberNotices.userId, "u_trade_alice"));
    expect(notice?.auditEventId).not.toBeNull();
  });
});

/**
 * Task 5's own transaction, first half: `acceptTrade`'s week lock. It parks a real week-status
 * write — the same statement `persistTick` (`@/stats-pipeline/persist`) issues, standing in for
 * it because `persistTick` has no seam to park inside — holding `stat_weeks[4]` open, and drives
 * a real `acceptTrade` against the SAME row on a second connection. The claim is narrower than
 * the pairs above: not "no deadlock", but that the trade genuinely BLOCKS ON THE WEEK rather than
 * skipping past a stale read and reaching (or blocking on) the league anchor instead — the same
 * "FOR SHARE against an uncommitted concurrent writer" proof `trade-transfer.test.ts`'s own
 * `materializeLockedLineupsInTx` test runs, driven here through the real service entry point.
 */
describe("acceptTrade's week lock", () => {
  it("blocks a concurrent accept behind a real stat-week write, and refuses once it sees the flip", async () => {
    await seedLeagueWith("lg_accept_week_lock", ["u_aw_commish", "u_aw_alice", "u_aw_bob"]);
    await joinDb.insert(teams).values([
      { id: "team_aw_alice", leagueId: "lg_accept_week_lock", userId: "u_aw_alice", name: "Alice's Team" },
      { id: "team_aw_bob", leagueId: "lg_accept_week_lock", userId: "u_aw_bob", name: "Bob's Team" },
    ]);
    await joinDb.insert(players).values([
      { id: "p_aw_a", name: "Player A", position: "RB", nflTeam: "KC" },
      { id: "p_aw_b", name: "Player B", position: "RB", nflTeam: "SF" },
    ]);
    await joinDb.insert(rosterSlots).values([
      { teamId: "team_aw_alice", slot: "BENCH", slotIndex: 0, playerId: "p_aw_a" },
      { teamId: "team_aw_bob", slot: "BENCH", slotIndex: 0, playerId: "p_aw_b" },
    ]);
    // An EXISTING row, matching `persistTick`'s own upsert shape — a `SELECT … FOR SHARE` against
    // a row still being INSERTED (never committed, so not yet visible) would not block at all.
    await joinDb.insert(statWeeks).values({ week: 4, status: "scheduled" });
    const proposedAt = new Date(clock.now());
    const expiresAt = new Date(proposedAt.getTime() + 72 * 60 * 60 * 1000);
    await joinDb.insert(tradeProposals).values({
      id: "trade_aw_1",
      leagueId: "lg_accept_week_lock",
      proposerTeamId: "team_aw_alice",
      counterpartyTeamId: "team_aw_bob",
      weekNumber: 4,
      proposerAssets: [{ kind: "player", playerId: "p_aw_a" }],
      counterpartyAssets: [{ kind: "player", playerId: "p_aw_b" }],
      fingerprint: "fp_trade_aw_1",
      note: null,
      status: "open",
      proposedAt,
      expiresAt,
    });

    let releaseFlip: () => void = () => {};
    const released = new Promise<void>((resolve) => (releaseFlip = resolve));
    const flipping = joinDb.transaction(async (tx) => {
      await tx.update(statWeeks).set({ status: "in_progress" }).where(eq(statWeeks.week, 4));
      await released;
    });

    const accepting = acceptTrade(pickDb, { tradeId: "trade_aw_1", leagueId: "lg_accept_week_lock", userId: "u_aw_bob", clock, deliver: async () => {} });

    expect(await waitForBlockedBackend()).toBe(true);
    releaseFlip();
    await flipping;

    // Blocked on the WEEK, never on the anchor: no league chain row exists for this league at
    // all, because the week lock refuses the trade before `acceptTrade` ever reaches its own
    // `audit.recordAll`.
    expect(await accepting).toMatchObject({ ok: false, status: 409 });
    const anchors = await joinDb.select().from(auditChains).where(eq(auditChains.scope, "lg_accept_week_lock"));
    expect(anchors).toEqual([]);
  });
});

/**
 * Task 5's own transaction, second half: the notice inserts. `acceptTrade`'s `trade_executed`
 * notices carry the same implicit `FOR KEY SHARE` on `leagues` every other notice-writing
 * transaction in this file does, and they are written BEFORE the league anchor, exactly like
 * `rejectTrade`'s own pair above. This drives a real join and a real trade ACCEPTANCE against the
 * SAME league on two connections, with the join parked exactly where the cycle used to sit, and
 * asserts no deadlock plus the correct chain: `trade_accepted` and `roster_move` land beside the
 * join's own `member_joined`, all three on one chain, one batch.
 */
describe("acceptTrade's notice order", () => {
  it("lets a join and a trade acceptance in the same league run concurrently without deadlocking", async () => {
    await seedLeagueWith("lg_accept_lock", ["u_an_commish", "u_an_alice", "u_an_bob", "u_an_joiner"]);
    await joinDb.insert(teams).values([
      { id: "team_an_alice", leagueId: "lg_accept_lock", userId: "u_an_alice", name: "Alice's Team" },
      { id: "team_an_bob", leagueId: "lg_accept_lock", userId: "u_an_bob", name: "Bob's Team" },
    ]);
    await joinDb.insert(players).values([
      { id: "p_an_a", name: "Player A", position: "RB", nflTeam: "KC" },
      { id: "p_an_b", name: "Player B", position: "RB", nflTeam: "SF" },
    ]);
    await joinDb.insert(rosterSlots).values([
      { teamId: "team_an_alice", slot: "BENCH", slotIndex: 0, playerId: "p_an_a" },
      { teamId: "team_an_bob", slot: "BENCH", slotIndex: 0, playerId: "p_an_b" },
    ]);
    const proposedAt = new Date(clock.now());
    const expiresAt = new Date(proposedAt.getTime() + 72 * 60 * 60 * 1000);
    await joinDb.insert(tradeProposals).values({
      id: "trade_an_1",
      leagueId: "lg_accept_lock",
      proposerTeamId: "team_an_alice",
      counterpartyTeamId: "team_an_bob",
      weekNumber: 1,
      proposerAssets: [{ kind: "player", playerId: "p_an_a" }],
      counterpartyAssets: [{ kind: "player", playerId: "p_an_b" }],
      fingerprint: "fp_trade_an_1",
      note: null,
      status: "open",
      proposedAt,
      expiresAt,
    });

    const join = parkedJoin("lg_accept_lock", "u_an_joiner", "team_an_joiner");
    await join.leagueLocked;

    // T_accept: the real acceptTrade, on its own connection, reaching for the SAME league row
    // through its notice inserts (leagues FOR KEY SHARE) before it reaches the league anchor.
    const accepting = acceptTrade(pickDb, { tradeId: "trade_an_1", leagueId: "lg_accept_lock", userId: "u_an_bob", clock, deliver: async () => {} });

    expect(await waitForBlockedBackend()).toBe(true);
    join.release();

    expect(await join.joining).toMatchObject({ ok: true, alreadyMember: false });
    expect(await accepting).toMatchObject({ ok: true });

    // Both transactions really did land on the SAME league chain: the join's member_joined, and
    // the acceptance's trade_accepted + roster_move, one batch.
    const [leagueAnchor] = await joinDb.select().from(auditChains).where(eq(auditChains.scope, "lg_accept_lock"));
    expect(leagueAnchor!.headSequence).toBe(3);

    // And a notice acceptTrade wrote before the anchor still names the event minted after it.
    const [notice] = await joinDb.select().from(memberNotices).where(eq(memberNotices.userId, "u_an_alice"));
    expect(notice?.auditEventId).not.toBeNull();
  });
});

/**
 * `correctLeagueInTx`, the fifth and last (final review, LOW 17). It is Plan A's own transaction
 * shape carried into Plan B's phase: notices FIRST (each an FK on `leagues` and on the manager's
 * `users` row), then the LEAGUE anchor, then `attachAuditEvent`. It is also the one writer whose
 * anchor is a league chain rather than the platform one, which is exactly the row
 * `joinLeagueInTx` also appends to — so unlike the four above, a wrong order here is a genuine
 * two-transaction cycle on one anchor, not merely a hazard-shaped read.
 *
 * Driven through the real `correctSettledWeek`, over a real settled week with real revised stat
 * lines, because the notice-producing branch only runs when a team's points ACTUALLY move.
 */
describe("correctLeagueInTx's notice order", () => {
  const CORRECT_WEEK = 3;
  const CORRECT_LEAGUE = "lg_correct_lock";

  /** Grants every reservation without touching Redis, mirroring `correction.test.ts`'s own. */
  const grantedBudget = {
    reserve: async () => ({ granted: true as const }),
    reserveBackfill: async () => ({ granted: true as const }),
    remaining: async () => 1_000,
  };

  function statLine(playerId: string, over: Partial<StatLine> = {}): StatLine {
    return {
      playerId, week: CORRECT_WEEK, passingYards: 0, passingTouchdowns: 0, interceptions: 0, rushingYards: 0,
      rushingTouchdowns: 0, receivingYards: 0, receivingTouchdowns: 0, receptions: 0, fumblesLost: 0,
      fieldGoalsMade: 0, extraPointsMade: 0, sacks: 0, defensiveInterceptions: 0, defensiveTouchdowns: 0,
      ...over,
    };
  }

  it("corrects a league beside a concurrent join in the SAME league, on the same chain, without deadlocking", async () => {
    await joinDb.insert(users).values([
      { id: "u_corr_a", email: "corr_a@test.local", displayName: "Manager A" },
      { id: "u_corr_b", email: "corr_b@test.local", displayName: "Manager B" },
      { id: "u_corr_joiner", email: "corr_joiner@test.local", displayName: "Joiner" },
      { id: "u_corr_op", email: "corr_op@test.local", displayName: "Operator" },
    ]);
    await joinDb.insert(leagues).values({
      id: CORRECT_LEAGUE, name: CORRECT_LEAGUE, format: "snake", teamCount: 3, commissionerUserId: "u_corr_a",
      rosterSlots: [{ slot: "QB", count: 1, eligiblePositions: ["QB"] }],
    });
    await joinDb.insert(teams).values([
      { id: "team_corr_a", leagueId: CORRECT_LEAGUE, userId: "u_corr_a", name: "A" },
      { id: "team_corr_b", leagueId: CORRECT_LEAGUE, userId: "u_corr_b", name: "B" },
    ]);
    await joinDb.insert(drafts).values({
      id: `${CORRECT_LEAGUE}_draft`, leagueId: CORRECT_LEAGUE, format: "snake", status: "complete",
      kickoffAt: new Date("2026-09-01T00:00:00.000Z"), auctionBudget: null,
    });
    await joinDb.transaction((tx) => writeSchedule(tx, { leagueId: CORRECT_LEAGUE, teamIds: ["team_corr_a", "team_corr_b"], weeks: CORRECT_WEEK }));
    await joinDb.insert(players).values([
      { id: "qb_corr_a", name: "QB Corr A", position: "QB", nflTeam: "KC" },
      { id: "qb_corr_b", name: "QB Corr B", position: "QB", nflTeam: "SF" },
    ]);
    await joinDb.insert(rosterSlots).values([
      { teamId: "team_corr_a", slot: "QB", slotIndex: 0, playerId: "qb_corr_a" },
      { teamId: "team_corr_b", slot: "QB", slotIndex: 0, playerId: "qb_corr_b" },
    ]);
    await joinDb.insert(playerStatLines).values([
      { playerId: "qb_corr_a", week: CORRECT_WEEK, passingYards: 300, passingTouchdowns: 3 },
      { playerId: "qb_corr_b", week: CORRECT_WEEK, passingYards: 200, passingTouchdowns: 1 },
    ]);
    await finalizeWeek(joinDb, CORRECT_LEAGUE, CORRECT_WEEK);
    await joinDb.insert(statWeeks).values({ week: CORRECT_WEEK, status: "final", version: 1, gamesTotal: 1, gamesFinal: 1, updatedAt: new Date(clock.now()) });

    const join = parkedJoin(CORRECT_LEAGUE, "u_corr_joiner", "team_corr_joiner");
    await join.leagueLocked;

    // The provider revises `qb_corr_a` upward, so team A's points move and the notice branch runs.
    const correcting = correctSettledWeek(pickDb, {
      week: CORRECT_WEEK,
      by: "u_corr_op",
      clock,
      budget: grantedBudget,
      provider: fakeStatsProvider({
        games: {
          [CORRECT_WEEK]: [
            {
              gameId: "g_corr", week: CORRECT_WEEK, status: "final", homeNflTeam: "KC", awayNflTeam: "SF",
              lines: [statLine("qb_corr_a", { passingYards: 400, passingTouchdowns: 5 })],
            },
          ],
        },
      }),
    });

    expect(await waitForBlockedBackend(10_000)).toBe(true);
    join.release();

    expect(await join.joining).toMatchObject({ ok: true, alreadyMember: false });
    const result = await correcting;
    // A deadlock would surface HERE, as a reported per-league failure rather than a throw —
    // `attemptLeague` catches everything — so the empty list is the real assertion.
    expect(result).toMatchObject({ ok: true, changed: true });
    if (result.ok) expect(result.leaguesFailed).toEqual([]);

    // Both transactions really did append to the SAME league chain, which is what makes the
    // absence of a deadlock meaningful rather than incidental.
    const [leagueAnchor] = await joinDb.select().from(auditChains).where(eq(auditChains.scope, CORRECT_LEAGUE));
    expect(leagueAnchor!.headSequence).toBe(2); // the join's member_joined and the correction's system_action

    // And the notices written before that anchor still name the event minted after it.
    const notices = await joinDb.select().from(memberNotices).where(eq(memberNotices.leagueId, CORRECT_LEAGUE));
    expect(notices.length).toBeGreaterThan(0);
    for (const notice of notices) expect(notice.auditEventId).not.toBeNull();
  });
});
