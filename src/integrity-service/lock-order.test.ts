import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { auditChains, chatMessages, drafts, integrityFlags, leagues, memberNotices, playerStatLines, reviews, rosterSlots, sessionSignals, statWeeks, teams, tradeProposals, users } from "@/db/schema";
import { createTestDb, truncateAll } from "@/db/test-db";
import { currentDeadline } from "@/draft-engine";
import { createDraftStore } from "@/draft-service/store";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "@/draft-service/test-support";
import { autoSetLineupsForWeek } from "@/league-service/auto-lineup";
import { joinLeagueInTx, recordTierBlockedJoin } from "@/league-service/join";
import { setLineup } from "@/league-service/lineups";
import { writeSchedule } from "@/league-service/schedule";
import { seasonCurrentWeek } from "@/league-service/test-support";
import { acceptTrade, blockHeldTradeInTx, proposeTrade, rejectTrade, releaseHeldTradeInTx } from "@/league-service/trades";
import { reverseTradeInTx } from "@/league-service/trade-reversal";
import type { StatLine } from "@/domain/player";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { correctSettledWeek } from "@/stats-pipeline/correction";
import { finalizeWeek } from "@/stats-pipeline/finalize";
import { fakeStatsProvider } from "@/stats-pipeline/test-support";
import { syncUserFromWorkOS } from "@/lib/auth/user-sync";
import { toggleReaction } from "@/chat-service/chat";
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
 *
 * ---------------------------------------------------------------------------------------------
 * THE LESSON THIS SUITE EXISTS TO ENFORCE, RESTATED AFTER PLAN C'S FINAL REVIEW (HIGH 2):
 *
 *   A LOCK-ORDER REVIEW MUST ENUMERATE FOREIGN KEYS, BECAUSE AN INSERT'S PARENT-ROW LOCKS ARE
 *   INVISIBLE AT THE CALL SITE.
 *
 * Every deadlock this codebase has produced so far lives in a lock no line of source code
 * mentions. `proposeTrade` shipped with a docblock that reasoned about this exact hazard and
 * stopped one foreign key short: it correctly argued that the `trade_proposals` INSERT re-taking
 * `FOR KEY SHARE` on the PROPOSER's team row was not a second lock (that row was already held
 * `FOR UPDATE`), and never mentioned the COUNTERPARTY's row, which was not held at all. That made
 * its true order proposer-then-counterparty, the opposite of `acceptTrade`'s and
 * `reverseTradeInTx`'s sorted-by-id order whenever the proposer sorted second — and two managers
 * offering each other a trade on a Sunday morning deadlocked, with a 500 to whichever one lost.
 *
 * So: when reading a transaction for its lock order, list the statements AND the foreign keys
 * every one of those statements touches. And prove it here rather than by inspection — a proof
 * that parks the actual contended row, released only once the other side is genuinely blocked
 * behind it (`waitForBlockedBackend`), never a hopeful interleaving.
 *
 * COVERAGE: all 7 of Plan C's new writers are driven below — `proposeTrade` (league FK, and the
 * mirror-propose team-FK proof), `settleProposal` via `rejectTrade`, `acceptTrade` (week lock,
 * notice order, mirror-accept team locks), `reverseTradeInTx` (week lock, team locks),
 * `raiseTradeFairnessFlag` in its real after-commit position, `resolveFlag`'s `trade_reversed`
 * two-transaction shape, and `toggleReaction`.
 */
const joinDb = createTestDb();
const pickDb = createTestDb();
const flagDb = createTestDb();
const resolveDb = createTestDb();
const blockDb = createTestDb();
const releaseDb = createTestDb();

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
 * `FOR UPDATE`. It ALSO takes BOTH `teams` rows `FOR UPDATE` first, in canonical sorted-by-id
 * order — different rows than the one the join holds, so those locks do not participate in THIS
 * pair. The team locks have their own two-connection proof directly below; it is the one the
 * waiver that used to sit here was hiding.
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

/**
 * FINAL REVIEW, HIGH 2 — the proof that replaces a waiver comment.
 *
 * `proposeTrade`'s team lock used to be waived in the test above as "a DIFFERENT row than the one
 * the join holds, so that lock costs nothing here". True of THAT pair, and it hid the one that
 * mattered: the `trade_proposals` INSERT carries foreign keys to BOTH team rows, so the
 * transaction reached for the COUNTERPARTY's row `FOR KEY SHARE` after holding the PROPOSER's
 * `FOR UPDATE` — proposer-first ordering, invisible in the source, opposite to `acceptTrade`'s
 * and `reverseTradeInTx`'s sorted-by-id order whenever the proposer sorted second. Two MIRROR
 * proposals (Alice offers Bob a trade while Bob offers Alice one) then genuinely deadlocked, with
 * a real `40P01` and an unexplained 500 to the loser — no operator, no accept, no race either
 * manager could perceive.
 *
 * The suite's real gap was that NO test ever parked a `teams` row against a trade writer. This
 * one does, on the row both mirror proposals must now reach for FIRST (`"team_mp_a"` sorts before
 * `"team_mp_b"`), released only once BOTH are genuinely blocked behind it — so the convergence is
 * proved, not assumed. Against the pre-fix code this reddens immediately.
 */
describe("proposeTrade's team-lock order — the mirror-propose deadlock proof", () => {
  it("lets two mirror proposals between the same two teams run concurrently without deadlocking", async () => {
    await seedLeagueWith("lg_mirror_propose", ["u_mp_commish", "u_mp_alice", "u_mp_bob"]);
    // Sorted lexicographically, `"team_mp_a" < "team_mp_b"` — both proposals below compute the
    // identical `[firstTeamId, secondTeamId]` pair no matter which team is proposing.
    await joinDb.insert(teams).values([
      { id: "team_mp_a", leagueId: "lg_mirror_propose", userId: "u_mp_alice", name: "Alice's Team" },
      { id: "team_mp_b", leagueId: "lg_mirror_propose", userId: "u_mp_bob", name: "Bob's Team" },
    ]);
    await joinDb.insert(players).values([
      { id: "p_mp_1", name: "Player One", position: "RB", nflTeam: "KC" },
      { id: "p_mp_2", name: "Player Two", position: "RB", nflTeam: "SF" },
      { id: "p_mp_3", name: "Player Three", position: "RB", nflTeam: "DAL" },
      { id: "p_mp_4", name: "Player Four", position: "RB", nflTeam: "MIA" },
    ]);
    // A DIFFERENT asset pair per proposal, so the two rows never collide on the fingerprint index
    // independent of the team-lock question this test is actually about.
    await joinDb.insert(rosterSlots).values([
      { teamId: "team_mp_a", slot: "BENCH", slotIndex: 0, playerId: "p_mp_1" },
      { teamId: "team_mp_a", slot: "BENCH", slotIndex: 1, playerId: "p_mp_4" },
      { teamId: "team_mp_b", slot: "BENCH", slotIndex: 0, playerId: "p_mp_2" },
      { teamId: "team_mp_b", slot: "BENCH", slotIndex: 1, playerId: "p_mp_3" },
    ]);

    // The bystander: holds the ONE row both proposals must reach for first.
    let holdsFirstTeamLock: () => void = () => {};
    const firstTeamLocked = new Promise<void>((resolve) => (holdsFirstTeamLock = resolve));
    let releaseFirstTeamLock: () => void = () => {};
    const released = new Promise<void>((resolve) => (releaseFirstTeamLock = resolve));
    const holding = joinDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM teams WHERE id = ${"team_mp_a"} FOR UPDATE`);
      holdsFirstTeamLock();
      await released;
    });
    await firstTeamLocked;

    // T_propose1 and T_propose2: the real `proposeTrade`, twice, on TWO separate connections —
    // each team offering the other, which is the exact production shape that deadlocked.
    const proposing1 = proposeTrade(pickDb, {
      leagueId: "lg_mirror_propose",
      userId: "u_mp_alice",
      counterpartyTeamId: "team_mp_b",
      proposerAssets: [{ kind: "player", playerId: "p_mp_1" }],
      counterpartyAssets: [{ kind: "player", playerId: "p_mp_2" }],
      note: null,
      clock,
      deliver: async () => {},
    });
    const proposing2 = proposeTrade(resolveDb, {
      leagueId: "lg_mirror_propose",
      userId: "u_mp_bob",
      counterpartyTeamId: "team_mp_a",
      proposerAssets: [{ kind: "player", playerId: "p_mp_3" }],
      counterpartyAssets: [{ kind: "player", playerId: "p_mp_4" }],
      note: null,
      clock,
      deliver: async () => {},
    });

    expect(await waitForBlockedBackend()).toBe(true);
    releaseFirstTeamLock();

    await expect(holding).resolves.toBeUndefined();
    const [result1, result2] = await Promise.all([proposing1, proposing2]);

    // No deadlock, and BOTH outcomes correct — never one victim rethrown as a 500.
    expect(result1).toMatchObject({ ok: true });
    expect(result2).toMatchObject({ ok: true });

    // Both offers really exist, one in each direction, both still open.
    const rows = await joinDb.select().from(tradeProposals).where(eq(tradeProposals.leagueId, "lg_mirror_propose"));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "open")).toBe(true);
    expect(rows.map((row) => row.proposerTeamId).sort()).toEqual(["team_mp_a", "team_mp_b"]);

    // And both landed on the SAME league chain, at consecutive sequences.
    const [leagueAnchor] = await joinDb.select().from(auditChains).where(eq(auditChains.scope, "lg_mirror_propose"));
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
    // Week 4 is this LEAGUE's current week, seeded as a real season (weeks 1-3 scored). Since the
    // final review's CRITICAL 1, `acceptTrade` locks the week it DERIVES, never the week the
    // proposal names — so a fixture that wants the accept to block on `stat_weeks[4]` has to be a
    // league whose current week genuinely is 4.
    await seasonCurrentWeek(joinDb, { leagueId: "lg_accept_week_lock", homeTeamId: "team_aw_alice", awayTeamId: "team_aw_bob", week: 4 });
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
 * Fix round 1, MEDIUM. Ruling 1's central safety claim — sorted-by-id team locking is
 * deadlock-free against a concurrent MIRROR accept (team A's accept of an A→B trade racing team
 * B's accept of a DIFFERENT, B→A trade between the SAME two teams) — was documented but never
 * driven against a real Postgres. Both trades below compute the identical
 * `[proposerTeamId, counterpartyTeamId].sort()` pair regardless of which team proposed which one,
 * so both attempts converge on locking `team_mirror_a` FIRST — the property a bystander holding
 * exactly that row, released only once BOTH concurrent accepts are genuinely blocked behind it
 * (`waitForBlockedBackend`, never a hopeful interleaving), proves directly. Proposer-first
 * ordering would have one transaction lock A-then-B while the mirror locked B-then-A, a real
 * two-resource cycle Postgres would kill after `deadlock_timeout`; sorted ordering has both want
 * the same row first, so there is never a cycle to kill.
 */
describe("acceptTrade's team-lock order — the mirror-accept deadlock proof", () => {
  it("lets two mirror trades between the same two teams accept concurrently without deadlocking", async () => {
    await joinDb.insert(users).values([
      { id: "u_mirror_alice", email: "mirror_alice@test.local", displayName: "Alice" },
      { id: "u_mirror_bob", email: "mirror_bob@test.local", displayName: "Bob" },
    ]);
    await joinDb.insert(leagues).values({
      id: "lg_mirror_lock",
      name: "Mirror Lock League",
      format: "snake",
      teamCount: 2,
      commissionerUserId: "u_mirror_alice",
    });
    // Sorted lexicographically, `"team_mirror_a" < "team_mirror_b"` — both mirror trades below
    // compute the identical `[firstTeamId, secondTeamId]` pair no matter which team proposed,
    // which is the whole property under test.
    await joinDb.insert(teams).values([
      { id: "team_mirror_a", leagueId: "lg_mirror_lock", userId: "u_mirror_alice", name: "Alice's Team" },
      { id: "team_mirror_b", leagueId: "lg_mirror_lock", userId: "u_mirror_bob", name: "Bob's Team" },
    ]);
    await joinDb.insert(players).values([
      { id: "p_mirror_1", name: "Player One", position: "RB", nflTeam: "KC" },
      { id: "p_mirror_2", name: "Player Two", position: "RB", nflTeam: "SF" },
      { id: "p_mirror_3", name: "Player Three", position: "RB", nflTeam: "DAL" },
      { id: "p_mirror_4", name: "Player Four", position: "RB", nflTeam: "MIA" },
    ]);
    await joinDb.insert(rosterSlots).values([
      { teamId: "team_mirror_a", slot: "BENCH", slotIndex: 0, playerId: "p_mirror_1" },
      { teamId: "team_mirror_a", slot: "BENCH", slotIndex: 1, playerId: "p_mirror_4" },
      { teamId: "team_mirror_b", slot: "BENCH", slotIndex: 0, playerId: "p_mirror_2" },
      { teamId: "team_mirror_b", slot: "BENCH", slotIndex: 1, playerId: "p_mirror_3" },
    ]);
    const proposedAt = new Date(clock.now());
    const expiresAt = new Date(proposedAt.getTime() + 72 * 60 * 60 * 1000);
    // Trade 1: `team_mirror_a` proposes, `team_mirror_b` is the counterparty.
    await joinDb.insert(tradeProposals).values({
      id: "trade_mirror_1",
      leagueId: "lg_mirror_lock",
      proposerTeamId: "team_mirror_a",
      counterpartyTeamId: "team_mirror_b",
      weekNumber: 1,
      proposerAssets: [{ kind: "player", playerId: "p_mirror_1" }],
      counterpartyAssets: [{ kind: "player", playerId: "p_mirror_2" }],
      fingerprint: "fp_trade_mirror_1",
      note: null,
      status: "open",
      proposedAt,
      expiresAt,
    });
    // Trade 2: the MIRROR — `team_mirror_b` proposes this time, `team_mirror_a` is the
    // counterparty. A DIFFERENT asset pair than trade 1, so the two trades' own writes never
    // collide with each other independent of the team-lock question this test is actually about.
    await joinDb.insert(tradeProposals).values({
      id: "trade_mirror_2",
      leagueId: "lg_mirror_lock",
      proposerTeamId: "team_mirror_b",
      counterpartyTeamId: "team_mirror_a",
      weekNumber: 1,
      proposerAssets: [{ kind: "player", playerId: "p_mirror_3" }],
      counterpartyAssets: [{ kind: "player", playerId: "p_mirror_4" }],
      fingerprint: "fp_trade_mirror_2",
      note: null,
      status: "open",
      proposedAt,
      expiresAt,
    });

    // The bystander: holds the ONE row both mirror accepts must reach for first, so releasing it
    // only once BOTH are genuinely blocked behind it is a real proof of convergence, not a
    // fixture that happens not to collide.
    let holdsFirstTeamLock: () => void = () => {};
    const firstTeamLocked = new Promise<void>((resolve) => (holdsFirstTeamLock = resolve));
    let releaseFirstTeamLock: () => void = () => {};
    const released = new Promise<void>((resolve) => (releaseFirstTeamLock = resolve));
    const holding = joinDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM teams WHERE id = ${"team_mirror_a"} FOR UPDATE`);
      holdsFirstTeamLock();
      await released;
    });
    await firstTeamLocked;

    // T_accept1 and T_accept2: the real `acceptTrade`, twice, on TWO separate connections —
    // one mirror trade each, both reaching for `team_mirror_a` first.
    const accepting1 = acceptTrade(pickDb, { tradeId: "trade_mirror_1", leagueId: "lg_mirror_lock", userId: "u_mirror_bob", clock, deliver: async () => {} });
    const accepting2 = acceptTrade(resolveDb, { tradeId: "trade_mirror_2", leagueId: "lg_mirror_lock", userId: "u_mirror_alice", clock, deliver: async () => {} });

    expect(await waitForBlockedBackend()).toBe(true);
    releaseFirstTeamLock();

    await expect(holding).resolves.toBeUndefined();
    const [result1, result2] = await Promise.all([accepting1, accepting2]);

    // No deadlock, and exactly one outcome per trade — both mirror trades genuinely executed.
    expect(result1).toMatchObject({ ok: true, tradeId: "trade_mirror_1" });
    expect(result2).toMatchObject({ ok: true, tradeId: "trade_mirror_2" });

    const teamARoster = await joinDb.select({ playerId: rosterSlots.playerId }).from(rosterSlots).where(eq(rosterSlots.teamId, "team_mirror_a"));
    const teamBRoster = await joinDb.select({ playerId: rosterSlots.playerId }).from(rosterSlots).where(eq(rosterSlots.teamId, "team_mirror_b"));
    const filledIds = (rows: readonly { readonly playerId: string | null }[]) => rows.flatMap((r) => (r.playerId === null ? [] : [r.playerId])).sort();
    // Alice gave away p_mirror_1 (trade 1) and p_mirror_4 (trade 2), and received p_mirror_2
    // (trade 1) and p_mirror_3 (trade 2) — both trades really did move both ways.
    expect(filledIds(teamARoster)).toEqual(["p_mirror_2", "p_mirror_3"]);
    expect(filledIds(teamBRoster)).toEqual(["p_mirror_1", "p_mirror_4"]);
  });
});

/**
 * Task 7's own transaction, first half: `reverseTradeInTx`'s week lock. The brief's own note: "the
 * reversal reaches `stat_weeks FOR SHARE` first, before" anything else in its own transaction —
 * matching `setLineup`'s and `acceptTrade`'s own position exactly, so the three roster-adjacent
 * writers in this codebase all take the same first lock in the same position, the property that
 * keeps them from forming a cycle. This parks a real week-status write — the same statement
 * `persistTick` issues, standing in for it exactly as `acceptTrade's week lock`'s own test does —
 * holding `stat_weeks[1]` open, and drives a real `reverseTradeInTx` against the SAME row on a
 * second connection. Unlike `acceptTrade`, a reversal never REFUSES on the week's own status
 * (ruling 18 — it is exactly the mechanism that lets a reversal outlive a locked week), so the
 * claim here is narrower still: the reversal genuinely BLOCKS on the week before it does anything
 * else, and completes cleanly once the flip releases it.
 */
describe("reverseTradeInTx's week lock", () => {
  it("blocks behind a concurrent stat-week write, and completes once it releases", async () => {
    await joinDb.insert(users).values([
      { id: "u_rv_wk_alice", email: "rv_wk_alice@test.local", displayName: "Alice" },
      { id: "u_rv_wk_bob", email: "rv_wk_bob@test.local", displayName: "Bob" },
    ]);
    await joinDb.insert(leagues).values({ id: "lg_rv_wk", name: "Reversal Week Lock", format: "snake", teamCount: 2, commissionerUserId: "u_rv_wk_alice" });
    await joinDb.insert(teams).values([
      { id: "team_rv_wk_alice", leagueId: "lg_rv_wk", userId: "u_rv_wk_alice", name: "Alice's Team" },
      { id: "team_rv_wk_bob", leagueId: "lg_rv_wk", userId: "u_rv_wk_bob", name: "Bob's Team" },
    ]);
    await joinDb.insert(players).values([
      { id: "p_rv_wk_a", name: "Player A", position: "RB", nflTeam: "KC" },
      { id: "p_rv_wk_b", name: "Player B", position: "RB", nflTeam: "SF" },
    ]);
    await joinDb.insert(rosterSlots).values([
      { teamId: "team_rv_wk_alice", slot: "BENCH", slotIndex: 0, playerId: "p_rv_wk_a" },
      { teamId: "team_rv_wk_bob", slot: "BENCH", slotIndex: 0, playerId: "p_rv_wk_b" },
    ]);
    await joinDb.insert(statWeeks).values({ week: 1, status: "scheduled" });

    const proposed = await proposeTrade(pickDb, {
      leagueId: "lg_rv_wk",
      userId: "u_rv_wk_alice",
      counterpartyTeamId: "team_rv_wk_bob",
      proposerAssets: [{ kind: "player", playerId: "p_rv_wk_a" }],
      counterpartyAssets: [{ kind: "player", playerId: "p_rv_wk_b" }],
      note: null,
      clock,
      deliver: async () => {},
    });
    if (!proposed.ok) throw new Error(proposed.reason);
    const accepted = await acceptTrade(pickDb, { tradeId: proposed.tradeId, leagueId: "lg_rv_wk", userId: "u_rv_wk_bob", clock, deliver: async () => {} });
    if (!accepted.ok) throw new Error(accepted.reason);
    const flag = await joinDb.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "trade_fairness",
        subjectId: proposed.tradeId,
        leagueId: "lg_rv_wk",
        evidence: {},
        raisedByUserId: null,
        occurredAt: clock.now(),
        newId: () => "flag_rv_wk_1",
      }),
    );

    let releaseFlip: () => void = () => {};
    const released = new Promise<void>((resolve) => (releaseFlip = resolve));
    const flipping = joinDb.transaction(async (tx) => {
      await tx.update(statWeeks).set({ status: "in_progress" }).where(eq(statWeeks.week, 1));
      await released;
    });

    const reversing = resolveDb.transaction((tx) =>
      reverseTradeInTx(tx, { tradeId: proposed.tradeId, leagueId: "lg_rv_wk", flagId: flag.id, operatorUserId: "u_op_rv_wk", note: "n", clock }),
    );

    expect(await waitForBlockedBackend()).toBe(true);
    releaseFlip();
    await flipping;

    expect(await reversing).toMatchObject({ ok: true, tradeId: proposed.tradeId });
    const aliceRows = await joinDb.select({ playerId: rosterSlots.playerId }).from(rosterSlots).where(eq(rosterSlots.teamId, "team_rv_wk_alice"));
    expect(aliceRows.some((row) => row.playerId === "p_rv_wk_a")).toBe(true); // back where it started
  });
});

/**
 * Task 7's own transaction, second half: `reverseTradeInTx`'s own team-lock order, ledgered as
 * "both teams' rows FOR UPDATE in canonical sorted-by-id order, same as acceptTrade". The novel
 * combination this proves is a REVERSAL racing a fresh ACCEPT between the SAME two teams — a
 * different trade for the accept, so the two writes never collide with each other independent of
 * the team-lock question this test is actually about. Both compute the identical
 * `[teamId, teamId].sort()` pair, so both converge on locking the same row first; a bystander
 * holding exactly that row, released only once BOTH are genuinely blocked behind it, proves the
 * convergence directly rather than trusting the two functions share one ordering by inspection.
 */
describe("reverseTradeInTx's team-lock order — racing a fresh accept between the same two teams", () => {
  it("lets a reversal and an unrelated accept between the same two teams run concurrently without deadlocking", async () => {
    await joinDb.insert(users).values([
      { id: "u_rv_tl_alice", email: "rv_tl_alice@test.local", displayName: "Alice" },
      { id: "u_rv_tl_bob", email: "rv_tl_bob@test.local", displayName: "Bob" },
    ]);
    await joinDb.insert(leagues).values({ id: "lg_rv_tl", name: "Reversal Team Lock", format: "snake", teamCount: 2, commissionerUserId: "u_rv_tl_alice" });
    // Sorted lexicographically, `"team_rv_tl_alice" < "team_rv_tl_bob"` — both the reversal and
    // the accept below compute the identical `[firstTeamId, secondTeamId]` pair.
    await joinDb.insert(teams).values([
      { id: "team_rv_tl_alice", leagueId: "lg_rv_tl", userId: "u_rv_tl_alice", name: "Alice's Team" },
      { id: "team_rv_tl_bob", leagueId: "lg_rv_tl", userId: "u_rv_tl_bob", name: "Bob's Team" },
    ]);
    await joinDb.insert(players).values([
      { id: "p_rv_tl_1", name: "Player One", position: "RB", nflTeam: "KC" },
      { id: "p_rv_tl_2", name: "Player Two", position: "RB", nflTeam: "SF" },
      { id: "p_rv_tl_3", name: "Player Three", position: "RB", nflTeam: "DAL" },
      { id: "p_rv_tl_4", name: "Player Four", position: "RB", nflTeam: "MIA" },
    ]);
    await joinDb.insert(rosterSlots).values([
      { teamId: "team_rv_tl_alice", slot: "BENCH", slotIndex: 0, playerId: "p_rv_tl_1" },
      { teamId: "team_rv_tl_alice", slot: "BENCH", slotIndex: 1, playerId: "p_rv_tl_4" },
      { teamId: "team_rv_tl_bob", slot: "BENCH", slotIndex: 0, playerId: "p_rv_tl_2" },
      { teamId: "team_rv_tl_bob", slot: "BENCH", slotIndex: 1, playerId: "p_rv_tl_3" },
    ]);

    // Trade 1: already accepted — the one this test reverses.
    const firstTrade = await proposeTrade(pickDb, {
      leagueId: "lg_rv_tl",
      userId: "u_rv_tl_alice",
      counterpartyTeamId: "team_rv_tl_bob",
      proposerAssets: [{ kind: "player", playerId: "p_rv_tl_1" }],
      counterpartyAssets: [{ kind: "player", playerId: "p_rv_tl_2" }],
      note: null,
      clock,
      deliver: async () => {},
    });
    if (!firstTrade.ok) throw new Error(firstTrade.reason);
    const firstAccepted = await acceptTrade(pickDb, { tradeId: firstTrade.tradeId, leagueId: "lg_rv_tl", userId: "u_rv_tl_bob", clock, deliver: async () => {} });
    if (!firstAccepted.ok) throw new Error(firstAccepted.reason);
    const flag = await joinDb.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "trade_fairness",
        subjectId: firstTrade.tradeId,
        leagueId: "lg_rv_tl",
        evidence: {},
        raisedByUserId: null,
        occurredAt: clock.now(),
        newId: () => "flag_rv_tl_1",
      }),
    );

    // Trade 2: a SEPARATE, still-open offer over the two OTHER players, still open when the race
    // starts — accepted concurrently with the reversal above.
    const secondTrade = await proposeTrade(pickDb, {
      leagueId: "lg_rv_tl",
      userId: "u_rv_tl_bob",
      counterpartyTeamId: "team_rv_tl_alice",
      proposerAssets: [{ kind: "player", playerId: "p_rv_tl_3" }],
      counterpartyAssets: [{ kind: "player", playerId: "p_rv_tl_4" }],
      note: null,
      clock,
      deliver: async () => {},
    });
    if (!secondTrade.ok) throw new Error(secondTrade.reason);

    // The bystander: holds the ONE row both operations must reach for first.
    let holdsFirstTeamLock: () => void = () => {};
    const firstTeamLocked = new Promise<void>((resolve) => (holdsFirstTeamLock = resolve));
    let releaseFirstTeamLock: () => void = () => {};
    const released = new Promise<void>((resolve) => (releaseFirstTeamLock = resolve));
    const holding = joinDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM teams WHERE id = ${"team_rv_tl_alice"} FOR UPDATE`);
      holdsFirstTeamLock();
      await released;
    });
    await firstTeamLocked;

    const reversing = resolveDb.transaction((tx) =>
      reverseTradeInTx(tx, { tradeId: firstTrade.tradeId, leagueId: "lg_rv_tl", flagId: flag.id, operatorUserId: "u_op_rv_tl", note: "n", clock }),
    );
    const accepting = acceptTrade(pickDb, { tradeId: secondTrade.tradeId, leagueId: "lg_rv_tl", userId: "u_rv_tl_alice", clock, deliver: async () => {} });

    expect(await waitForBlockedBackend()).toBe(true);
    releaseFirstTeamLock();

    await expect(holding).resolves.toBeUndefined();
    const [reversed, secondAccepted] = await Promise.all([reversing, accepting]);

    expect(reversed).toMatchObject({ ok: true, tradeId: firstTrade.tradeId });
    expect(secondAccepted).toMatchObject({ ok: true, tradeId: secondTrade.tradeId });

    // Both operations really did land: trade 1 reversed (players 1 and 2 back where they
    // started) and trade 2 accepted (players 3 and 4 swapped).
    const aliceRoster = await joinDb.select({ playerId: rosterSlots.playerId }).from(rosterSlots).where(eq(rosterSlots.teamId, "team_rv_tl_alice"));
    const bobRoster = await joinDb.select({ playerId: rosterSlots.playerId }).from(rosterSlots).where(eq(rosterSlots.teamId, "team_rv_tl_bob"));
    const filledIds = (rows: readonly { readonly playerId: string | null }[]) => rows.flatMap((r) => (r.playerId === null ? [] : [r.playerId])).sort();
    expect(filledIds(aliceRoster)).toEqual(["p_rv_tl_1", "p_rv_tl_3"]);
    expect(filledIds(bobRoster)).toEqual(["p_rv_tl_2", "p_rv_tl_4"]);
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

/**
 * PHASE 3 PLAN D, TASK 1's own transaction: `stampSeasonCompleteInTx`
 * (`@/league-service/participation`), the LAST statement `finalizeWeekInTx` runs. Its own docblock
 * argues that a settlement transaction never inverts against `joinLeagueInTx`'s `leagues FOR
 * UPDATE` because a league whose last week is being scored has a complete draft, and a league
 * with a complete draft refuses joins before it locks anything — a claim about PRODUCTION
 * behavior, not about what this lower-level `joinLeagueInTx` proof (which drives the real function
 * with its OWN precondition override, bypassing `publicJoinPrecondition` on purpose, exactly like
 * every sibling above) can be made to do.
 *
 * So this proves the narrower, structural claim directly: EVEN WHEN a join is parked holding
 * `leagues[id] FOR UPDATE`, a concurrent `finalizeWeek` call whose stamp genuinely fires (the
 * league's only week, about to become its last) blocks BEHIND the join rather than cycling with
 * it — a one-directional wait, the same shape `recordSessionSignals`' proof above uses, because
 * the join transaction never reaches for anything the settlement transaction holds.
 */
describe("stampSeasonCompleteInTx's lock, inside finalizeWeekInTx", () => {
  it("blocks behind a concurrent join holding the same league row, and still stamps the season complete once it releases", async () => {
    await joinDb.insert(users).values([
      { id: "u_stamp_commish", email: "stamp_commish@test.local", displayName: "Commish" },
      { id: "u_stamp_away", email: "stamp_away@test.local", displayName: "Away" },
      { id: "u_stamp_joiner", email: "stamp_joiner@test.local", displayName: "Joiner" },
    ]);
    // teamCount 3, not 2: the join under test needs an open seat, and `writeSchedule` below only
    // schedules the two REAL teams — the third seat is what the joiner fills.
    await joinDb.insert(leagues).values({
      id: "lg_stamp_lock", name: "lg_stamp_lock", format: "snake", teamCount: 3, commissionerUserId: "u_stamp_commish",
    });
    await joinDb.insert(teams).values([
      { id: "team_stamp_home", leagueId: "lg_stamp_lock", userId: "u_stamp_commish", name: "Home" },
      { id: "team_stamp_away", leagueId: "lg_stamp_lock", userId: "u_stamp_away", name: "Away" },
    ]);
    await joinDb.insert(drafts).values({
      id: "draft_stamp_lock", leagueId: "lg_stamp_lock", format: "snake", status: "complete",
      kickoffAt: new Date("2026-09-01T00:00:00.000Z"), auctionBudget: null,
    });
    // A one-week season: this league's ONLY week is also its LAST, so finalizing it is exactly
    // the call whose stamp UPDATE reaches for `leagues[id]`.
    await joinDb.transaction((tx) => writeSchedule(tx, { leagueId: "lg_stamp_lock", teamIds: ["team_stamp_home", "team_stamp_away"], weeks: 1 }));

    const join = parkedJoin("lg_stamp_lock", "u_stamp_joiner", "team_stamp_joiner");
    await join.leagueLocked;

    // T_finalize: the real finalizeWeek, on its own connection, reaching for the SAME league row
    // through the stamp's UPDATE — a lock `finalizeWeekInTx` never took before this task.
    const finalizing = finalizeWeek(pickDb, "lg_stamp_lock", 1);

    expect(await waitForBlockedBackend()).toBe(true);
    join.release();

    expect(await join.joining).toMatchObject({ ok: true, alreadyMember: false });
    expect(await finalizing).toMatchObject({ ok: true, weekNumber: 1, matchupsScored: 1 });

    const [league] = await joinDb.select().from(leagues).where(eq(leagues.id, "lg_stamp_lock"));
    expect(league!.seasonCompletedAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// FINAL REVIEW, HIGH 2 (second half): the suite covered 4 of Plan C's 7 new writers. The three
// below close it to 7/7. Each follows the identical rendezvous every proof above does — park the
// row the writer's own foreign key is about to reach for, drive the real writer on a second
// connection, ASK Postgres whether a backend is genuinely blocked, release, require both sides to
// finish — because the whole lesson of this suite is that an FK acquisition is invisible at the
// call site and has to be driven, not reasoned about.
// ---------------------------------------------------------------------------------------------

/**
 * Writer 5: `raiseTradeFairnessFlag`, IN ITS REAL AFTER-COMMIT POSITION. `raiseFlag` has a proof
 * of its own far above, but only when driven directly — never as `acceptTrade` actually reaches
 * it, in a SECOND transaction opened after the league-chain one has already committed. That
 * second transaction inserts into `integrity_flags` (a foreign key onto `leagues`, so
 * `FOR KEY SHARE` on the league row) and then appends to the PLATFORM chain, while the
 * transaction that just closed appended to the LEAGUE chain. This drives a real lopsided trade
 * all the way through `acceptTrade` against a join parked on `leagues[X] FOR UPDATE`, and
 * requires both the flag and the join to land.
 */
describe("raiseTradeFairnessFlag's after-commit position", () => {
  it("raises a real trade's flag beside a concurrent join in the same league without deadlocking", async () => {
    await seedLeagueWith("lg_fair_lock", ["u_fl_commish", "u_fl_alice", "u_fl_bob", "u_fl_joiner"]);
    await joinDb.insert(teams).values([
      { id: "team_fl_alice", leagueId: "lg_fair_lock", userId: "u_fl_alice", name: "Alice's Team" },
      { id: "team_fl_bob", leagueId: "lg_fair_lock", userId: "u_fl_bob", name: "Bob's Team" },
    ]);
    await joinDb.insert(players).values([
      { id: "p_fl_star", name: "Flag Star", position: "RB", nflTeam: "KC" },
      { id: "p_fl_scrub", name: "Flag Scrub", position: "RB", nflTeam: "SF" },
    ]);
    await joinDb.insert(rosterSlots).values([
      { teamId: "team_fl_alice", slot: "BENCH", slotIndex: 0, playerId: "p_fl_star" },
      { teamId: "team_fl_bob", slot: "BENCH", slotIndex: 0, playerId: "p_fl_scrub" },
    ]);
    // Three scored weeks of a monster line, and a season whose current week is 4 — what makes the
    // trade genuinely cross `fairnessFlagThreshold` and the after-commit write actually happen.
    await joinDb.insert(playerStatLines).values([1, 2, 3].map((week) => ({ playerId: "p_fl_star", week, rushingYards: 300, rushingTouchdowns: 5 })));
    await seasonCurrentWeek(joinDb, { leagueId: "lg_fair_lock", homeTeamId: "team_fl_alice", awayTeamId: "team_fl_bob", week: 4 });

    const proposed = await proposeTrade(pickDb, {
      leagueId: "lg_fair_lock",
      userId: "u_fl_alice",
      counterpartyTeamId: "team_fl_bob",
      proposerAssets: [{ kind: "player", playerId: "p_fl_star" }],
      counterpartyAssets: [{ kind: "player", playerId: "p_fl_scrub" }],
      note: null,
      clock,
      deliver: async () => {},
    });
    if (!proposed.ok) throw new Error(proposed.reason);

    const join = parkedJoin("lg_fair_lock", "u_fl_joiner", "team_fl_joiner");
    await join.leagueLocked;

    const accepting = acceptTrade(resolveDb, { tradeId: proposed.tradeId, leagueId: "lg_fair_lock", userId: "u_fl_bob", clock, deliver: async () => {} });

    expect(await waitForBlockedBackend()).toBe(true);
    join.release();

    expect(await join.joining).toMatchObject({ ok: true, alreadyMember: false });
    expect(await accepting).toMatchObject({ ok: true, fairness: { flagWorthy: true } });

    // The after-commit flag really landed, on the PLATFORM chain, beside a league chain that
    // carries the join and the acceptance and nothing about the flag.
    const flags = await joinDb.select().from(integrityFlags).where(eq(integrityFlags.subjectId, proposed.tradeId));
    expect(flags).toHaveLength(1);
    const [platformAnchor] = await joinDb.select().from(auditChains).where(eq(auditChains.scope, "platform"));
    expect(platformAnchor!.headSequence).toBe(1); // flag_raised, alone
    const [leagueAnchor] = await joinDb.select().from(auditChains).where(eq(auditChains.scope, "lg_fair_lock"));
    expect(leagueAnchor!.headSequence).toBe(4); // trade_proposed, member_joined, trade_accepted + roster_move
  });
});

/**
 * Plan D, Task 5 — the hold transaction. Unlike EVERY other writer above, this one never touches
 * the league chain at all: `acceptTrade`'s hold branch (`holdTradeInTx`) appends its `trade_hold`
 * flag (`raiseFlag`'s own insert, `FOR KEY SHARE` on `leagues` through its FK) and its
 * `system_action` event both to the PLATFORM chain, in the SAME transaction. This drives a real
 * hold beside a concurrent join in the SAME league — the join's own `leagues[X] FOR UPDATE` is
 * exactly the row the flag's FK reaches for — and proves both the absence of a deadlock AND that
 * the split is real: the league chain carries only the join's `member_joined` (and the trade's own
 * `trade_proposed`, from setup), never anything about the hold.
 */
describe("acceptTrade's hold branch — the flag's own leagues FK, against a concurrent join", () => {
  it("holds a trade beside a concurrent join in the same league without deadlocking, and never touches the league chain for the hold itself", async () => {
    await seedLeagueWith("lg_hold_lock", ["u_hl_commish", "u_hl_alice", "u_hl_bob", "u_hl_joiner"]);
    await joinDb.update(leagues).set({ isPublicMatchmade: true }).where(eq(leagues.id, "lg_hold_lock"));
    await joinDb.insert(teams).values([
      { id: "team_hl_alice", leagueId: "lg_hold_lock", userId: "u_hl_alice", name: "Alice's Team" },
      { id: "team_hl_bob", leagueId: "lg_hold_lock", userId: "u_hl_bob", name: "Bob's Team" },
    ]);
    await joinDb.insert(players).values([
      { id: "p_hl_star", name: "Hold Star", position: "RB", nflTeam: "KC" },
      { id: "p_hl_scrub", name: "Hold Scrub", position: "RB", nflTeam: "SF" },
    ]);
    await joinDb.insert(rosterSlots).values([
      { teamId: "team_hl_alice", slot: "BENCH", slotIndex: 0, playerId: "p_hl_star" },
      { teamId: "team_hl_bob", slot: "BENCH", slotIndex: 0, playerId: "p_hl_scrub" },
    ]);
    // Well past `INTEGRITY_CONFIG.trade.autoHoldThreshold` (35) — the same fixture shape
    // `raiseTradeFairnessFlag's after-commit position` uses above, for the same reason.
    await joinDb.insert(playerStatLines).values([1, 2, 3].map((week) => ({ playerId: "p_hl_star", week, rushingYards: 300, rushingTouchdowns: 5 })));
    await seasonCurrentWeek(joinDb, { leagueId: "lg_hold_lock", homeTeamId: "team_hl_alice", awayTeamId: "team_hl_bob", week: 4 });

    const proposed = await proposeTrade(pickDb, {
      leagueId: "lg_hold_lock",
      userId: "u_hl_alice",
      counterpartyTeamId: "team_hl_bob",
      proposerAssets: [{ kind: "player", playerId: "p_hl_star" }],
      counterpartyAssets: [{ kind: "player", playerId: "p_hl_scrub" }],
      note: null,
      clock,
      deliver: async () => {},
    });
    if (!proposed.ok) throw new Error(proposed.reason);

    const join = parkedJoin("lg_hold_lock", "u_hl_joiner", "team_hl_joiner");
    await join.leagueLocked;

    // T_hold: the real acceptTrade, on its own connection, reaching for the SAME league row
    // through `raiseFlag`'s own `integrity_flags` insert (the `leagueId` FK -> `leagues FOR KEY
    // SHARE`) before it reaches the platform anchor — twice, in fact (the flag's own append, then
    // the `system_action` append re-entering the same anchor row).
    const holding = acceptTrade(resolveDb, { tradeId: proposed.tradeId, leagueId: "lg_hold_lock", userId: "u_hl_bob", clock, deliver: async () => {} });

    expect(await waitForBlockedBackend()).toBe(true);
    join.release();

    expect(await join.joining).toMatchObject({ ok: true, alreadyMember: false });
    expect(await holding).toMatchObject({ ok: true, outcome: "held" });

    // The league chain carries the join and the PROPOSAL only — nothing about the hold itself.
    const [leagueAnchor] = await joinDb.select().from(auditChains).where(eq(auditChains.scope, "lg_hold_lock"));
    expect(leagueAnchor!.headSequence).toBe(2); // trade_proposed, member_joined
    // The platform chain carries both hold writes: flag_raised, then system_action.
    const [platformAnchor] = await joinDb.select().from(auditChains).where(eq(auditChains.scope, "platform"));
    expect(platformAnchor!.headSequence).toBe(2);
    const flags = await joinDb.select().from(integrityFlags).where(eq(integrityFlags.subjectId, proposed.tradeId));
    expect(flags).toHaveLength(1);
    expect(flags[0]!.flagType).toBe("trade_hold");
  });
});

/**
 * Plan D, Task 5 — `resolveFlag`'s `trade_released` branch, the SECOND resolution shaped as two
 * transactions. `releaseHeldTradeInTx` re-enters `applyTradeInTx`'s FULL lock set — already proved
 * by `acceptTrade`'s own week-lock and mirror-accept tests above — commits FIRST on the LEAGUE
 * chain, and only then does `resolveFlag` open its own PLATFORM-chain `flag_resolved` stamp. This
 * drives a real release beside a concurrent join in the SAME league, the identical shape the
 * `trade_reversed` proof above uses.
 */
describe("resolveFlag's trade_released branch — two transactions, two chains", () => {
  it("releases a held trade beside a concurrent join in the same league without deadlocking", async () => {
    await seedLeagueWith("lg_rl_res", ["u_rlr_commish", "u_rlr_alice", "u_rlr_bob", "u_rlr_joiner", "u_rlr_op"]);
    await joinDb.insert(teams).values([
      { id: "team_rlr_alice", leagueId: "lg_rl_res", userId: "u_rlr_alice", name: "Alice's Team" },
      { id: "team_rlr_bob", leagueId: "lg_rl_res", userId: "u_rlr_bob", name: "Bob's Team" },
    ]);
    await joinDb.insert(players).values([
      { id: "p_rlr_a", name: "Player A", position: "RB", nflTeam: "KC" },
      { id: "p_rlr_b", name: "Player B", position: "RB", nflTeam: "SF" },
    ]);
    await joinDb.insert(rosterSlots).values([
      { teamId: "team_rlr_alice", slot: "BENCH", slotIndex: 0, playerId: "p_rlr_a" },
      { teamId: "team_rlr_bob", slot: "BENCH", slotIndex: 0, playerId: "p_rlr_b" },
    ]);

    // A HELD trade, inserted directly — this proof is about the two-transaction lock order, not
    // about re-proving the threshold math `acceptTrade's hold branch` above already drives.
    const proposedAt = new Date(clock.now());
    await joinDb.insert(tradeProposals).values({
      id: "trade_rlr_1",
      leagueId: "lg_rl_res",
      proposerTeamId: "team_rlr_alice",
      counterpartyTeamId: "team_rlr_bob",
      weekNumber: 1,
      proposerAssets: [{ kind: "player", playerId: "p_rlr_a" }],
      counterpartyAssets: [{ kind: "player", playerId: "p_rlr_b" }],
      fingerprint: "fp_trade_rlr_1",
      note: null,
      status: "held",
      proposedAt,
      expiresAt: new Date(proposedAt.getTime() + 72 * 60 * 60 * 1000),
    });
    const flag = await joinDb.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "trade_hold",
        subjectId: "trade_rlr_1",
        leagueId: "lg_rl_res",
        evidence: {},
        raisedByUserId: null,
        occurredAt: clock.now(),
        newId: () => "flag_rlr_1",
      }),
    );

    const join = parkedJoin("lg_rl_res", "u_rlr_joiner", "team_rlr_joiner");
    await join.leagueLocked;

    const resolving = resolveFlag(resolveDb, {
      flagId: flag.id,
      decision: "trade_released",
      note: "",
      operatorUserId: "u_rlr_op",
      clock,
    });

    expect(await waitForBlockedBackend()).toBe(true);
    join.release();

    expect(await join.joining).toMatchObject({ ok: true, alreadyMember: false });
    expect(await resolving).toMatchObject({ ok: true, decision: "trade_released" });

    // Both transactions landed: the release really moved both rosters, and the flag closed.
    const aliceRows = await joinDb.select({ playerId: rosterSlots.playerId }).from(rosterSlots).where(eq(rosterSlots.teamId, "team_rlr_bob"));
    expect(aliceRows.some((row) => row.playerId === "p_rlr_a")).toBe(true);
    const [resolved] = await joinDb.select().from(integrityFlags).where(eq(integrityFlags.id, flag.id));
    expect(resolved!.resolvedAt).not.toBeNull();
  });
});

/**
 * Plan D, Task 5 — the guarded UPDATE both `releaseHeldTradeInTx` and `blockHeldTradeInTx` share
 * (`WHERE status = 'held'`), driven to a genuine loss on BOTH sides. `release` takes both teams'
 * rows `FOR UPDATE` before it ever reaches the guarded update; `block` takes no lock beyond the
 * row itself. A bystander holds `trade_proposals[id] FOR UPDATE` first, so both writers queue at
 * the SAME row, in the order they arrive — Postgres grants a contested row lock FIFO, so starting
 * one, confirming it is genuinely blocked, THEN starting the other, pins which one wins.
 */
describe("releaseHeldTradeInTx and blockHeldTradeInTx — the guarded UPDATE race, both directions", () => {
  /** `waitForBlockedBackend`'s own `> 0` check is ambiguous once a FIRST waiter is already
   *  parked — it would report "blocked" the instant the FIRST one queues, before the SECOND has
   *  necessarily reached its own wait. This waits for `count >= n`, so confirming the SECOND
   *  contender is used only once BOTH are genuinely queued (and therefore queued in the order
   *  each was started, which is what pins the winner deterministically). */
  async function waitForBlockedCount(n: number, timeoutMs = 5_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const rows = await joinDb.execute<{ count: string }>(
        sql`SELECT count(*) AS count FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`,
      );
      if (Number(rows[0]?.count ?? 0) >= n) return true;
      if (Date.now() > deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  async function seedHeldTrade(leagueId: string, suffix: string): Promise<{ readonly tradeId: string; readonly teamA: string; readonly teamB: string }> {
    await seedLeagueWith(leagueId, [`u_race_commish_${suffix}`, `u_race_alice_${suffix}`, `u_race_bob_${suffix}`, `u_race_op_${suffix}`]);
    const teamA = `team_race_alice_${suffix}`;
    const teamB = `team_race_bob_${suffix}`;
    await joinDb.insert(teams).values([
      { id: teamA, leagueId, userId: `u_race_alice_${suffix}`, name: "Alice's Team" },
      { id: teamB, leagueId, userId: `u_race_bob_${suffix}`, name: "Bob's Team" },
    ]);
    await joinDb.insert(players).values([
      { id: `p_race_a_${suffix}`, name: "Player A", position: "RB", nflTeam: "KC" },
      { id: `p_race_b_${suffix}`, name: "Player B", position: "RB", nflTeam: "SF" },
    ]);
    await joinDb.insert(rosterSlots).values([
      { teamId: teamA, slot: "BENCH", slotIndex: 0, playerId: `p_race_a_${suffix}` },
      { teamId: teamB, slot: "BENCH", slotIndex: 0, playerId: `p_race_b_${suffix}` },
    ]);
    const proposedAt = new Date(clock.now());
    const tradeId = `trade_race_${suffix}`;
    await joinDb.insert(tradeProposals).values({
      id: tradeId,
      leagueId,
      proposerTeamId: teamA,
      counterpartyTeamId: teamB,
      weekNumber: 1,
      proposerAssets: [{ kind: "player", playerId: `p_race_a_${suffix}` }],
      counterpartyAssets: [{ kind: "player", playerId: `p_race_b_${suffix}` }],
      fingerprint: `fp_${tradeId}`,
      note: null,
      status: "held",
      proposedAt,
      expiresAt: new Date(proposedAt.getTime() + 72 * 60 * 60 * 1000),
    });
    return { tradeId, teamA, teamB };
  }

  it("block wins a race that starts first — release loses the guarded update, cleanly", async () => {
    const { tradeId } = await seedHeldTrade("lg_race_block_wins", "bw");

    let holdsTradeLock: () => void = () => {};
    const tradeLocked = new Promise<void>((resolve) => (holdsTradeLock = resolve));
    let releaseBystander: () => void = () => {};
    const bystanderParked = new Promise<void>((resolve) => (releaseBystander = resolve));
    const holding = joinDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM trade_proposals WHERE id = ${tradeId} FOR UPDATE`);
      holdsTradeLock();
      await bystanderParked;
    });
    await tradeLocked;

    // T_block reaches the wait queue first — no team locks in its way, straight to the row.
    const blocking = blockDb.transaction((tx) => blockHeldTradeInTx(tx, { tradeId, leagueId: "lg_race_block_wins", operatorUserId: "u_race_op_bw", note: "" }));
    expect(await waitForBlockedBackend()).toBe(true);

    // T_release queues second, behind both the bystander AND (once released) block's own commit.
    const releasing = releaseDb.transaction((tx) => releaseHeldTradeInTx(tx, { tradeId, leagueId: "lg_race_block_wins", operatorUserId: "u_race_op_bw" }));
    expect(await waitForBlockedCount(2)).toBe(true);

    releaseBystander();
    await expect(holding).resolves.toBeUndefined();

    const blockResult = await blocking;
    const releaseResult = await releasing;
    expect(blockResult).toMatchObject({ ok: true });
    expect(releaseResult).toEqual({ ok: false, status: 409, reason: "This trade is no longer waiting on a decision." });

    const [row] = await joinDb.select().from(tradeProposals).where(eq(tradeProposals.id, tradeId));
    expect(row!.status).toBe("blocked");
  });

  it("release wins a race that starts first — block loses the guarded update, cleanly", async () => {
    const { tradeId } = await seedHeldTrade("lg_race_release_wins", "rw");

    let holdsTradeLock: () => void = () => {};
    const tradeLocked = new Promise<void>((resolve) => (holdsTradeLock = resolve));
    let releaseBystander: () => void = () => {};
    const bystanderParked = new Promise<void>((resolve) => (releaseBystander = resolve));
    const holding = joinDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM trade_proposals WHERE id = ${tradeId} FOR UPDATE`);
      holdsTradeLock();
      await bystanderParked;
    });
    await tradeLocked;

    // T_release queues first this time — its own team locks are uncontended, so it still reaches
    // the trade row's own guarded update ahead of T_block.
    const releasing = releaseDb.transaction((tx) => releaseHeldTradeInTx(tx, { tradeId, leagueId: "lg_race_release_wins", operatorUserId: "u_race_op_rw" }));
    expect(await waitForBlockedBackend()).toBe(true);

    const blocking = blockDb.transaction((tx) => blockHeldTradeInTx(tx, { tradeId, leagueId: "lg_race_release_wins", operatorUserId: "u_race_op_rw", note: "" }));
    expect(await waitForBlockedCount(2)).toBe(true);

    releaseBystander();
    await expect(holding).resolves.toBeUndefined();

    const releaseResult = await releasing;
    const blockResult = await blocking;
    expect(releaseResult).toMatchObject({ ok: true });
    expect(blockResult).toEqual({ ok: false, status: 409, reason: "This trade is no longer waiting on a decision." });

    const [row] = await joinDb.select().from(tradeProposals).where(eq(tradeProposals.id, tradeId));
    expect(row!.status).toBe("accepted");
  });
});

/**
 * Writer 6: `resolveFlag`'s `trade_reversed` branch — the only resolution shaped as TWO
 * transactions. `reverseTradeInTx` runs and COMMITS first on the LEAGUE chain, and only then does
 * `resolveFlag` open its own transaction for the PLATFORM-chain `flag_resolved` stamp. The suite
 * drove the `warned_user` and `content_removed` branches; this one was never driven at all, and it
 * is the branch that reaches for `leagues` twice, from two different transactions, around a real
 * roster mutation.
 */
describe("resolveFlag's trade_reversed branch — two transactions, two chains", () => {
  it("reverses a trade beside a concurrent join in the same league without deadlocking", async () => {
    await seedLeagueWith("lg_rv_res", ["u_rvr_commish", "u_rvr_alice", "u_rvr_bob", "u_rvr_joiner", "u_rvr_op"]);
    await joinDb.insert(teams).values([
      { id: "team_rvr_alice", leagueId: "lg_rv_res", userId: "u_rvr_alice", name: "Alice's Team" },
      { id: "team_rvr_bob", leagueId: "lg_rv_res", userId: "u_rvr_bob", name: "Bob's Team" },
    ]);
    await joinDb.insert(players).values([
      { id: "p_rvr_a", name: "Player A", position: "RB", nflTeam: "KC" },
      { id: "p_rvr_b", name: "Player B", position: "RB", nflTeam: "SF" },
    ]);
    await joinDb.insert(rosterSlots).values([
      { teamId: "team_rvr_alice", slot: "BENCH", slotIndex: 0, playerId: "p_rvr_a" },
      { teamId: "team_rvr_bob", slot: "BENCH", slotIndex: 0, playerId: "p_rvr_b" },
    ]);

    const proposed = await proposeTrade(pickDb, {
      leagueId: "lg_rv_res",
      userId: "u_rvr_alice",
      counterpartyTeamId: "team_rvr_bob",
      proposerAssets: [{ kind: "player", playerId: "p_rvr_a" }],
      counterpartyAssets: [{ kind: "player", playerId: "p_rvr_b" }],
      note: null,
      clock,
      deliver: async () => {},
    });
    if (!proposed.ok) throw new Error(proposed.reason);
    const accepted = await acceptTrade(pickDb, { tradeId: proposed.tradeId, leagueId: "lg_rv_res", userId: "u_rvr_bob", clock, deliver: async () => {} });
    if (!accepted.ok) throw new Error(accepted.reason);
    const flag = await joinDb.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "trade_fairness",
        subjectId: proposed.tradeId,
        leagueId: "lg_rv_res",
        evidence: {},
        raisedByUserId: null,
        occurredAt: clock.now(),
        newId: () => "flag_rvr_1",
      }),
    );

    const join = parkedJoin("lg_rv_res", "u_rvr_joiner", "team_rvr_joiner");
    await join.leagueLocked;

    const resolving = resolveFlag(resolveDb, {
      flagId: flag.id,
      decision: "trade_reversed",
      note: "Reversed.",
      operatorUserId: "u_rvr_op",
      clock,
    });

    expect(await waitForBlockedBackend()).toBe(true);
    join.release();

    expect(await join.joining).toMatchObject({ ok: true, alreadyMember: false });
    expect(await resolving).toMatchObject({ ok: true });

    // Both transactions landed: the reversal really moved both rosters back, and the flag closed.
    const aliceRows = await joinDb.select({ playerId: rosterSlots.playerId }).from(rosterSlots).where(eq(rosterSlots.teamId, "team_rvr_alice"));
    expect(aliceRows.some((row) => row.playerId === "p_rvr_a")).toBe(true);
    const [resolved] = await joinDb.select().from(integrityFlags).where(eq(integrityFlags.id, flag.id));
    expect(resolved!.resolvedAt).not.toBeNull();
  });
});

/**
 * Writer 7: `toggleReaction`. It shares no second resource with any trade writer by construction
 * (`chat_messages` read, `chat_reactions` write), but "by construction" is exactly the reasoning
 * that got `proposeTrade` wrong, so it is driven rather than argued. `chat_reactions` carries
 * foreign keys onto `chat_messages` AND `users`, both taken `FOR KEY SHARE` by its insert, and no
 * production caller takes a `users` row `FOR UPDATE` — so a bystander stands in for one, exactly
 * as `recordSessionSignals`' and `grantAdmin`'s own cases above do. The claim: it blocks on that
 * row, completes when released, and never reaches an audit anchor at all (a reaction is not an
 * audited event, which is the property that makes it incapable of joining any cycle this file
 * guards).
 */
describe("toggleReaction's reaction insert", () => {
  it("reacts beside a concurrent hold on the reacting user's row and completes without deadlocking", async () => {
    await seedLeagueWith("lg_react_lock", ["u_react_commish", "u_react_author", "u_react_fan"]);
    const [message] = await joinDb
      .insert(chatMessages)
      .values({ leagueId: "lg_react_lock", authorUserId: "u_react_author", body: "big play" })
      .returning({ id: chatMessages.id });

    let holdsUserLock: () => void = () => {};
    const userLocked = new Promise<void>((resolve) => (holdsUserLock = resolve));
    let releaseHold: () => void = () => {};
    const parked = new Promise<void>((resolve) => (releaseHold = resolve));
    const holding = joinDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM users WHERE id = ${"u_react_fan"} FOR UPDATE`);
      holdsUserLock();
      await parked;
    });
    await userLocked;

    const reacting = toggleReaction(resolveDb, {
      leagueId: "lg_react_lock",
      messageId: String(message!.id),
      userId: "u_react_fan",
      emoji: "🔥",
      publish: async () => "1-0",
    });

    expect(await waitForBlockedBackend()).toBe(true);
    releaseHold();

    await expect(holding).resolves.toBeUndefined();
    expect(await reacting).toMatchObject({ ok: true, action: "added" });

    // No chain of any kind: a reaction is not an audited event, so a wrong order here could only
    // ever cycle on the two rows above — which is the whole reason it is safe, proved rather than
    // asserted.
    expect(await joinDb.select().from(auditChains)).toEqual([]);
  });
});

/**
 * Task 3's own transaction, and the last one this file adds. `recordTierBlockedJoin`
 * (`@/league-service/join`) writes a `member_notices` row carrying a foreign key to `leagues` —
 * the SAME implicit `FOR KEY SHARE` every notice-writing transaction in this file already takes —
 * BEFORE it reaches the platform chain's own anchor, exactly like `raiseFlag`'s and `grantAdmin`'s
 * own shape above. It runs in a WHOLLY SEPARATE transaction from the join it explains, always
 * AFTER that join's own transaction has already rolled back (`join.ts`'s own docblock), so the
 * question this proof answers is narrower than "does it deadlock against the join that triggered
 * it" (that join is long gone by the time this runs in production) and exactly the one the brief
 * asks for: does this write cycle against ANY OTHER concurrent join to the SAME league, the
 * ordinary case of one visitor being refused while somebody else is mid-join next to them.
 *
 * Driven against a parked `joinLeagueInTx` holding `leagues[X] FOR UPDATE`, the same rendezvous
 * every pair above uses: `recordTierBlockedJoin` blocks behind it (a real, observed block — Postgres
 * genuinely holds this connection on the row, not a skipped-past read), and completes the moment
 * the hold releases, on the PLATFORM chain, never the league's own — proof that the block's own
 * write costs a concurrent join nothing but an ordinary row-lock wait, never a cycle.
 */
describe("recordTierBlockedJoin's notice order", () => {
  it("blocks behind a concurrent join holding the SAME league row, and completes on the platform chain once it releases", async () => {
    await seedLeagueWith("lg_tier_block_lock", ["u_tb_commish", "u_tb_joiner", "u_tb_blocked"]);

    const join = parkedJoin("lg_tier_block_lock", "u_tb_joiner", "team_tb_joiner");
    await join.leagueLocked;

    // T_block: the real `recordTierBlockedJoin`, on its own connection, reaching for the SAME
    // league row through its notice insert (`leagues` FOR KEY SHARE) before it reaches the
    // platform anchor.
    const blocking = recordTierBlockedJoin(resolveDb, {
      leagueId: "lg_tier_block_lock",
      userId: "u_tb_blocked",
      occurredAt: clock.now(),
    });

    expect(await waitForBlockedBackend()).toBe(true);
    join.release();

    expect(await join.joining).toMatchObject({ ok: true, alreadyMember: false });
    await expect(blocking).resolves.toBeUndefined();

    // The league chain holds only the join's own `member_joined` — the tier block never reaches it.
    const [leagueAnchor] = await joinDb.select().from(auditChains).where(eq(auditChains.scope, "lg_tier_block_lock"));
    expect(leagueAnchor!.headSequence).toBe(1);
    // The platform chain holds only the block's own `system_action` — proof the two really did
    // land on separate chains despite reaching for the same league row on the way there.
    const [platformAnchor] = await joinDb.select().from(auditChains).where(eq(auditChains.scope, "platform"));
    expect(platformAnchor!.headSequence).toBe(1);

    const [notice] = await joinDb.select().from(memberNotices).where(eq(memberNotices.userId, "u_tb_blocked"));
    expect(notice).toMatchObject({ leagueId: "lg_tier_block_lock", noticeType: "tier_blocked_join" });
    expect(notice?.auditEventId).not.toBeNull();
  });
});

/**
 * PHASE 3 PLAN D, TASK 4's own transaction (Step 7): `autoSetLineupInTx`
 * (`@/league-service/auto-lineup`) takes `stat_weeks[week] FOR SHARE` FIRST, matching `setLineup`
 * and `acceptTrade` — all THREE roster-adjacent writers in the same position — but doing the
 * opposite job it does there: this writer REQUIRES the week to be locked, so it is the one whose
 * own read can genuinely block behind a concurrent WRITE to that row (the ingestion worker's own
 * `persistTick`, matched here by a real transaction taking the identical row-exclusive lock
 * `persistTick`'s own upsert would).
 */
describe("autoSetLineupInTx's week lock", () => {
  it("blocks a concurrent run behind a real stat-week write, and proceeds once it sees the flip", async () => {
    const leagueId = "lg_auto_week_lock";
    await seedLeagueWith(leagueId, ["u_aw_commish", "u_aw_alice"]);
    await joinDb.update(leagues).set({ isPublicMatchmade: true }).where(eq(leagues.id, leagueId));
    await joinDb.insert(teams).values([
      { id: "team_aw_commish", leagueId, userId: "u_aw_commish", name: "Commish" },
      { id: "team_aw_alice", leagueId, userId: "u_aw_alice", name: "Alice" },
    ]);
    await joinDb.transaction((tx) => writeSchedule(tx, { leagueId, teamIds: ["team_aw_commish", "team_aw_alice"], weeks: 4 }));
    // An EXISTING row, matching `persistTick`'s own upsert shape — a `SELECT … FOR SHARE` against
    // a row still being INSERTED (never committed, so not yet visible) would not block at all.
    await joinDb.insert(statWeeks).values({ week: 4, status: "scheduled" });

    let releaseFlip: () => void = () => {};
    const released = new Promise<void>((resolve) => (releaseFlip = resolve));
    const flipping = joinDb.transaction(async (tx) => {
      await tx.update(statWeeks).set({ status: "in_progress" }).where(eq(statWeeks.week, 4));
      await released;
    });

    // T_autoset: the real `autoSetLineupsForWeek`, on its own connection, reaching for the SAME
    // week row through `autoSetLineupInTx`'s own FOR SHARE re-check.
    const settingLineups = autoSetLineupsForWeek(pickDb, { weekNumber: 4, occurredAt: clock.now() });

    expect(await waitForBlockedBackend()).toBe(true);
    releaseFlip();
    await flipping;

    const outcome = await settingLineups;
    expect(outcome.leaguesFailed).toEqual([]);
    // Blocked on the WEEK, never on the anchor: neither team has a previous week's saved lineup
    // (their first week touched), so nothing is notified and no `system_action` is ever written —
    // the anchor is never even created.
    expect(outcome.teamsSet).toBe(2);
    const [anchor] = await joinDb.select().from(auditChains).where(eq(auditChains.scope, leagueId));
    expect(anchor).toBeUndefined();
  });
});

/**
 * Step 7's second proof: a real `setLineup` and a real `autoSetLineupsForWeek` in the SAME
 * league, overlapping in time, reaching for the SAME chain anchor from two different teams —
 * proving they QUEUE on it rather than cycle. `setLineup` is parked with the SAME technique
 * `notify.ts`'s own docblock describes for `attachAuditEvent`: paused AFTER its real
 * `audit.record` call returns (the anchor row is `FOR UPDATE`, held by the still-open
 * transaction) and BEFORE the transaction commits, via an injected `AuditLogger` whose `record`
 * delegates to the real one and then waits — `setLineup`'s own dependency-injection seam, the
 * same one `lineups.test.ts` already uses to force an audit failure.
 *
 * DELIBERATELY TWO DIFFERENT WEEKS. Alice's parked save targets week 3, which is untouched by
 * `stat_weeks` and so reads as `"scheduled"` — `setLineup` REFUSES a locked week outright, so a
 * save aimed at the SAME locked week 4 `autoSetLineupInTx` requires would never reach its own
 * `audit.record` call at all, and the two writers could never contend for anything. Alice's row
 * for week 4 is created and COMMITTED in a setup step BEFORE the concurrent phase instead, so
 * `autoSetLineupInTx`'s own per-team existence check excludes her from its week-4 run entirely —
 * the two writers never touch the same `lineup_slots` row, which is what makes this a proof about
 * the ANCHOR (the one thing they still share: one league, one chain) and not an accidental proof
 * about something else.
 */
describe("autoSetLineupInTx's team-lock order — a parked setLineup queues rather than cycles with it", () => {
  it("lets a manual save and an auto-set run in the same league both complete without deadlocking", async () => {
    const leagueId = "lg_auto_team_lock";
    await seedLeagueWith(leagueId, ["u_at_commish", "u_at_alice", "u_at_carol"]);
    await joinDb
      .update(leagues)
      .set({ isPublicMatchmade: true, rosterSlots: SPRINT_ROSTER_SLOTS })
      .where(eq(leagues.id, leagueId));
    await joinDb.insert(teams).values([
      { id: "team_at_alice", leagueId, userId: "u_at_alice", name: "Alice" },
      { id: "team_at_carol", leagueId, userId: "u_at_carol", name: "Carol" },
    ]);
    await joinDb.insert(players).values([
      { id: "p_at_alice_qb", name: "Alice QB", position: "QB", nflTeam: "KC" },
      { id: "p_at_alice_rb", name: "Alice RB", position: "RB", nflTeam: "KC" },
      { id: "p_at_alice_wr", name: "Alice WR", position: "WR", nflTeam: "KC" },
      { id: "p_at_carol_qb", name: "Carol QB", position: "QB", nflTeam: "SF" },
      { id: "p_at_carol_rb", name: "Carol RB", position: "RB", nflTeam: "SF" },
      { id: "p_at_carol_wr", name: "Carol WR", position: "WR", nflTeam: "SF" },
    ]);
    await joinDb.insert(rosterSlots).values([
      { teamId: "team_at_alice", slot: "QB", slotIndex: 0, playerId: "p_at_alice_qb" },
      { teamId: "team_at_alice", slot: "RB", slotIndex: 0, playerId: "p_at_alice_rb" },
      { teamId: "team_at_alice", slot: "WR", slotIndex: 0, playerId: "p_at_alice_wr" },
      { teamId: "team_at_carol", slot: "QB", slotIndex: 0, playerId: "p_at_carol_qb" },
      { teamId: "team_at_carol", slot: "RB", slotIndex: 0, playerId: "p_at_carol_rb" },
      { teamId: "team_at_carol", slot: "WR", slotIndex: 0, playerId: "p_at_carol_wr" },
    ]);
    await joinDb.transaction((tx) => writeSchedule(tx, { leagueId, teamIds: ["team_at_alice", "team_at_carol"], weeks: 4 }));

    const aliceStarters = [
      { slot: "QB" as const, slotIndex: 0, playerId: "p_at_alice_qb" },
      { slot: "RB" as const, slotIndex: 0, playerId: "p_at_alice_rb" },
      { slot: "WR" as const, slotIndex: 0, playerId: "p_at_alice_wr" },
    ];
    // Carol's WEEK 3 save is what gives her a `previousLineup` to carry forward — without it the
    // auto-set materializes her roster silently and never reaches for the anchor at all.
    await setLineup(joinDb, { leagueId, teamId: "team_at_carol", weekNumber: 3, slots: [
      { slot: "QB", slotIndex: 0, playerId: "p_at_carol_qb" },
      { slot: "RB", slotIndex: 0, playerId: "p_at_carol_rb" },
      { slot: "WR", slotIndex: 0, playerId: "p_at_carol_wr" },
    ], userId: "u_at_carol" });
    // Alice's week 4 row, created and COMMITTED before the concurrent phase, and before week 4
    // locks — see this `describe` block's own docblock for why this is what keeps the race honest.
    await setLineup(joinDb, { leagueId, teamId: "team_at_alice", weekNumber: 4, slots: aliceStarters, userId: "u_at_alice" });
    // NOW week 4 locks — after both setup saves, which `setLineup` would otherwise refuse.
    await joinDb.insert(statWeeks).values({ week: 4, status: "in_progress" });

    const realAudit = getAuditLogger();
    let holdsAnchor: () => void = () => {};
    const anchorHeld = new Promise<void>((resolve) => (holdsAnchor = resolve));
    let releaseSave: () => void = () => {};
    const parked = new Promise<void>((resolve) => (releaseSave = resolve));
    const pausingAudit: AuditLogger = {
      record: async (tx, input) => {
        const event = await realAudit.record(tx, input);
        holdsAnchor();
        await parked;
        return event;
      },
      recordAll: (tx, inputs) => realAudit.recordAll(tx, inputs),
    };

    // T_save: alice's FIRST save of week 3 (still `"scheduled"`, so `setLineup` accepts it),
    // parked right after its own `lineup_change` event mints — the anchor row is `FOR UPDATE` for
    // as long as this transaction stays open.
    const saving = setLineup(
      joinDb,
      { leagueId, teamId: "team_at_alice", weekNumber: 3, slots: aliceStarters, userId: "u_at_alice" },
      undefined,
      { audit: pausingAudit, clock },
    );
    await anchorHeld;

    // T_autoset: the real `autoSetLineupsForWeek`, on its own connection, processing ONLY carol
    // at week 4 (alice already has a committed week-4 row) and reaching for the SAME chain's
    // anchor through her own `system_action`.
    const settingLineups = autoSetLineupsForWeek(pickDb, { weekNumber: 4, occurredAt: clock.now() });

    expect(await waitForBlockedBackend()).toBe(true);
    releaseSave();

    const saved = await saving;
    expect(saved.ok).toBe(true);
    const outcome = await settingLineups;
    expect(outcome.leaguesFailed).toEqual([]);
    expect(outcome.teamsSet).toBe(1); // carol only — alice was left entirely alone at week 4

    // Both landed on the SAME chain: carol's week-3 save, alice's week-4 save, alice's parked
    // week-3 save, and carol's own `lineup_auto_set` system_action — four events, one batch, no
    // cycle.
    const [anchor] = await joinDb.select().from(auditChains).where(eq(auditChains.scope, leagueId));
    expect(anchor!.headSequence).toBe(4);

    const [carolNotice] = await joinDb.select().from(memberNotices).where(eq(memberNotices.userId, "u_at_carol"));
    expect(carolNotice).toMatchObject({ leagueId, noticeType: "lineup_auto_set" });
    expect(carolNotice?.auditEventId).not.toBeNull();
  });
});

/**
 * PHASE 3 PLAN D, TASK 7's own transaction, FUSED (review fix round 1, F1): `startDraft`'s own
 * `alsoInTransaction` hook (`@/draft-service/store.ts`), given `{ auto: true }`, inserts one
 * `member_notices` row per TEAM in the league — an implicit `FOR KEY SHARE` on `leagues` for every
 * one of them — before its own league-chain anchor, all inside the SAME transaction as the
 * `drafts FOR UPDATE` lock, the claim, and the `START_DRAFT` append. The identical shape
 * `recordTierBlockedJoin`'s own test above proves safe, now proven for the fused transaction
 * rather than for a since-removed standalone `announceDraftAutoStarted`.
 */
describe("startDraft's fused auto-start announcement, { auto: true }", () => {
  it("announces an auto-started draft beside a concurrent join in the same league without deadlocking", async () => {
    const { draftId, leagueId, teamIds } = await seedDraftFixture(joinDb, {
      draftId: "draft_auto_start_lock",
      leagueId: "lg_auto_start_lock",
      format: "snake",
      teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
      auctionBudget: null,
      isPublicMatchmade: true,
    });
    await joinDb.insert(players).values(POOL.map((entry) => ({ id: entry.playerId, name: entry.playerId, position: entry.position, nflTeam: "FA" })));
    // An open seat for the joiner, the identical reason the autopick test above needs one.
    await joinDb.update(leagues).set({ teamCount: 3 }).where(eq(leagues.id, leagueId));
    await joinDb.insert(users).values({ id: "u_as_joiner", email: "joiner@test.local", displayName: "Joiner" });

    const join = parkedJoin(leagueId, "u_as_joiner", "team_as_joiner");
    await join.leagueLocked;

    // T_start: the real `startDraft(draftId, { auto: true })`, on its own connection, reaching
    // for the SAME league row through its fused announcement's notice inserts before its own
    // league-chain anchor — the exact statement order `alsoInTransaction`'s own docblock states.
    const store = createDraftStore({ db: resolveDb, publish: async () => "1-0", clock, deliverNotice: async () => {} });
    const starting = store.startDraft(draftId, { auto: true });

    expect(await waitForBlockedBackend()).toBe(true);
    join.release();

    expect(await join.joining).toMatchObject({ ok: true, alreadyMember: false });
    const started = await starting;
    expect(started.ok).toBe(true);
    expect(teamIds).toHaveLength(2); // the two teams the fused announcement notified

    const notices = await joinDb.select().from(memberNotices).where(eq(memberNotices.noticeType, "draft_auto_started"));
    expect(notices).toHaveLength(2);
    for (const notice of notices) expect(notice.auditEventId).not.toBeNull();

    // Both landed on the SAME league chain: the join's own `member_joined`, then the fused
    // announcement's own single `system_action` shared by both notices — one chain, no cycle.
    const [anchor] = await joinDb.select().from(auditChains).where(eq(auditChains.scope, leagueId));
    expect(anchor!.headSequence).toBe(2);
  });
});
