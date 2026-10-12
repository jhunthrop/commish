import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@research/db/client";
import { auditEvents, drafts, leagues, moneyAccounts, moneyTransactions, teams, users } from "@/db/schema";
import { createTestDb, recordStatements } from "@research/db/test-db";
import { truncateAll, truncateMoneyTables } from "@/db/test-db";
import type { Clock } from "@research/domain/timing";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { joinPublicLeague, LEAGUE_FULL } from "@/league-service/join";
import { releaseSeat } from "@/league-service/release";
import { accountIdFor } from "@/money/accounts";
import { MONEY_REFUSALS } from "@/money/config";
import type { PrizeTable } from "@/money/prize-table";
import { MONEY_STATES, type MoneyStatesConfig, type StateCode } from "@/money/states";
import { collectEntryFeeInTx, refundEntryFeeInTx, type EntryFeeDeps } from "./entry-fee";
import { postMoneyTransaction, type PostDeps } from "./post";
import { walletSummary } from "./read";
import { expectNoPostingTookPlace, snapshotMoneyBook } from "./test-support";

/**
 * Task 8's own suite: money threaded through the join and release doors that shipped in Phase
 * 3.6, and — first among equals — the FREE-SEASON PROOF: a free league's join and release run
 * without a single `money_*` statement, held by `recordStatements`' log rather than promised by
 * a code read.
 */

const db = createTestDb();
/** A second pool for the two-connection race proofs — a transaction parked on `db` cannot also
 *  drive the writer that must block behind it. */
const raceDb = createTestDb();

const NOW = "2026-09-01T00:00:00.000Z";
const clock: Clock = { now: () => NOW };
let nextId = 0;
const newId = () => `fee_${(nextId += 1)}`;
const audit = getAuditLogger();
const postDeps: PostDeps = { audit, clock, newId };

/** The test-only enabled entry — the shipped `MONEY_STATES.enabled` stays empty everywhere. */
const enabledTN: MoneyStatesConfig = {
  enabled: [{ state: "TN", minAge: 18 }],
  neverEligible: MONEY_STATES.neverEligible,
};
const feeDeps: EntryFeeDeps = { ...postDeps, states: enabledTN };

const FEE = 20_00;

async function seedUser(id: string, overrides: Partial<typeof users.$inferInsert> = {}): Promise<void> {
  await db
    .insert(users)
    .values({ id, email: `${id}@test.local`, displayName: id, kycStatus: "verified", ...overrides })
    .onConflictDoNothing();
}

/** A public, pre-draft league seeded directly — paid when `entryFeeCents > 0`, with a prize
 *  table that balances the pot exactly (`platformFeeCents` stays 0 in this suite; the sweep is
 *  Task 10's). `filled` seats are seeded rows, deliberately UNPAID — the book, not the seat
 *  count, is what decides a refund. */
async function seedLeague(input: {
  readonly id: string;
  readonly teamCount?: number;
  readonly entryFeeCents?: number;
  readonly filled?: number;
}): Promise<string> {
  const teamCount = input.teamCount ?? 4;
  const entryFeeCents = input.entryFeeCents ?? 0;
  const payoutTable: PrizeTable | null = entryFeeCents > 0 ? [{ place: 1, amountCents: entryFeeCents * teamCount }] : null;
  await db.insert(leagues).values({
    id: input.id,
    name: "Entry Fee Test League",
    format: "snake",
    teamCount,
    stakeTier: 0,
    experienceTier: "beginner",
    isPublicMatchmade: true,
    commissionerUserId: null,
    houseRung: "open_12",
    entryFeeCents,
    platformFeeCents: 0,
    payoutTable,
  });
  await db.insert(drafts).values({
    id: `${input.id}_draft`,
    leagueId: input.id,
    format: "snake",
    status: "scheduled",
    kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
    auctionBudget: null,
    startTrigger: "scheduled",
  });
  for (let i = 0; i < (input.filled ?? 0); i++) {
    const userId = `${input.id}_seat_${i}`;
    await seedUser(userId);
    await db.insert(teams).values({ id: `${input.id}_t${i}`, leagueId: input.id, userId, name: `Seat ${i}` });
  }
  return input.id;
}

/** Funds `userId` through the one writer, the lock-order suite's own idiom. */
async function fund(userId: string, amountCents: number): Promise<void> {
  const outcome = await db.transaction((tx) =>
    postMoneyTransaction(
      tx,
      {
        kind: "deposit",
        stateOfEntry: "TN",
        entries: [
          { accountId: accountIdFor("fbo_pool"), direction: "debit", amountCents },
          { accountId: accountIdFor("user_available", userId), direction: "credit", amountCents },
        ],
        auditEvent: { eventType: "deposit_completed", actorId: userId, actorType: "user", leagueId: null, payload: { amountCents } },
      },
      postDeps,
    ),
  );
  expect(outcome).toMatchObject({ ok: true });
}

/** Books a returned-deposit debt on `userId` — the receivable the spend gates must refuse over. */
async function owe(runOn: Db, userId: string, amountCents: number): Promise<void> {
  const outcome = await runOn.transaction((tx) => oweInTx(tx, userId, amountCents));
  expect(outcome).toMatchObject({ ok: true });
}

function oweInTx(tx: Parameters<Parameters<Db["transaction"]>[0]>[0], userId: string, amountCents: number) {
  return postMoneyTransaction(
    tx,
    {
      kind: "deposit_return",
      stateOfEntry: "TN",
      entries: [
        { accountId: accountIdFor("fbo_pool"), direction: "credit", amountCents },
        { accountId: accountIdFor("platform_receivable", userId), direction: "debit", amountCents },
      ],
      auditEvent: { eventType: "deposit_returned", actorId: userId, actorType: "user", leagueId: null, payload: { amountCents, shortfallCents: amountCents } },
    },
    postDeps,
  );
}

function paidJoin(runOn: Db, leagueId: string, userId: string, stateOfEntry: StateCode = "TN") {
  return joinPublicLeague({ db: runOn, newId: () => newId(), clock }, { leagueId, userId, money: { stateOfEntry, states: enabledTN } });
}

async function seatCount(leagueId: string, userId: string): Promise<number> {
  return (await db.select({ id: teams.id }).from(teams).where(and(eq(teams.leagueId, leagueId), eq(teams.userId, userId)))).length;
}

/** `lock-order.test.ts`'s own poll: resolves once some backend on this database is genuinely
 *  blocked on a lock — the rendezvous that makes the race proofs deterministic. */
async function waitForBlockedBackend(timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`,
    );
    if (Number(rows[0]?.count ?? 0) > 0) return true;
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

beforeEach(async () => {
  await truncateAll(db);
  await truncateMoneyTables(db);
  nextId = 0;
});

afterAll(async () => {
  await truncateAll(db);
  await truncateMoneyTables(db);
});

describe("the free-season law", () => {
  it("lets a free league join run without a single money table read or write", async () => {
    await seedLeague({ id: "lg_free" });
    await seedUser("u_free");
    const statements = await recordStatements(db, (logged) =>
      joinPublicLeague({ db: logged, newId: () => newId(), clock }, { leagueId: "lg_free", userId: "u_free" }).then((outcome) => {
        expect(outcome).toMatchObject({ ok: true, alreadyMember: false });
      }),
    );
    expect(statements.length).toBeGreaterThan(0);
    expect(statements.filter((s) => /money_/.test(s))).toHaveLength(0);
    await expectNoPostingTookPlace(db);
  });

  it("lets a free league release run without a single money table read or write", async () => {
    await seedLeague({ id: "lg_free" });
    await seedUser("u_free");
    expect(await paidJoin(db, "lg_free", "u_free")).toMatchObject({ ok: true });
    const statements = await recordStatements(db, (logged) =>
      releaseSeat(logged, { leagueId: "lg_free", userId: "u_free" }, { clock }).then((outcome) => {
        expect(outcome).toEqual({ ok: true });
      }),
    );
    expect(statements.length).toBeGreaterThan(0);
    expect(statements.filter((s) => /money_/.test(s))).toHaveLength(0);
    await expectNoPostingTookPlace(db);
  });
});

describe("collectEntryFeeInTx through the join door", () => {
  it("collects exactly the published fee into the league's escrow, audited on the league chain", async () => {
    await seedLeague({ id: "lg_paid", entryFeeCents: FEE });
    await seedUser("u1");
    await fund("u1", 50_00);

    const outcome = await paidJoin(db, "lg_paid", "u1");
    expect(outcome).toMatchObject({ ok: true, alreadyMember: false });

    const summary = await walletSummary(db, "u1");
    expect(summary.availableCents).toBe(30_00);
    expect(summary.escrowCents).toBe(FEE);
    const [escrow] = await db.select().from(moneyAccounts).where(eq(moneyAccounts.id, accountIdFor("league_escrow", "lg_paid")));
    expect(escrow!.balanceCents).toBe(FEE);

    const [txn] = await db.select().from(moneyTransactions).where(eq(moneyTransactions.kind, "entry_fee"));
    expect(txn).toMatchObject({ kind: "entry_fee", leagueId: "lg_paid" });
    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "entry_fee_collected"));
    expect(event).toMatchObject({ leagueId: "lg_paid", actorId: "u1", actorType: "user", payload: { amountCents: FEE } });
    expect(await seatCount("lg_paid", "u1")).toBe(1);
  });

  it("refuses a paid join on insufficient balance with no seat taken and no money moved", async () => {
    await seedLeague({ id: "lg_paid", entryFeeCents: FEE });
    await seedUser("u_broke");

    const outcome = await paidJoin(db, "lg_paid", "u_broke");
    expect(outcome).toEqual({ ok: false, status: 409, reason: MONEY_REFUSALS.insufficientBalance });
    await expectNoPostingTookPlace(db);
    expect(await seatCount("lg_paid", "u_broke")).toBe(0);

    // The refusal burned nothing: funded, the same member walks straight in.
    await fund("u_broke", FEE);
    expect(await paidJoin(db, "lg_paid", "u_broke")).toMatchObject({ ok: true, alreadyMember: false });
  });

  it("refuses a paid join that arrives with no attested state, with the state gate's own sentence", async () => {
    await seedLeague({ id: "lg_paid", entryFeeCents: FEE });
    await seedUser("u1");
    await fund("u1", FEE);
    const before = await snapshotMoneyBook(db);
    const outcome = await joinPublicLeague({ db, newId: () => newId(), clock }, { leagueId: "lg_paid", userId: "u1" });
    expect(outcome).toEqual({ ok: false, status: 403, reason: MONEY_REFUSALS.stateNotEnabled });
    expect(await seatCount("lg_paid", "u1")).toBe(0);
    await expectNoPostingTookPlace(db, before);
  });

  it("runs every money gate, in the gates' own order, before any seat commits", async () => {
    await seedLeague({ id: "lg_paid", entryFeeCents: FEE, teamCount: 8 });

    // Gate 1 — state: attested somewhere the enabled list does not name.
    await seedUser("u_ca");
    await fund("u_ca", FEE);
    let before = await snapshotMoneyBook(db);
    expect(await paidJoin(db, "lg_paid", "u_ca", "CA")).toEqual({ ok: false, status: 403, reason: MONEY_REFUSALS.stateNotEnabled });
    await expectNoPostingTookPlace(db, before);
    expect(await seatCount("lg_paid", "u_ca")).toBe(0);

    // Gate 2 — KYC.
    await seedUser("u_unverified", { kycStatus: "none" });
    await fund("u_unverified", FEE);
    before = await snapshotMoneyBook(db);
    expect(await paidJoin(db, "lg_paid", "u_unverified")).toEqual({ ok: false, status: 403, reason: MONEY_REFUSALS.kycRequired });
    await expectNoPostingTookPlace(db, before);
    expect(await seatCount("lg_paid", "u_unverified")).toBe(0);

    // Gate 3 — self-exclusion closes the doors money enters.
    await seedUser("u_excluded", { selfExcludedAt: new Date(NOW) });
    await fund("u_excluded", FEE);
    before = await snapshotMoneyBook(db);
    expect(await paidJoin(db, "lg_paid", "u_excluded")).toEqual({ ok: false, status: 403, reason: MONEY_REFUSALS.selfExcluded });
    await expectNoPostingTookPlace(db, before);
    expect(await seatCount("lg_paid", "u_excluded")).toBe(0);

    // Gate 4 — a committed receivable refuses at the advisory read already.
    await seedUser("u_owes");
    await fund("u_owes", FEE);
    await owe(db, "u_owes", 5_00);
    before = await snapshotMoneyBook(db);
    expect(await paidJoin(db, "lg_paid", "u_owes")).toEqual({ ok: false, status: 403, reason: MONEY_REFUSALS.balanceOwed });
    await expectNoPostingTookPlace(db, before);
    expect(await seatCount("lg_paid", "u_owes")).toBe(0);
  });

  it("re-checks the receivable under the writer's locks: a debt that lands mid-join refuses what the advisory gate had waved through", async () => {
    // The Task 5 review carry, driven for real on two connections: the gate's unlocked sum reads
    // clear, a concurrent ACH-return books the debt while the join waits on the receivable's own
    // row lock, and the LOCKED re-check answers with the refusal — no seat, no fee.
    await seedLeague({ id: "lg_owe", entryFeeCents: FEE });
    await seedUser("u_mid");
    await fund("u_mid", FEE);

    let parked!: () => void;
    const parkedAt = new Promise<void>((resolve) => (parked = resolve));
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const returnTx = raceDb.transaction(async (tx) => {
      const posted = await oweInTx(tx, "u_mid", 5_00);
      expect(posted).toMatchObject({ ok: true });
      parked();
      await released;
    });
    await parkedAt;

    const joining = paidJoin(db, "lg_owe", "u_mid");
    expect(await waitForBlockedBackend()).toBe(true);
    release();
    await returnTx;

    expect(await joining).toEqual({ ok: false, status: 403, reason: MONEY_REFUSALS.balanceOwed });
    expect(await seatCount("lg_owe", "u_mid")).toBe(0);
    const book = await snapshotMoneyBook(db);
    expect(book.transactions.filter((t) => t.kind === "entry_fee")).toHaveLength(0);
  });

  it("charges exactly N-1 winners of an N-way race for the last seats, and the loser pays nothing", async () => {
    // Rides joinLeagueInTx's existing leagues FOR UPDATE — the capacity race was solved in Phase
    // 3.5; this asserts money inherited the solution rather than re-solving it.
    await seedLeague({ id: "lg_race", entryFeeCents: FEE, teamCount: 4, filled: 2 });
    for (const userId of ["r1", "r2", "r3"]) {
      await seedUser(userId);
      await fund(userId, FEE);
    }

    const outcomes = await Promise.all([paidJoin(db, "lg_race", "r1"), paidJoin(db, "lg_race", "r2"), paidJoin(db, "lg_race", "r3")]);
    const winners = outcomes.filter((o) => o.ok);
    const losers = outcomes.filter((o) => !o.ok);
    expect(winners).toHaveLength(2);
    expect(losers).toEqual([{ ok: false, status: 409, reason: LEAGUE_FULL }]);

    const fees = await db.select().from(moneyTransactions).where(eq(moneyTransactions.kind, "entry_fee"));
    expect(fees).toHaveLength(2);
    const [escrow] = await db.select().from(moneyAccounts).where(eq(moneyAccounts.id, accountIdFor("league_escrow", "lg_race")));
    expect(escrow!.balanceCents).toBe(2 * FEE);
    // The loser's money never moved.
    const seated = await db.select({ userId: teams.userId }).from(teams).where(eq(teams.leagueId, "lg_race"));
    const loserId = ["r1", "r2", "r3"].find((id) => !seated.some((s) => s.userId === id))!;
    expect((await walletSummary(db, loserId)).availableCents).toBe(FEE);
  });

  it("rolls the seat back with the fee when the audit append inside the posting throws, and answers the door's own 500", async () => {
    await seedLeague({ id: "lg_paid", entryFeeCents: FEE });
    await seedUser("u1");
    await fund("u1", FEE);
    const before = await snapshotMoneyBook(db);
    const throwingAudit: AuditLogger = {
      record: async () => {
        throw new Error("audit down");
      },
      recordAll: async () => {
        throw new Error("audit down");
      },
    };
    const outcome = await joinPublicLeague(
      { db, newId: () => newId(), clock, audit: throwingAudit },
      { leagueId: "lg_paid", userId: "u1", money: { stateOfEntry: "TN", states: enabledTN } },
    );
    expect(outcome).toMatchObject({ ok: false, status: 500 });
    await expectNoPostingTookPlace(db, before);
    expect(await seatCount("lg_paid", "u1")).toBe(0);
  });

  it("throws for a user row that does not exist — a caller bug, never a member-facing refusal", async () => {
    await seedLeague({ id: "lg_paid", entryFeeCents: FEE });
    await expect(
      db.transaction((tx) => collectEntryFeeInTx(tx, { leagueId: "lg_paid", userId: "ghost", entryFeeCents: FEE, stateOfEntry: "TN" }, feeDeps)),
    ).rejects.toThrow(/no user row/);
  });
});

describe("refundEntryFeeInTx through the release door", () => {
  it("refunds the whole entry fee when a member releases their seat before the draft", async () => {
    await seedLeague({ id: "lg1", entryFeeCents: FEE });
    await seedUser("u1");
    await fund("u1", FEE);
    expect(await paidJoin(db, "lg1", "u1")).toMatchObject({ ok: true });
    expect((await walletSummary(db, "u1")).availableCents).toBe(0);

    // No injected `newId`: the release door's own default id mint is the production path.
    const released = await releaseSeat(db, { leagueId: "lg1", userId: "u1" }, { clock });
    expect(released).toEqual({ ok: true });

    const summary = await walletSummary(db, "u1");
    expect(summary.availableCents).toBe(FEE);
    expect(summary.escrowCents).toBe(0);
    const [escrow] = await db.select().from(moneyAccounts).where(eq(moneyAccounts.id, accountIdFor("league_escrow", "lg1")));
    expect(escrow!.balanceCents).toBe(0);
    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "entry_fee_refunded"));
    expect(event).toMatchObject({ leagueId: "lg1", actorId: "u1", actorType: "user", payload: { amountCents: FEE } });
  });

  it("charges again on a rejoin after a refund — the book's net, not a lifetime flag", async () => {
    await seedLeague({ id: "lg1", entryFeeCents: FEE });
    await seedUser("u1");
    await fund("u1", FEE);
    expect(await paidJoin(db, "lg1", "u1")).toMatchObject({ ok: true });
    expect(await releaseSeat(db, { leagueId: "lg1", userId: "u1" }, { clock, newId })).toEqual({ ok: true });
    expect(await paidJoin(db, "lg1", "u1")).toMatchObject({ ok: true, alreadyMember: false });
    expect(await releaseSeat(db, { leagueId: "lg1", userId: "u1" }, { clock, newId })).toEqual({ ok: true });

    expect((await walletSummary(db, "u1")).availableCents).toBe(FEE);
    expect(await db.select().from(moneyTransactions).where(eq(moneyTransactions.kind, "entry_fee"))).toHaveLength(2);
    expect(await db.select().from(moneyTransactions).where(eq(moneyTransactions.kind, "entry_fee_refund"))).toHaveLength(2);
  });

  it("refunds nothing for a seat the book never charged — a seeded seat leaves with no posting", async () => {
    await seedLeague({ id: "lg1", entryFeeCents: FEE, filled: 1 });
    const seededUserId = "lg1_seat_0";
    const before = await snapshotMoneyBook(db);
    expect(await releaseSeat(db, { leagueId: "lg1", userId: seededUserId }, { clock, newId })).toEqual({ ok: true });
    await expectNoPostingTookPlace(db, before);
  });

  it("refunds nothing the second time — the net of a fee and its refund is zero", async () => {
    await seedLeague({ id: "lg1", entryFeeCents: FEE });
    await seedUser("u1");
    await fund("u1", FEE);
    expect(await paidJoin(db, "lg1", "u1")).toMatchObject({ ok: true });

    const first = await db.transaction((tx) => refundEntryFeeInTx(tx, { leagueId: "lg1", userId: "u1" }, postDeps));
    expect(first).toMatchObject({ refundedCents: FEE });
    const again = await db.transaction((tx) => refundEntryFeeInTx(tx, { leagueId: "lg1", userId: "u1" }, postDeps));
    expect(again).toEqual({ refundedCents: 0, transactionId: null });
  });

  it("throws — and rolls the whole release back — when the refund posting itself refuses", async () => {
    await seedLeague({ id: "lg1", entryFeeCents: FEE });
    await seedUser("u1");
    await fund("u1", FEE);
    expect(await paidJoin(db, "lg1", "u1")).toMatchObject({ ok: true });
    // Sabotage the escrow ROLLUP so the writer's balance floor refuses the refund: the rollup is
    // the lock-target the floor reads, and a book/rollup disagreement is exactly the corrupt
    // state a release must fail loudly on rather than paper over.
    await db.update(moneyAccounts).set({ balanceCents: 0 }).where(eq(moneyAccounts.id, accountIdFor("league_escrow", "lg1")));

    await expect(releaseSeat(db, { leagueId: "lg1", userId: "u1" }, { clock, newId })).rejects.toThrow(/refund posting refused/);
    // The rollback kept the seat: no half-release where the member is gone but the fee stayed.
    expect(await seatCount("lg1", "u1")).toBe(1);
  });
});
