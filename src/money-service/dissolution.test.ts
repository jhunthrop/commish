import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { auditEvents, drafts, leagueInvites, leagues, memberNotices, moneyAccounts, moneyTransactions, teams, users } from "@/db/schema";
import { createTestDb, recordStatements } from "@research/db/test-db";
import { truncateAll, truncateMoneyTables } from "@/db/test-db";
import type { Clock } from "@research/domain/timing";
import { getAuditLogger } from "@/integrity-service/audit-logger";
import { EMPTY_BROWSE_FILTER } from "@/matchmaking/filter";
import { browseQuery } from "@/league-service/browse";
import { acceptInvite, createInvite } from "@/league-service/invites";
import { DRAFT_ALREADY_STARTED, joinPublicLeague } from "@/league-service/join";
import { accountIdFor } from "@/money/accounts";
import { MONEY_STATES, type MoneyStatesConfig, type StateCode } from "@/money/states";
import { DISSOLUTION_REFUSALS, dissolutionPreview, dissolveLeague, LEAGUE_DISSOLVED_SUMMARY } from "./dissolution";
import { postMoneyTransaction } from "./post";
import { walletSummary } from "./read";
import { expectNoPostingTookPlace, snapshotMoneyBook } from "./test-support";

/**
 * Task 9's own suite: the operator-triggered dissolution door. Mirrors `entry-fee.test.ts`'s own
 * shape (`seedLeague`, `fund`, `paidJoin`) rather than inventing a second set of fixtures for the
 * same money book — the free-season proof (`recordStatements`) is the same spy assertion Task 8
 * proves join and release with, applied here to a third door.
 */

const db = createTestDb();
const NOW = "2026-09-15T00:00:00.000Z";
const clock: Clock = { now: () => NOW };
let nextId = 0;
const newId = () => `dsl_${(nextId += 1)}`;
const audit = getAuditLogger();

const enabledTN: MoneyStatesConfig = { enabled: [{ state: "TN", minAge: 18 }], neverEligible: MONEY_STATES.neverEligible };
const FEE = 20_00;
const OPERATOR = "u_operator";

async function seedUser(id: string, overrides: Partial<typeof users.$inferInsert> = {}): Promise<void> {
  await db
    .insert(users)
    .values({ id, email: `${id}@test.local`, displayName: id, kycStatus: "verified", ...overrides })
    .onConflictDoNothing();
}

/** A public, pre-draft league seeded directly, its draft's status the caller's own to set —
 *  `entry-fee.test.ts`'s own `seedLeague`, extended with the one field this suite needs to
 *  drive the "already started" refusal and the browse-shelf proof. */
async function seedLeague(input: {
  readonly id: string;
  readonly teamCount?: number;
  readonly entryFeeCents?: number;
  readonly filled?: number;
  readonly draftStatus?: "scheduled" | "in_progress" | "complete";
  readonly commissionerUserId?: string;
}): Promise<void> {
  const teamCount = input.teamCount ?? 4;
  const entryFeeCents = input.entryFeeCents ?? 0;
  const commissionerUserId = input.commissionerUserId ?? null;
  if (commissionerUserId !== null) await seedUser(commissionerUserId);
  await db.insert(leagues).values({
    id: input.id,
    name: "Dissolution Test League",
    format: "snake",
    teamCount,
    stakeTier: 0,
    experienceTier: "beginner",
    isPublicMatchmade: true,
    commissionerUserId,
    houseRung: commissionerUserId === null ? "open_12" : null,
    entryFeeCents,
    platformFeeCents: 0,
    payoutTable: entryFeeCents > 0 ? [{ place: 1, amountCents: entryFeeCents * teamCount }] : null,
  });
  await db.insert(drafts).values({
    id: `${input.id}_draft`,
    leagueId: input.id,
    format: "snake",
    status: input.draftStatus ?? "scheduled",
    kickoffAt: new Date("2026-09-20T17:00:00.000Z"),
    auctionBudget: null,
    startTrigger: "scheduled",
  });
  for (let i = 0; i < (input.filled ?? 0); i++) {
    const userId = `${input.id}_seat_${i}`;
    await seedUser(userId);
    await db.insert(teams).values({ id: `${input.id}_t${i}`, leagueId: input.id, userId, name: `Seat ${i}` });
  }
}

async function fund(userId: string, amountCents: number): Promise<void> {
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

function paidJoin(leagueId: string, userId: string, stateOfEntry: StateCode = "TN") {
  return joinPublicLeague({ db, newId: () => newId(), clock }, { leagueId, userId, money: { stateOfEntry, states: enabledTN } });
}

async function seatedUsersOf(leagueId: string): Promise<readonly string[]> {
  return (await db.select({ userId: teams.userId }).from(teams).where(eq(teams.leagueId, leagueId))).map((row) => row.userId);
}

async function draftStatusOf(leagueId: string): Promise<string | undefined> {
  const [row] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.leagueId, leagueId));
  return row?.status;
}

/** Everything a dissolution can possibly write — the money book plus the league surface — so
 *  "writes nothing on a refusal" is proven over the whole database, `release.test.ts`'s own
 *  `expectNoSeatReleaseTookPlace` shape composed with `snapshotMoneyBook` for the money half. */
async function snapshotSurface() {
  return {
    money: await snapshotMoneyBook(db),
    drafts: await db.select().from(drafts),
    teams: await db.select().from(teams),
    auditEvents: await db.select().from(auditEvents),
    memberNotices: await db.select().from(memberNotices),
  };
}

async function expectNoDissolutionTookPlace(before: Awaited<ReturnType<typeof snapshotSurface>>): Promise<void> {
  expect(await snapshotSurface()).toEqual(before);
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

describe("dissolutionPreview", () => {
  it("answers the league-missing refusal for an id that does not exist", async () => {
    expect(await dissolutionPreview(db, "lg_ghost")).toEqual({ ok: false, status: 404, reason: DISSOLUTION_REFUSALS.leagueMissing });
  });

  it("names the league and its seated count, without touching the draft or the book", async () => {
    await seedLeague({ id: "lg_dp", filled: 3 });

    expect(await dissolutionPreview(db, "lg_dp")).toEqual({ ok: true, leagueName: "Dissolution Test League", seatedCount: 3 });

    const [draft] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.leagueId, "lg_dp"));
    expect(draft!.status).toBe("scheduled");
  });

  it("reads zero for a league nobody has joined yet", async () => {
    await seedLeague({ id: "lg_dp_empty" });
    expect(await dissolutionPreview(db, "lg_dp_empty")).toEqual({ ok: true, leagueName: "Dissolution Test League", seatedCount: 0 });
  });
});

describe("dissolveLeague — refusals", () => {
  it("refuses a league that does not exist", async () => {
    const before = await snapshotSurface();
    const outcome = await dissolveLeague(db, { leagueId: "lg_ghost", operatorUserId: OPERATOR }, { clock, audit, newId });
    expect(outcome).toEqual({ ok: false, status: 404, reason: DISSOLUTION_REFUSALS.leagueMissing });
    await expectNoDissolutionTookPlace(before);
  });

  it("refuses once the draft has started, and touches nothing", async () => {
    await seedLeague({ id: "lg_live", entryFeeCents: FEE, draftStatus: "in_progress", filled: 1 });
    const before = await snapshotSurface();
    const outcome = await dissolveLeague(db, { leagueId: "lg_live", operatorUserId: OPERATOR }, { clock, audit, newId });
    expect(outcome).toEqual({ ok: false, status: 409, reason: DISSOLUTION_REFUSALS.draftStarted });
    await expectNoDissolutionTookPlace(before);
  });

  it("refuses a completed draft's league the same way", async () => {
    await seedLeague({ id: "lg_done", entryFeeCents: FEE, draftStatus: "complete", filled: 1 });
    const before = await snapshotSurface();
    const outcome = await dissolveLeague(db, { leagueId: "lg_done", operatorUserId: OPERATOR }, { clock, audit, newId });
    expect(outcome).toEqual({ ok: false, status: 409, reason: DISSOLUTION_REFUSALS.draftStarted });
    await expectNoDissolutionTookPlace(before);
  });
});

/** The house reconciler's own actor id (`HOUSE_RECONCILER_ACTOR`, `@/league-service/house-factory`)
 *  — spelled out as a plain literal here rather than imported, so this suite stays about
 *  `dissolveLeague`'s own contract and never reaches into a sibling service module for a string. */
const RETIREMENT_CALLER = "house-reconciler";

describe("dissolveLeague — expectSeatedCount (wave-1 review A1)", () => {
  it("refuses a league seated between the retirement candidate read and this call itself, before any write", async () => {
    await seedLeague({ id: "lg_race", entryFeeCents: FEE });
    // The retirement caller's own candidate read happened here, computing filledTeams === 0 —
    // simulated by seating a team AFTER that read but BEFORE `dissolveLeague`'s own transaction
    // opens, the exact race `expectSeatedCount` exists to catch.
    await seedUser("u_racer");
    await db.insert(teams).values({ id: "lg_race_t0", leagueId: "lg_race", userId: "u_racer", name: "Racer" });

    const before = await snapshotSurface();
    const outcome = await dissolveLeague(
      db,
      { leagueId: "lg_race", operatorUserId: RETIREMENT_CALLER, expectSeatedCount: 0 },
      { clock, audit, newId },
    );
    expect(outcome).toEqual({ ok: false, status: 409, reason: DISSOLUTION_REFUSALS.seatsChanged });
    // No write at all — not even a refund for the racer who just joined.
    await expectNoDissolutionTookPlace(before);
    expect(await draftStatusOf("lg_race")).toBe("scheduled");
  });

  it("the operator door passes no expectation at all, and dissolving a seated league still works exactly as before", async () => {
    await seedLeague({ id: "lg_operator_seated", entryFeeCents: FEE, filled: 2, commissionerUserId: "u_commish_seated" });
    const outcome = await dissolveLeague(db, { leagueId: "lg_operator_seated", operatorUserId: OPERATOR }, { clock, audit, newId });
    expect(outcome).toMatchObject({ ok: true, refundedMembers: 2 });
    expect(await draftStatusOf("lg_operator_seated")).toBe("dissolved");
  });

  it("a retirement call whose seated count still matches the expectation dissolves normally", async () => {
    await seedLeague({ id: "lg_retire_ok" });
    const outcome = await dissolveLeague(
      db,
      { leagueId: "lg_retire_ok", operatorUserId: RETIREMENT_CALLER, expectSeatedCount: 0 },
      { clock, audit, newId },
    );
    expect(outcome).toEqual({ ok: true, refundedMembers: 0, totalRefundedCents: 0 });
    expect(await draftStatusOf("lg_retire_ok")).toBe("dissolved");
  });
});

describe("dissolveLeague — the mark and the browse shelf", () => {
  it("marks the draft dissolved, one way, guarded", async () => {
    await seedLeague({ id: "lg_mark", commissionerUserId: "u_commish" });
    expect(await draftStatusOf("lg_mark")).toBe("scheduled");

    const outcome = await dissolveLeague(db, { leagueId: "lg_mark", operatorUserId: OPERATOR }, { clock, audit, newId });
    expect(outcome).toMatchObject({ ok: true });
    expect(await draftStatusOf("lg_mark")).toBe("dissolved");
  });

  it("dissolves with every dependency defaulted — no injected clock, audit or newId — the production path", async () => {
    await seedLeague({ id: "lg_defaults", commissionerUserId: "u_commish_defaults", filled: 1 });
    const outcome = await dissolveLeague(db, { leagueId: "lg_defaults", operatorUserId: OPERATOR });
    expect(outcome).toEqual({ ok: true, refundedMembers: 1, totalRefundedCents: 0 });
    expect(await draftStatusOf("lg_defaults")).toBe("dissolved");
  });

  it("leaves the public browse shelf the moment it dissolves, via the existing predicate", async () => {
    await seedLeague({ id: "lg_shelf", commissionerUserId: "u_commish2" });
    const before = await browseQuery(db, EMPTY_BROWSE_FILTER);
    expect(before.some((row) => row.id === "lg_shelf")).toBe(true);

    await dissolveLeague(db, { leagueId: "lg_shelf", operatorUserId: OPERATOR }, { clock, audit, newId });

    const after = await browseQuery(db, EMPTY_BROWSE_FILTER);
    expect(after.some((row) => row.id === "lg_shelf")).toBe(false);
  });
});

describe("dissolveLeague — the free-season law", () => {
  it("dissolves a free league without a single money table read or write", async () => {
    await seedLeague({ id: "lg_free", filled: 2 });
    const seatedBefore = await seatedUsersOf("lg_free");
    expect(seatedBefore).toHaveLength(2);

    const statements = await recordStatements(db, (logged) =>
      dissolveLeague(logged, { leagueId: "lg_free", operatorUserId: OPERATOR }, { clock, audit, newId }).then((outcome) => {
        expect(outcome).toEqual({ ok: true, refundedMembers: 2, totalRefundedCents: 0 });
      }),
    );
    expect(statements.length).toBeGreaterThan(0);
    expect(statements.filter((s) => /money_/.test(s))).toHaveLength(0);
    await expect(dissolveLeague(db, { leagueId: "lg_free", operatorUserId: OPERATOR }, { clock, audit, newId })).resolves.toMatchObject({
      ok: false,
      status: 409,
    });

    // Every seated member still gets told, with no fee to report back.
    const notices = await db.select().from(memberNotices).where(and(eq(memberNotices.leagueId, "lg_free"), eq(memberNotices.noticeType, "league_dissolved")));
    expect(notices).toHaveLength(2);
    for (const notice of notices) expect(notice.context).toMatchObject({ refundedCents: 0 });
  });
});

describe("dissolveLeague — the refund, per seat", () => {
  it("refunds every seated member's fee in one transaction, escrow closes at exactly zero", async () => {
    await seedLeague({ id: "lg_paid", entryFeeCents: FEE, teamCount: 6 });
    await seedUser("u1");
    await seedUser("u2");
    await fund("u1", FEE);
    await fund("u2", FEE);
    expect(await paidJoin("lg_paid", "u1")).toMatchObject({ ok: true });
    expect(await paidJoin("lg_paid", "u2")).toMatchObject({ ok: true });
    expect((await walletSummary(db, "u1")).availableCents).toBe(0);
    expect((await walletSummary(db, "u2")).availableCents).toBe(0);

    const outcome = await dissolveLeague(db, { leagueId: "lg_paid", operatorUserId: OPERATOR }, { clock, audit, newId });
    expect(outcome).toEqual({ ok: true, refundedMembers: 2, totalRefundedCents: 2 * FEE });

    expect((await walletSummary(db, "u1")).availableCents).toBe(FEE);
    expect((await walletSummary(db, "u2")).availableCents).toBe(FEE);
    const [escrow] = await db.select().from(moneyAccounts).where(eq(moneyAccounts.id, accountIdFor("league_escrow", "lg_paid")));
    expect(escrow!.balanceCents).toBe(0);

    const refunds = await db.select().from(moneyTransactions).where(eq(moneyTransactions.kind, "entry_fee_refund"));
    expect(refunds).toHaveLength(2);
    expect(refunds.every((row) => row.leagueId === "lg_paid")).toBe(true);
  });

  it("refunds nothing for a seeded, never-charged seat, alongside a real refund for a paid one", async () => {
    await seedLeague({ id: "lg_mixed", entryFeeCents: FEE, teamCount: 6, filled: 1 });
    const seededUserId = "lg_mixed_seat_0";
    await seedUser("u_paid");
    await fund("u_paid", FEE);
    expect(await paidJoin("lg_mixed", "u_paid")).toMatchObject({ ok: true });

    const outcome = await dissolveLeague(db, { leagueId: "lg_mixed", operatorUserId: OPERATOR }, { clock, audit, newId });
    expect(outcome).toEqual({ ok: true, refundedMembers: 2, totalRefundedCents: FEE });

    const seededNotice = await db
      .select()
      .from(memberNotices)
      .where(and(eq(memberNotices.userId, seededUserId), eq(memberNotices.noticeType, "league_dissolved")));
    expect(seededNotice[0]?.context).toMatchObject({ refundedCents: 0 });
    const paidNotice = await db
      .select()
      .from(memberNotices)
      .where(and(eq(memberNotices.userId, "u_paid"), eq(memberNotices.noticeType, "league_dissolved")));
    expect(paidNotice[0]?.context).toMatchObject({ refundedCents: FEE });
  });

  it("rolls the whole dissolution back when a refund posting itself refuses", async () => {
    await seedLeague({ id: "lg_sabotage", entryFeeCents: FEE });
    await seedUser("u1");
    await fund("u1", FEE);
    expect(await paidJoin("lg_sabotage", "u1")).toMatchObject({ ok: true });
    const before = await snapshotSurface();
    // The identical sabotage `entry-fee.test.ts` uses for `refundEntryFeeInTx`'s own failure
    // path: corrupt the escrow ROLLUP so the writer's balance floor refuses.
    await db.update(moneyAccounts).set({ balanceCents: 0 }).where(eq(moneyAccounts.id, accountIdFor("league_escrow", "lg_sabotage")));

    await expect(dissolveLeague(db, { leagueId: "lg_sabotage", operatorUserId: OPERATOR }, { clock, audit, newId })).rejects.toThrow(
      /refund posting refused/,
    );
    // The rollback kept the draft scheduled and the seat seated — no half-dissolved league. The
    // sabotage itself sits OUTSIDE the rolled-back transaction, so only the accounts table (the
    // corrupted rollup) is excluded from the otherwise whole-surface comparison to `before`.
    expect(await draftStatusOf("lg_sabotage")).toBe("scheduled");
    expect(await seatedUsersOf("lg_sabotage")).toEqual(["u1"]);
    expect(await db.select().from(auditEvents)).toEqual(before.auditEvents);
    expect(await db.select().from(memberNotices)).toEqual(before.memberNotices);
    expect((await snapshotMoneyBook(db)).transactions).toEqual(before.money.transactions);
    expect((await snapshotMoneyBook(db)).entries).toEqual(before.money.entries);
  });
});

describe("dissolveLeague — the league-wide anchor", () => {
  it("records league_dissolved as a system_action on the league's own chain, actorless by construction", async () => {
    await seedLeague({ id: "lg_anchor", entryFeeCents: FEE, filled: 1 });
    await dissolveLeague(db, { leagueId: "lg_anchor", operatorUserId: OPERATOR }, { clock, audit, newId });

    const [event] = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.leagueId, "lg_anchor"), eq(auditEvents.eventType, "system_action")));
    expect(event).toMatchObject({
      actorId: null,
      actorType: "system",
      payload: { action: "league_dissolved", summary: LEAGUE_DISSOLVED_SUMMARY, operatorUserId: OPERATOR },
    });
  });

  it("attaches every member's notice to that same anchor event", async () => {
    await seedLeague({ id: "lg_attach", entryFeeCents: FEE, filled: 2 });
    await dissolveLeague(db, { leagueId: "lg_attach", operatorUserId: OPERATOR }, { clock, audit, newId });

    const [event] = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.leagueId, "lg_attach"), eq(auditEvents.eventType, "system_action")));
    const notices = await db.select().from(memberNotices).where(eq(memberNotices.leagueId, "lg_attach"));
    expect(notices).toHaveLength(2);
    for (const notice of notices) expect(notice.auditEventId).toBe(event!.eventId);
  });
});

/**
 * PHASE 4, TASK 9 FIX ROUND (review spec, executed verbatim). The hole: `invitePrecondition`
 * (the closure inside `acceptInvite`, `@/league-service/invites`) never asked a question about
 * the league's own season state — only an invite's expiry and use cap — so a still-valid invite
 * link into a DISSOLVED paid league could otherwise still seat someone and collect a fee into an
 * escrow the operator had already closed. The fix lives in `joinLeagueInTx` itself (the shared
 * draft-status refusal, `join.ts`'s own docblock), so BOTH doors close with the SAME
 * `DRAFT_ALREADY_STARTED` sentence `join.ts` already owns — never a dissolution-specific one,
 * `invites.ts`'s own no-existence-oracle discipline carried one state further.
 */
describe("the two-door proof — a dissolved PAID league refuses both doors", () => {
  it("refuses an invite-accept and a public-browse attempt alike, no team row, no fee posting, no invite-use increment", async () => {
    await seedLeague({ id: "lg_two_door", entryFeeCents: FEE, teamCount: 6, commissionerUserId: "u_two_door_commish" });
    const dissolved = await dissolveLeague(db, { leagueId: "lg_two_door", operatorUserId: OPERATOR }, { clock, audit, newId });
    expect(dissolved).toMatchObject({ ok: true });

    // THE INVITE DOOR. Minted AFTER dissolution — creating an invite asks nothing about draft
    // status either, so this is the exact still-valid link a support conversation could
    // reproduce for real.
    const invite = await createInvite({ db, clock, random: () => 0.5 }, { leagueId: "lg_two_door", createdByUserId: "u_two_door_commish" });
    if (!invite.ok) throw new Error(invite.reason);
    await seedUser("u_invited");
    await fund("u_invited", FEE);
    const beforeInvite = await snapshotMoneyBook(db);
    const inviteOutcome = await acceptInvite({ db, clock, newId }, { code: invite.code, userId: "u_invited" });
    expect(inviteOutcome).toEqual({ ok: false, status: 409, reason: DRAFT_ALREADY_STARTED });
    await expectNoPostingTookPlace(db, beforeInvite);
    expect(await seatedUsersOf("lg_two_door")).not.toContain("u_invited");
    const [inviteRow] = await db.select().from(leagueInvites).where(eq(leagueInvites.code, invite.code));
    expect(inviteRow!.uses).toBe(0);

    // THE PUBLIC-BROWSE DOOR. The league is already off the shelf (proven elsewhere in this
    // file); this is the direct-id attempt a stale tab or a shared link could still make.
    await seedUser("u_browser");
    await fund("u_browser", FEE);
    const beforeBrowse = await snapshotMoneyBook(db);
    const browseOutcome = await joinPublicLeague(
      { db, newId: () => newId(), clock },
      { leagueId: "lg_two_door", userId: "u_browser", money: { stateOfEntry: "TN", states: enabledTN } },
    );
    expect(browseOutcome).toEqual({ ok: false, status: 409, reason: DRAFT_ALREADY_STARTED });
    await expectNoPostingTookPlace(db, beforeBrowse);
    expect(await seatedUsersOf("lg_two_door")).not.toContain("u_browser");
  });
});
