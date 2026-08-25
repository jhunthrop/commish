import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { auditEvents, chatMessages, drafts, leagues, memberNotices, moneyAccounts, moneyEntries, moneyTransactions, reviews, teams, tradeProposals, users } from "@/db/schema";
import { createTestDb, recordStatements, truncateAll, truncateMoneyTables } from "@/db/test-db";
import type { Clock } from "@/domain/timing";
import { getAuditLogger } from "@/integrity-service/audit-logger";
import { raiseFlag, resolveFlag } from "@/integrity-service/flags";
import { joinPublicLeague } from "@/league-service/join";
import { accountIdFor } from "@/money/accounts";
import { MONEY_REFUSALS } from "@/money/config";
import type { PrizeTable } from "@/money/prize-table";
import { MONEY_STATES, type MoneyStatesConfig, type StateCode } from "@/money/states";
import { postMoneyTransaction } from "./post";
import { accountBalance, walletSummary } from "./read";
import { confiscateHold, releaseHold, SETTLEMENT_REFUSALS, settleSeasonPayouts, type SettlementDeps } from "./settlement";
import { snapshotMoneyBook } from "./test-support";

/**
 * Task 10's own suite: settlement — operator-triggered, prize table in, escrow to zero — plus the
 * two hold outcomes (`releaseHold`/`confiscateHold`). Mirrors `dissolution.test.ts`'s fixtures
 * (`seedLeague`, `fund`, `paidJoin`) rather than inventing a second set for the same money book.
 */

const db = createTestDb();
const NOW = "2026-12-30T00:00:00.000Z";
const clock: Clock = { now: () => NOW };
let nextId = 0;
const newId = () => `stl_${(nextId += 1)}`;
const audit = getAuditLogger();

/** TN and NJ both enabled, so a multi-state league can prove per-leg state attribution. */
const enabledStates: MoneyStatesConfig = {
  enabled: [
    { state: "TN", minAge: 18 },
    { state: "NJ", minAge: 18 },
  ],
  neverEligible: MONEY_STATES.neverEligible,
};

const FEE = 20_00;
const RAKE = 1_00;
const OPERATOR = "u_operator";
/** 4 seats x $20 = $80 pot; $4 rake; $76 in prizes. */
const TABLE_4: PrizeTable = [
  { place: 1, amountCents: 44_00 },
  { place: 2, amountCents: 32_00 },
];

const deps: SettlementDeps = { clock, audit, newId };

async function seedUser(id: string): Promise<void> {
  await db
    .insert(users)
    .values({ id, email: `${id}@test.local`, displayName: id, kycStatus: "verified" })
    .onConflictDoNothing();
}

async function seedLeague(input: {
  readonly id: string;
  readonly teamCount?: number;
  readonly entryFeeCents?: number;
  readonly platformFeeCents?: number;
  readonly payoutTable?: PrizeTable | null;
}): Promise<void> {
  const teamCount = input.teamCount ?? 4;
  const entryFeeCents = input.entryFeeCents ?? FEE;
  await db.insert(leagues).values({
    id: input.id,
    name: "Settlement Test League",
    format: "snake",
    teamCount,
    stakeTier: 0,
    experienceTier: "beginner",
    isPublicMatchmade: true,
    commissionerUserId: null,
    houseRung: "open_12",
    entryFeeCents,
    platformFeeCents: input.platformFeeCents ?? (entryFeeCents > 0 ? RAKE : 0),
    payoutTable: input.payoutTable === undefined ? (entryFeeCents > 0 ? TABLE_4 : null) : input.payoutTable,
  });
  await db.insert(drafts).values({
    id: `${input.id}_draft`,
    leagueId: input.id,
    format: "snake",
    status: "scheduled",
    kickoffAt: new Date("2026-09-20T17:00:00.000Z"),
    auctionBudget: null,
    startTrigger: "scheduled",
  });
}

async function fund(userId: string, amountCents: number): Promise<void> {
  await seedUser(userId);
  await db.transaction((tx) =>
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
      { audit, clock, newId },
    ),
  );
}

async function paidJoin(leagueId: string, userId: string, stateOfEntry: StateCode = "TN"): Promise<void> {
  const joined = await joinPublicLeague({ db, newId: () => newId(), clock }, { leagueId, userId, money: { stateOfEntry, states: enabledStates } });
  expect(joined).toMatchObject({ ok: true });
}

/** Season over: the one-way stamp `stampSeasonCompleteInTx` writes, applied directly — the
 *  matchup machinery that leads up to it is another module's business, the stamp is the mark. */
async function completeSeason(leagueId: string): Promise<void> {
  await db.update(drafts).set({ status: "complete" }).where(eq(drafts.leagueId, leagueId));
  await db.update(leagues).set({ seasonCompletedAt: new Date(NOW) }).where(eq(leagues.id, leagueId));
}

/** A full, paid, season-complete 4-seat league: u1/u3 attested TN, u2/u4 attested NJ. */
async function seedSettledStage(leagueId: string): Promise<void> {
  await seedLeague({ id: leagueId });
  for (const [userId, state] of [
    ["u1", "TN"],
    ["u2", "NJ"],
    ["u3", "TN"],
    ["u4", "NJ"],
  ] as const) {
    await fund(userId, 50_00);
    await paidJoin(leagueId, userId, state);
  }
  await completeSeason(leagueId);
}

function settle(leagueId: string, standings: readonly { readonly place: number; readonly userId: string }[], overrides: SettlementDeps = deps) {
  return settleSeasonPayouts(db, { leagueId, operatorUserId: OPERATOR, standings }, overrides);
}

/** Everything a settlement can possibly write — the money book plus audit events and notices —
 *  so "a refusal writes nothing" is proven over the whole surface, `expectNoDissolutionTookPlace`'s
 *  own shape (`dissolution.test.ts`). */
async function snapshotSurface() {
  return {
    money: await snapshotMoneyBook(db),
    auditEvents: await db.select().from(auditEvents).orderBy(asc(auditEvents.chainScope), asc(auditEvents.sequence)),
    memberNotices: await db.select().from(memberNotices).orderBy(asc(memberNotices.id)),
  };
}

/** The record is `money_entries`/`money_transactions` plus the audit and notice tables; a
 *  zero-balance `money_accounts` lock target committed around a refusal is not a posting —
 *  `expectNoPostingTookPlace`'s own tolerance (`./test-support`), restated over this surface. */
async function expectNoSettlementTookPlace(before: Awaited<ReturnType<typeof snapshotSurface>>): Promise<void> {
  const after = await snapshotSurface();
  expect(after.money.transactions).toEqual(before.money.transactions);
  expect(after.money.entries).toEqual(before.money.entries);
  for (const account of after.money.accounts) {
    const prior = before.money.accounts.find((row) => row.id === account.id);
    expect({ id: account.id, balanceCents: account.balanceCents }).toEqual({ id: account.id, balanceCents: prior?.balanceCents ?? 0 });
  }
  expect(after.auditEvents).toEqual(before.auditEvents);
  expect(after.memberNotices).toEqual(before.memberNotices);
}

async function settlementEntries(leagueId: string) {
  return db
    .select({
      kind: moneyTransactions.kind,
      idempotencyKey: moneyTransactions.idempotencyKey,
      accountId: moneyEntries.accountId,
      direction: moneyEntries.direction,
      amountCents: moneyEntries.amountCents,
      stateOfEntry: moneyEntries.stateOfEntry,
    })
    .from(moneyEntries)
    .innerJoin(moneyTransactions, eq(moneyEntries.transactionId, moneyTransactions.id))
    .where(and(eq(moneyTransactions.leagueId, leagueId), eq(moneyTransactions.kind, "settlement")))
    .orderBy(asc(moneyEntries.id));
}

async function eventsOfType(eventType: string) {
  return db.select().from(auditEvents).where(eq(auditEvents.eventType, eventType as never)).orderBy(asc(auditEvents.chainScope), asc(auditEvents.sequence));
}

async function noticesOfType(noticeType: string) {
  return db.select().from(memberNotices).where(eq(memberNotices.noticeType, noticeType as never)).orderBy(asc(memberNotices.id));
}

async function raisePairFlag(a: string, b: string, flagId: string): Promise<void> {
  const [x, y] = [a, b].sort();
  await db.transaction((tx) =>
    raiseFlag(tx, {
      flagType: "multi_account",
      subjectId: `${x}:${y}`,
      leagueId: null,
      evidence: {},
      raisedByUserId: null,
      occurredAt: NOW,
      newId: () => flagId,
      audit,
    }),
  );
}

beforeEach(async () => {
  await truncateAll(db);
  await truncateMoneyTables(db);
  nextId = 0;
});

afterAll(async () => {
  await db.$client.end();
});

describe("settlement is never automatic", () => {
  it("is imported by the two admin doors and nothing else in production source", () => {
    const importers: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) continue;
        const source = readFileSync(path, "utf8");
        // IMPORT statements only — docblocks may NAME this module (`@/domain/audit` reserves the
        // event types for it), and a mention is not a caller.
        if (source.includes('from "@/money-service/settlement"') || source.includes('from "./settlement"')) importers.push(path);
      }
    };
    walk("src");
    expect(importers.sort()).toEqual([
      "src/app/api/admin/holds/[userId]/route.ts",
      "src/app/api/admin/leagues/[leagueId]/settle/route.ts",
    ]);
  });
});

describe("settleSeasonPayouts refusals", () => {
  it("refuses a league that does not exist, writing nothing", async () => {
    const before = await snapshotSurface();
    const result = await settle("lg_ghost", [{ place: 1, userId: "u1" }], {});
    expect(result).toEqual({ ok: false, status: 404, reason: SETTLEMENT_REFUSALS.leagueMissing });
    await expectNoSettlementTookPlace(before);
  });

  it("refuses before the season is complete — the mark is the season-completed stamp, and a finished draft alone is not it", async () => {
    await seedLeague({ id: "lg_unfinished" });
    for (const u of ["ua", "ub", "uc", "ud"]) {
      await fund(u, 50_00);
      await paidJoin("lg_unfinished", u);
    }
    // The draft completed, the season played on, but the final week was never stamped final.
    await db.update(drafts).set({ status: "complete" }).where(eq(drafts.leagueId, "lg_unfinished"));
    const before = await snapshotSurface();
    const result = await settle("lg_unfinished", [
      { place: 1, userId: "ua" },
      { place: 2, userId: "ub" },
    ]);
    expect(result).toEqual({ ok: false, status: 409, reason: SETTLEMENT_REFUSALS.seasonNotComplete });
    await expectNoSettlementTookPlace(before);
  });

  it("refuses standings that skip a paid place", async () => {
    await seedSettledStage("lg_skip");
    const before = await snapshotSurface();
    const result = await settle("lg_skip", [{ place: 1, userId: "u1" }]);
    expect(result).toEqual({ ok: false, status: 400, reason: SETTLEMENT_REFUSALS.standingsIncomplete });
    await expectNoSettlementTookPlace(before);
  });

  it("refuses standings naming someone who never sat in this league", async () => {
    await seedSettledStage("lg_stranger");
    await seedUser("u_stranger");
    const before = await snapshotSurface();
    const result = await settle("lg_stranger", [
      { place: 1, userId: "u_stranger" },
      { place: 2, userId: "u2" },
    ]);
    expect(result).toEqual({ ok: false, status: 400, reason: SETTLEMENT_REFUSALS.standingsIncomplete });
    await expectNoSettlementTookPlace(before);
  });

  it("refuses standings paying the same member two places", async () => {
    await seedSettledStage("lg_double");
    const before = await snapshotSurface();
    const result = await settle("lg_double", [
      { place: 1, userId: "u1" },
      { place: 2, userId: "u1" },
    ]);
    expect(result).toEqual({ ok: false, status: 400, reason: SETTLEMENT_REFUSALS.standingsIncomplete });
    await expectNoSettlementTookPlace(before);
  });

  it("re-checks the stored prize table against the pot and refuses a table that no longer balances", async () => {
    // Seeded directly past the creation gate: prizes exceed the pot minus rake.
    await seedLeague({ id: "lg_badtable", payoutTable: [{ place: 1, amountCents: 99_00 }] });
    for (const u of ["ua", "ub", "uc", "ud"]) {
      await fund(u, 50_00);
      await paidJoin("lg_badtable", u);
    }
    await completeSeason("lg_badtable");
    const before = await snapshotSurface();
    const result = await settle("lg_badtable", [{ place: 1, userId: "ua" }]);
    expect(result).toEqual({ ok: false, status: 409, reason: MONEY_REFUSALS.prizeTableMismatch });
    await expectNoSettlementTookPlace(before);
  });

  it("refuses a paid league whose stored table is missing entirely — a state creation cannot produce, refused rather than trusted", async () => {
    await seedLeague({ id: "lg_notable", payoutTable: null });
    for (const u of ["ua", "ub", "uc", "ud"]) {
      await fund(u, 50_00);
      await paidJoin("lg_notable", u);
    }
    await completeSeason("lg_notable");
    const before = await snapshotSurface();
    const result = await settle("lg_notable", []);
    expect(result).toEqual({ ok: false, status: 409, reason: MONEY_REFUSALS.prizeTableMismatch });
    await expectNoSettlementTookPlace(before);
  });

  it("rolls the WHOLE settlement back when a PRIZE posting refuses mid-flight", async () => {
    await seedSettledStage("lg_prize_refused");
    const before = await snapshotSurface();
    const refuseSecondPrize: NonNullable<SettlementDeps["postTransaction"]> = async (tx, input, postDeps) => {
      if (input.idempotencyKey?.endsWith(":place:2")) return { ok: false, reason: MONEY_REFUSALS.insufficientBalance };
      return postMoneyTransaction(tx, input, postDeps);
    };
    const result = await settle("lg_prize_refused", [
      { place: 1, userId: "u1" },
      { place: 2, userId: "u2" },
    ], { ...deps, postTransaction: refuseSecondPrize });
    expect(result).toEqual({ ok: false, status: 409, reason: SETTLEMENT_REFUSALS.escrowMismatch });
    await expectNoSettlementTookPlace(before);
  });

  it("refuses when a seat's escrow contribution is short — the pot the table was published against is not there", async () => {
    await seedSettledStage("lg_short");
    // A 5_00 slice of u1's fee left the escrow outside any door settlement knows about.
    await db.transaction((tx) =>
      postMoneyTransaction(
        tx,
        {
          kind: "entry_fee_refund",
          leagueId: "lg_short",
          stateOfEntry: "TN",
          entries: [
            { accountId: accountIdFor("league_escrow", "lg_short"), direction: "debit", amountCents: 5_00 },
            { accountId: accountIdFor("user_available", "u1"), direction: "credit", amountCents: 5_00 },
          ],
          auditEvent: { eventType: "entry_fee_refunded", actorId: "u1", actorType: "user", leagueId: "lg_short", payload: { amountCents: 5_00 } },
        },
        { audit, clock, newId },
      ),
    );
    const before = await snapshotSurface();
    const result = await settle("lg_short", [
      { place: 1, userId: "u1" },
      { place: 2, userId: "u2" },
    ]);
    expect(result).toEqual({ ok: false, status: 409, reason: SETTLEMENT_REFUSALS.escrowMismatch });
    await expectNoSettlementTookPlace(before);
  });

  it("refuses when the escrow rollup holds money the seats' fees do not account for", async () => {
    await seedSettledStage("lg_over");
    // A stray credit into the escrow that is neither a fee nor a refund: per-seat nets look
    // right, but the locked rollup does not equal the pot.
    await db.transaction((tx) =>
      postMoneyTransaction(
        tx,
        {
          kind: "deposit",
          stateOfEntry: "TN",
          entries: [
            { accountId: accountIdFor("fbo_pool"), direction: "debit", amountCents: 3_00 },
            { accountId: accountIdFor("league_escrow", "lg_over"), direction: "credit", amountCents: 3_00 },
          ],
          auditEvent: { eventType: "deposit_completed", actorId: null, actorType: "system", leagueId: null, payload: { amountCents: 3_00 } },
        },
        { audit, clock, newId },
      ),
    );
    const before = await snapshotSurface();
    const result = await settle("lg_over", [
      { place: 1, userId: "u1" },
      { place: 2, userId: "u2" },
    ]);
    expect(result).toEqual({ ok: false, status: 409, reason: SETTLEMENT_REFUSALS.escrowMismatch });
    await expectNoSettlementTookPlace(before);
  });

  it("rolls the WHOLE settlement back when the in-transaction invariant finds escrow above zero after posting", async () => {
    await seedSettledStage("lg_sabotage");
    const before = await snapshotSurface();
    // The sabotage idiom: skip the rake sweep, so the prize postings land and the escrow is left
    // holding exactly the rake. The invariant must refuse and undo the postings that DID land.
    const skipRake: NonNullable<SettlementDeps["postTransaction"]> = async (tx, input, postDeps) => {
      if (input.idempotencyKey?.endsWith(":rake")) return { ok: true, transactionId: "skipped", replayed: false };
      return postMoneyTransaction(tx, input, postDeps);
    };
    const result = await settle("lg_sabotage", [
      { place: 1, userId: "u1" },
      { place: 2, userId: "u2" },
    ], { ...deps, postTransaction: skipRake });
    expect(result).toEqual({ ok: false, status: 409, reason: SETTLEMENT_REFUSALS.escrowMismatch });
    await expectNoSettlementTookPlace(before);
  });

  it("rolls the WHOLE settlement back when any posting inside it refuses", async () => {
    await seedSettledStage("lg_refused");
    const before = await snapshotSurface();
    const refuseRake: NonNullable<SettlementDeps["postTransaction"]> = async (tx, input, postDeps) => {
      if (input.idempotencyKey?.endsWith(":rake")) return { ok: false, reason: MONEY_REFUSALS.insufficientBalance };
      return postMoneyTransaction(tx, input, postDeps);
    };
    const result = await settle("lg_refused", [
      { place: 1, userId: "u1" },
      { place: 2, userId: "u2" },
    ], { ...deps, postTransaction: refuseRake });
    expect(result).toEqual({ ok: false, status: 409, reason: SETTLEMENT_REFUSALS.escrowMismatch });
    await expectNoSettlementTookPlace(before);
  });

  it("lets an unexpected failure surface as a rejection, with nothing committed", async () => {
    await seedSettledStage("lg_crash");
    const before = await snapshotSurface();
    const crash: NonNullable<SettlementDeps["postTransaction"]> = async () => {
      throw new Error("the database fell over");
    };
    await expect(
      settle("lg_crash", [
        { place: 1, userId: "u1" },
        { place: 2, userId: "u2" },
      ], { ...deps, postTransaction: crash }),
    ).rejects.toThrow("the database fell over");
    await expectNoSettlementTookPlace(before);
  });
});

describe("settleSeasonPayouts", () => {
  it("pays the STORED table to the named winners with each winner's own attested state, sweeps the rake per seat, and drains the escrow to exactly zero", async () => {
    await seedSettledStage("lg_pay");
    await seedUser(OPERATOR);
    // A RESOLVED flag involving u2 must not hold anything — only OPEN flags do.
    await raisePairFlag("u2", "u4", "flag_resolved_pair");
    const resolved = await resolveFlag(db, { flagId: "flag_resolved_pair", decision: "no_action", note: "clean", operatorUserId: OPERATOR });
    expect(resolved).toMatchObject({ ok: true });

    // The member figure settlement must erase: u3's wallet shows $20.00 sitting in escrow.
    expect((await walletSummary(db, "u3")).escrowCents).toBe(FEE);

    const result = await settle("lg_pay", [
      { place: 1, userId: "u2" },
      { place: 2, userId: "u1" },
      { place: 3, userId: "u3" },
      { place: 4, userId: "u4" },
    ]);
    expect(result).toEqual({ ok: true, alreadySettled: false, prizesPaidCents: 76_00, heldCents: 0, rakeCents: 4_00 });

    // Escrow to zero — by entry sum, not just the rollup.
    expect(await accountBalance(db, accountIdFor("league_escrow", "lg_pay"))).toBe(0);
    expect(await accountBalance(db, accountIdFor("platform_rake"))).toBe(4_00);
    expect(await accountBalance(db, accountIdFor("user_available", "u2"))).toBe(50_00 - FEE + 44_00);
    expect(await accountBalance(db, accountIdFor("user_available", "u1"))).toBe(50_00 - FEE + 32_00);
    expect(await accountBalance(db, accountIdFor("user_available", "u3"))).toBe(50_00 - FEE);

    // T3's carry: settlement is what removes the league from members' escrow figures.
    expect((await walletSummary(db, "u3")).escrowCents).toBe(0);
    expect((await walletSummary(db, "u2")).escrowCents).toBe(0);

    // Per-leg state attribution: u2's prize legs carry NJ, u1's carry TN, and the rake carries
    // one debit/credit pair per seat, each in that seat's own state.
    const entries = await settlementEntries("lg_pay");
    const prize1 = entries.filter((row) => row.idempotencyKey === "settlement:lg_pay:place:1");
    expect(prize1).toHaveLength(2);
    for (const leg of prize1) expect(leg.stateOfEntry).toBe("NJ");
    const prize2 = entries.filter((row) => row.idempotencyKey === "settlement:lg_pay:place:2");
    for (const leg of prize2) expect(leg.stateOfEntry).toBe("TN");
    const rakeLegs = entries.filter((row) => row.idempotencyKey === "settlement:lg_pay:rake");
    expect(rakeLegs).toHaveLength(8);
    const rakeCredits = rakeLegs.filter((row) => row.accountId === accountIdFor("platform_rake"));
    expect(rakeCredits.map((row) => row.stateOfEntry).sort()).toEqual(["NJ", "NJ", "TN", "TN"]);
    for (const leg of rakeLegs) expect(leg.amountCents).toBe(RAKE);

    // One prize_paid per paid place, on the league's own record.
    const prizeEvents = await eventsOfType("prize_paid");
    expect(prizeEvents).toHaveLength(2);
    expect(prizeEvents.map((event) => event.payload)).toEqual([
      { winnerUserId: "u2", place: 1, amountCents: 44_00, operatorUserId: OPERATOR },
      { winnerUserId: "u1", place: 2, amountCents: 32_00, operatorUserId: OPERATOR },
    ]);
    for (const event of prizeEvents) {
      expect(event.leagueId).toBe("lg_pay");
      expect(event.actorType).toBe("system");
      expect(event.actorId).toBeNull();
    }
    expect(await eventsOfType("payout_held")).toHaveLength(0);

    // The rake sweep's own record: an admin_action on the league record, operator named.
    const rakeEvents = (await eventsOfType("admin_action")).filter((event) => (event.payload as { action?: string }).action === "rake_swept");
    expect(rakeEvents).toHaveLength(1);
    expect(rakeEvents[0]!.payload).toEqual({ action: "rake_swept", amountCents: 4_00, perSeatCents: RAKE, seats: 4, operatorUserId: OPERATOR });
    expect(rakeEvents[0]!.leagueId).toBe("lg_pay");

    // Winners are told, money first; nobody else is.
    const notices = await noticesOfType("prize_paid");
    expect(notices.map((notice) => notice.userId).sort()).toEqual(["u1", "u2"]);
  });

  it("settles a rake-only table (no paid places) as a pure sweep", async () => {
    await seedLeague({ id: "lg_rakeonly", teamCount: 2, entryFeeCents: 20_00, platformFeeCents: 20_00, payoutTable: [] });
    for (const [u, s] of [
      ["ur1", "TN"],
      ["ur2", "NJ"],
    ] as const) {
      await fund(u, 50_00);
      await paidJoin("lg_rakeonly", u, s);
    }
    await completeSeason("lg_rakeonly");
    // `{}` deps on a run that actually posts: the default clock/audit/newId are exercised end to
    // end, so a caller injecting nothing gets the same working writer the tests drive.
    const result = await settle("lg_rakeonly", [], {});
    expect(result).toEqual({ ok: true, alreadySettled: false, prizesPaidCents: 0, heldCents: 0, rakeCents: 40_00 });
    expect(await accountBalance(db, accountIdFor("league_escrow", "lg_rakeonly"))).toBe(0);
    expect(await accountBalance(db, accountIdFor("platform_rake"))).toBe(40_00);
    expect(await eventsOfType("prize_paid")).toHaveLength(0);
  });

  it("settling twice is a clean idempotent no-op — the book, events and notices are byte-identical after the second call", async () => {
    await seedSettledStage("lg_twice");
    const standings = [
      { place: 1, userId: "u1" },
      { place: 2, userId: "u2" },
    ];
    const first = await settle("lg_twice", standings);
    expect(first).toMatchObject({ ok: true, alreadySettled: false });
    const after = await snapshotSurface();

    const second = await settle("lg_twice", standings);
    expect(second).toEqual({ ok: true, alreadySettled: true, prizesPaidCents: 0, heldCents: 0, rakeCents: 0 });
    expect(await snapshotSurface()).toEqual(after);
  });

  it("settles a FREE league with zero money statements", async () => {
    await seedLeague({ id: "lg_free", entryFeeCents: 0 });
    for (const u of ["uf1", "uf2"]) {
      await seedUser(u);
      await db.insert(teams).values({ id: `team_${u}`, leagueId: "lg_free", userId: u, name: u });
    }
    await completeSeason("lg_free");
    const statements = await recordStatements(db, async (logged) => {
      const result = await settleSeasonPayouts(logged, { leagueId: "lg_free", operatorUserId: OPERATOR, standings: [] }, deps);
      expect(result).toEqual({ ok: true, alreadySettled: false, prizesPaidCents: 0, heldCents: 0, rakeCents: 0 });
    });
    expect(statements.filter((statement) => statement.includes("money_"))).toEqual([]);
  });

  it("touches the money book for a PAID league — the other half of the free-season spy", async () => {
    await seedSettledStage("lg_spy");
    const statements = await recordStatements(db, async (logged) => {
      const result = await settleSeasonPayouts(
        logged,
        {
          leagueId: "lg_spy",
          operatorUserId: OPERATOR,
          standings: [
            { place: 1, userId: "u1" },
            { place: 2, userId: "u2" },
          ],
        },
        deps,
      );
      expect(result).toMatchObject({ ok: true });
    });
    expect(statements.some((statement) => statement.includes("money_transactions"))).toBe(true);
  });
});

describe("collusion holds", () => {
  it("credits a winner with an OPEN flag to held_for_review instead — whatever subject shape the flag names — and leaves the other winners untouched", async () => {
    await seedLeague({
      id: "lg_hold",
      payoutTable: [
        { place: 1, amountCents: 40_00 },
        { place: 2, amountCents: 20_00 },
        { place: 3, amountCents: 10_00 },
        { place: 4, amountCents: 6_00 },
      ],
    });
    for (const [userId, state] of [
      ["u1", "TN"],
      ["u2", "NJ"],
      ["u3", "TN"],
      ["u4", "NJ"],
    ] as const) {
      await fund(userId, 50_00);
      await paidJoin("lg_hold", userId, state);
    }
    await completeSeason("lg_hold");

    // Four open flags, one per subject shape, involving u1 (pair), u2 (review author),
    // u3 (chat author) and u4 (a trade between u4's and u1's teams — u1 already held).
    await raisePairFlag("u1", "u_outsider", "flag_pair");
    await db.insert(reviews).values({ id: "rev_hold", userId: "u2", rating: 1, body: "sus", createdAt: new Date(NOW), updatedAt: new Date(NOW) });
    await db.transaction((tx) =>
      raiseFlag(tx, { flagType: "review_report", subjectId: "rev_hold", leagueId: null, evidence: {}, raisedByUserId: null, occurredAt: NOW, newId: () => "flag_review", audit }),
    );
    const [message] = await db.insert(chatMessages).values({ leagueId: "lg_hold", authorUserId: "u3", body: "hello" }).returning({ id: chatMessages.id });
    await db.transaction((tx) =>
      raiseFlag(tx, { flagType: "chat_report", subjectId: String(message!.id), leagueId: "lg_hold", evidence: {}, raisedByUserId: null, occurredAt: NOW, newId: () => "flag_chat", audit }),
    );
    const [teamRows, u4Team] = await Promise.all([
      db.select({ id: teams.id }).from(teams).where(and(eq(teams.leagueId, "lg_hold"), eq(teams.userId, "u1"))),
      db.select({ id: teams.id }).from(teams).where(and(eq(teams.leagueId, "lg_hold"), eq(teams.userId, "u4"))),
    ]);
    await db.insert(tradeProposals).values({
      id: "trade_hold",
      leagueId: "lg_hold",
      proposerTeamId: u4Team[0]!.id,
      counterpartyTeamId: teamRows[0]!.id,
      weekNumber: 4,
      proposerAssets: [{ kind: "player", playerId: "p_a" }],
      counterpartyAssets: [{ kind: "player", playerId: "p_b" }],
      fingerprint: "fp_trade_hold",
      note: null,
      status: "accepted",
      proposedAt: new Date(NOW),
      expiresAt: new Date(NOW),
    });
    await db.transaction((tx) =>
      raiseFlag(tx, { flagType: "trade_fairness", subjectId: "trade_hold", leagueId: "lg_hold", evidence: {}, raisedByUserId: null, occurredAt: NOW, newId: () => "flag_trade", audit }),
    );

    const result = await settle("lg_hold", [
      { place: 1, userId: "u1" },
      { place: 2, userId: "u2" },
      { place: 3, userId: "u3" },
      { place: 4, userId: "u4" },
    ]);
    expect(result).toEqual({ ok: true, alreadySettled: false, prizesPaidCents: 0, heldCents: 76_00, rakeCents: 4_00 });

    expect(await accountBalance(db, accountIdFor("league_escrow", "lg_hold"))).toBe(0);
    expect(await accountBalance(db, accountIdFor("held_for_review", "u1"))).toBe(40_00);
    expect(await accountBalance(db, accountIdFor("held_for_review", "u2"))).toBe(20_00);
    expect(await accountBalance(db, accountIdFor("held_for_review", "u3"))).toBe(10_00);
    expect(await accountBalance(db, accountIdFor("held_for_review", "u4"))).toBe(6_00);
    // Nothing landed in anyone's spendable balance.
    for (const u of ["u1", "u2", "u3", "u4"]) {
      expect(await accountBalance(db, accountIdFor("user_available", u))).toBe(50_00 - FEE);
    }

    expect(await eventsOfType("prize_paid")).toHaveLength(0);
    const heldEvents = await eventsOfType("payout_held");
    expect(heldEvents).toHaveLength(4);
    expect(heldEvents.map((event) => (event.payload as { winnerUserId: string }).winnerUserId).sort()).toEqual(["u1", "u2", "u3", "u4"]);

    // A hold names a suspicion: no notice is sent for a held payout.
    expect(await noticesOfType("prize_paid")).toHaveLength(0);
  });

  it("holds ONLY the flagged winner: the clean winners are paid and told in the same settlement", async () => {
    await seedSettledStage("lg_mixed");
    await raisePairFlag("u2", "u_outsider", "flag_mixed");
    // An open trade flag between two NON-winners must hold nobody on the podium.
    const [u3Team] = await db.select({ id: teams.id }).from(teams).where(and(eq(teams.leagueId, "lg_mixed"), eq(teams.userId, "u3")));
    const [u4Team] = await db.select({ id: teams.id }).from(teams).where(and(eq(teams.leagueId, "lg_mixed"), eq(teams.userId, "u4")));
    await db.insert(tradeProposals).values({
      id: "trade_mixed",
      leagueId: "lg_mixed",
      proposerTeamId: u3Team!.id,
      counterpartyTeamId: u4Team!.id,
      weekNumber: 4,
      proposerAssets: [{ kind: "player", playerId: "p_a" }],
      counterpartyAssets: [{ kind: "player", playerId: "p_b" }],
      fingerprint: "fp_trade_mixed",
      note: null,
      status: "accepted",
      proposedAt: new Date(NOW),
      expiresAt: new Date(NOW),
    });
    await db.transaction((tx) =>
      raiseFlag(tx, { flagType: "trade_fairness", subjectId: "trade_mixed", leagueId: "lg_mixed", evidence: {}, raisedByUserId: null, occurredAt: NOW, newId: () => "flag_trade_mixed", audit }),
    );
    const result = await settle("lg_mixed", [
      { place: 1, userId: "u2" },
      { place: 2, userId: "u1" },
    ]);
    expect(result).toEqual({ ok: true, alreadySettled: false, prizesPaidCents: 32_00, heldCents: 44_00, rakeCents: 4_00 });
    expect(await accountBalance(db, accountIdFor("held_for_review", "u2"))).toBe(44_00);
    expect(await accountBalance(db, accountIdFor("user_available", "u1"))).toBe(50_00 - FEE + 32_00);
    expect(await accountBalance(db, accountIdFor("league_escrow", "lg_mixed"))).toBe(0);
    expect((await noticesOfType("prize_paid")).map((notice) => notice.userId)).toEqual(["u1"]);
  });
});

describe("releaseHold and confiscateHold", () => {
  /** Two 2-seat leagues, both won by a flagged u_flag who attested TN in one and NJ in the
   *  other — so the held account carries two states and the outcome posting must honor both. */
  async function seedHeldWinner(): Promise<void> {
    for (const [leagueId, state] of [
      ["lg_ha", "TN"],
      ["lg_hb", "NJ"],
    ] as const) {
      await seedLeague({ id: leagueId, teamCount: 2, entryFeeCents: 20_00, platformFeeCents: 0, payoutTable: [{ place: 1, amountCents: 40_00 }] });
      await fund("u_flag", 50_00);
      await fund("u_other", 50_00);
      await paidJoin(leagueId, "u_flag", state);
      await paidJoin(leagueId, "u_other", state);
      await completeSeason(leagueId);
    }
    await raisePairFlag("u_flag", "u_other", "flag_held");
    for (const leagueId of ["lg_ha", "lg_hb"]) {
      const settled = await settle(leagueId, [{ place: 1, userId: "u_flag" }]);
      expect(settled).toMatchObject({ ok: true, heldCents: 40_00 });
    }
    expect(await accountBalance(db, accountIdFor("held_for_review", "u_flag"))).toBe(80_00);
  }

  it("releaseHold moves the whole held balance back to the member, state by state, audits payout_released, and tells the member money-first", async () => {
    await seedHeldWinner();
    const result = await releaseHold(db, { userId: "u_flag", operatorUserId: OPERATOR }, deps);
    expect(result).toEqual({ ok: true, amountCents: 80_00 });

    expect(await accountBalance(db, accountIdFor("held_for_review", "u_flag"))).toBe(0);
    expect(await accountBalance(db, accountIdFor("user_available", "u_flag"))).toBe(50_00 + 50_00 - 20_00 - 20_00 + 80_00);

    // Per-state legs: the TN prize comes back as TN, the NJ prize as NJ.
    const rows = await db
      .select({ kind: moneyTransactions.kind, accountId: moneyEntries.accountId, direction: moneyEntries.direction, amountCents: moneyEntries.amountCents, stateOfEntry: moneyEntries.stateOfEntry })
      .from(moneyEntries)
      .innerJoin(moneyTransactions, eq(moneyEntries.transactionId, moneyTransactions.id))
      .where(eq(moneyTransactions.kind, "hold_release"));
    expect(rows).toHaveLength(4);
    expect(rows.filter((row) => row.stateOfEntry === "TN")).toHaveLength(2);
    expect(rows.filter((row) => row.stateOfEntry === "NJ")).toHaveLength(2);

    const released = await eventsOfType("payout_released");
    expect(released).toHaveLength(1);
    expect(released[0]!.payload).toEqual({ subjectUserId: "u_flag", amountCents: 80_00 });
    expect(released[0]!.actorId).toBe(OPERATOR);
    expect(released[0]!.leagueId).toBeNull();

    const notices = await noticesOfType("payout_released");
    expect(notices.map((notice) => notice.userId)).toEqual(["u_flag"]);
  });

  it("confiscateHold forfeits the whole held balance to the platform, audits admin_action, and sends NO notice", async () => {
    await seedHeldWinner();
    const result = await confiscateHold(db, { userId: "u_flag", operatorUserId: OPERATOR }, deps);
    expect(result).toEqual({ ok: true, amountCents: 80_00 });

    expect(await accountBalance(db, accountIdFor("held_for_review", "u_flag"))).toBe(0);
    expect(await accountBalance(db, accountIdFor("platform_forfeiture"))).toBe(80_00);
    expect(await accountBalance(db, accountIdFor("user_available", "u_flag"))).toBe(50_00 + 50_00 - 20_00 - 20_00);

    const confiscations = (await eventsOfType("admin_action")).filter((event) => (event.payload as { action?: string }).action === "payout_confiscated");
    expect(confiscations).toHaveLength(1);
    expect(confiscations[0]!.payload).toEqual({ action: "payout_confiscated", subjectUserId: "u_flag", amountCents: 80_00 });
    expect(confiscations[0]!.actorId).toBe(OPERATOR);
    expect(confiscations[0]!.leagueId).toBeNull();

    const [txn] = await db.select().from(moneyTransactions).where(eq(moneyTransactions.kind, "hold_confiscation"));
    expect(txn).toBeDefined();
    expect(await noticesOfType("payout_released")).toHaveLength(0);
  });

  it("both are one-way: a second call finds nothing held and writes nothing", async () => {
    await seedHeldWinner();
    await releaseHold(db, { userId: "u_flag", operatorUserId: OPERATOR }, deps);
    const before = await snapshotSurface();

    const releasedAgain = await releaseHold(db, { userId: "u_flag", operatorUserId: OPERATOR }, deps);
    expect(releasedAgain).toEqual({ ok: false, status: 409, reason: SETTLEMENT_REFUSALS.nothingHeld });
    const confiscated = await confiscateHold(db, { userId: "u_flag", operatorUserId: OPERATOR }, deps);
    expect(confiscated).toEqual({ ok: false, status: 409, reason: SETTLEMENT_REFUSALS.nothingHeld });
    await expectNoSettlementTookPlace(before);
  });

  it("refuses an account that never had a hold, with defaults for every dep", async () => {
    const before = await snapshotSurface();
    const result = await releaseHold(db, { userId: "u_never", operatorUserId: OPERATOR });
    expect(result).toEqual({ ok: false, status: 409, reason: SETTLEMENT_REFUSALS.nothingHeld });
    await expectNoSettlementTookPlace(before);
  });

  it("releases with defaults for every dep — a caller injecting nothing gets the same working writer", async () => {
    await seedHeldWinner();
    const result = await releaseHold(db, { userId: "u_flag", operatorUserId: OPERATOR });
    expect(result).toEqual({ ok: true, amountCents: 80_00 });
    expect(await accountBalance(db, accountIdFor("held_for_review", "u_flag"))).toBe(0);
  });

  it("a hold can form AGAIN after an earlier release, and the next outcome reads only the live balance", async () => {
    await seedHeldWinner();
    await releaseHold(db, { userId: "u_flag", operatorUserId: OPERATOR }, deps);
    // The flag is still open, and u_flag wins a third league: a fresh hold on an account whose
    // book already carries the released (debited) history.
    await seedLeague({ id: "lg_hc", teamCount: 2, entryFeeCents: 20_00, platformFeeCents: 0, payoutTable: [{ place: 1, amountCents: 40_00 }] });
    await paidJoin("lg_hc", "u_flag", "TN");
    await paidJoin("lg_hc", "u_other", "TN");
    await completeSeason("lg_hc");
    const settled = await settle("lg_hc", [{ place: 1, userId: "u_flag" }]);
    expect(settled).toMatchObject({ ok: true, heldCents: 40_00 });
    expect(await accountBalance(db, accountIdFor("held_for_review", "u_flag"))).toBe(40_00);

    const confiscated = await confiscateHold(db, { userId: "u_flag", operatorUserId: OPERATOR }, deps);
    expect(confiscated).toEqual({ ok: true, amountCents: 40_00 });
    expect(await accountBalance(db, accountIdFor("held_for_review", "u_flag"))).toBe(0);
    expect(await accountBalance(db, accountIdFor("platform_forfeiture"))).toBe(40_00);
  });

  it("rolls back and surfaces an unexpected posting failure", async () => {
    await seedHeldWinner();
    const before = await snapshotSurface();
    const refuse: NonNullable<SettlementDeps["postTransaction"]> = async () => ({ ok: false, reason: MONEY_REFUSALS.insufficientBalance });
    await expect(releaseHold(db, { userId: "u_flag", operatorUserId: OPERATOR }, { ...deps, postTransaction: refuse })).rejects.toThrow();
    await expectNoSettlementTookPlace(before);
  });
});

describe("the money accounts stay whole", () => {
  it("after a full settle-and-release arc, every rollup still equals its entry sum", async () => {
    await seedSettledStage("lg_whole");
    await raisePairFlag("u2", "u_outsider", "flag_whole");
    await settle("lg_whole", [
      { place: 1, userId: "u2" },
      { place: 2, userId: "u1" },
    ]);
    await releaseHold(db, { userId: "u2", operatorUserId: OPERATOR }, deps);

    const accounts = await db.select().from(moneyAccounts);
    for (const account of accounts) {
      expect(account.balanceCents).toBe(await accountBalance(db, account.id));
    }
  });
});
