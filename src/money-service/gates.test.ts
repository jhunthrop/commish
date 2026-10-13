import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll, truncateMoneyTables } from "@/db/test-db";
import type { Clock } from "@research-ts/domain/timing";
import { getAuditLogger } from "@/integrity-service/audit-logger";
import { accountIdFor } from "@/money/accounts";
import { MONEY_REFUSALS } from "@/money/config";
import { MONEY_STATES, type MoneyStatesConfig } from "@/money/states";
import { moneyGates, receivableIsClear, type MoneyGateSubject } from "./gates";
import { postMoneyTransaction, type PostDeps } from "./post";

const db = createTestDb();

const clock: Clock = { now: () => "2026-09-01T00:00:00.000Z" };
let nextId = 0;
const deps: PostDeps = { audit: getAuditLogger(), clock, newId: () => `gate_${(nextId += 1)}` };

/** The test-only enabled list the shipped-empty `MONEY_STATES` never carries — how these tests
 *  prove the pass path without a single state going live anywhere outside this file. */
const enabledTN: MoneyStatesConfig = {
  enabled: [{ state: "TN", minAge: 18 }],
  neverEligible: MONEY_STATES.neverEligible,
};

const subject = (overrides: Partial<MoneyGateSubject> = {}): MoneyGateSubject => ({
  id: "u1",
  kycStatus: "verified",
  selfExcludedAt: null,
  ...overrides,
});

/** Books `amountCents` of owed money onto `platform_receivable:<userId>` through the real
 *  writer — the post-return shape (ruling 5) without the full deposit lifecycle. */
async function bookReceivable(userId: string, amountCents: number): Promise<void> {
  const outcome = await db.transaction((tx) =>
    postMoneyTransaction(
      tx,
      {
        kind: "deposit_return",
        stateOfEntry: "TN",
        entries: [
          { accountId: accountIdFor("fbo_pool"), direction: "credit", amountCents },
          { accountId: accountIdFor("platform_receivable", userId), direction: "debit", amountCents },
        ],
        auditEvent: {
          eventType: "deposit_returned",
          actorId: userId,
          actorType: "user",
          leagueId: null,
          payload: { amountCents, shortfallCents: amountCents },
        },
      },
      deps,
    ),
  );
  expect(outcome).toMatchObject({ ok: true });
}

beforeEach(async () => {
  await truncateAll(db);
  await truncateMoneyTables(db);
});

describe("moneyGates", () => {
  it("refuses every user through the shipped MONEY_STATES, because the enabled list is empty — money ships dark", async () => {
    expect(MONEY_STATES.enabled).toHaveLength(0);
    const out = await moneyGates(db, subject(), "TN", "deposit", MONEY_STATES);
    expect(out).toEqual({ ok: false, status: 403, reason: MONEY_REFUSALS.stateNotEnabled });
  });

  it("refuses a state off the enabled list even when another state is on it", async () => {
    const out = await moneyGates(db, subject(), "NJ", "deposit", enabledTN);
    expect(out).toEqual({ ok: false, status: 403, reason: MONEY_REFUSALS.stateNotEnabled });
  });

  it("refuses before KYC is verified, and says why in plain words", async () => {
    for (const kycStatus of ["none", "pending", "failed"] as const) {
      const out = await moneyGates(db, subject({ kycStatus }), "TN", "deposit", enabledTN);
      expect(out).toEqual({ ok: false, status: 403, reason: MONEY_REFUSALS.kycRequired });
    }
    expect(MONEY_REFUSALS.kycRequired).toBe("Verify your identity first. Federal rules require it before you can hold a balance.");
  });

  it("refuses a self-excluded member at every door money enters", async () => {
    const excluded = subject({ selfExcludedAt: new Date("2026-08-30T00:00:00.000Z") });
    for (const door of ["deposit", "spend"] as const) {
      const out = await moneyGates(db, excluded, "TN", door, enabledTN);
      expect(out).toEqual({ ok: false, status: 403, reason: MONEY_REFUSALS.selfExcluded });
    }
  });

  it("does NOT refuse a self-excluded member at the withdrawal door — exclusion closes the doors money enters, never the door it leaves", async () => {
    const excluded = subject({ selfExcludedAt: new Date("2026-08-30T00:00:00.000Z") });
    expect(await moneyGates(db, excluded, "TN", "withdraw", enabledTN)).toEqual({ ok: true });
  });

  it("does NOT check the receivable at the withdrawal door — 'spend doors only', and a withdrawal never spends INTO the platform", async () => {
    await bookReceivable("u1", 30_00);
    expect(await moneyGates(db, subject(), "TN", "withdraw", enabledTN)).toEqual({ ok: true });
  });

  it("checks in the brief's fail-fast order: state before KYC before exclusion", async () => {
    const failsEverything = subject({ kycStatus: "none", selfExcludedAt: new Date("2026-08-30T00:00:00.000Z") });
    const stateFirst = await moneyGates(db, failsEverything, "NJ", "spend", enabledTN);
    expect(stateFirst).toMatchObject({ reason: MONEY_REFUSALS.stateNotEnabled });
    const kycSecond = await moneyGates(db, failsEverything, "TN", "spend", enabledTN);
    expect(kycSecond).toMatchObject({ reason: MONEY_REFUSALS.kycRequired });
  });

  it("blocks every paid door while anything is owed, and deliberately not the deposit door that settles it", async () => {
    await bookReceivable("u1", 30_00);
    const spend = await moneyGates(db, subject(), "TN", "spend", enabledTN);
    expect(spend).toEqual({ ok: false, status: 403, reason: MONEY_REFUSALS.balanceOwed });
    const deposit = await moneyGates(db, subject(), "TN", "deposit", enabledTN);
    expect(deposit).toEqual({ ok: true });
  });

  it("passes a verified, included member in an enabled state through every door when nothing is owed", async () => {
    for (const door of ["deposit", "spend", "withdraw"] as const) {
      expect(await moneyGates(db, subject(), "TN", door, enabledTN)).toEqual({ ok: true });
    }
  });
});

describe("receivableIsClear", () => {
  it("is clear for a member the book has never seen — no account row is no debt", async () => {
    expect(await receivableIsClear(db, "u_never_seen")).toBe(true);
  });

  it("flips with the receivable's own book: owed after a shortfall, clear once settled", async () => {
    await bookReceivable("u1", 20_00);
    expect(await receivableIsClear(db, "u1")).toBe(false);

    const settled = await db.transaction((tx) =>
      postMoneyTransaction(
        tx,
        {
          kind: "receivable_settlement",
          stateOfEntry: "TN",
          entries: [
            { accountId: accountIdFor("fbo_pool"), direction: "debit", amountCents: 20_00 },
            { accountId: accountIdFor("platform_receivable", "u1"), direction: "credit", amountCents: 20_00 },
          ],
          auditEvent: {
            eventType: "system_action",
            actorId: null,
            actorType: "system",
            leagueId: null,
            payload: { outcome: "receivable_settlement", userId: "u1", amountCents: 20_00 },
          },
        },
        deps,
      ),
    );
    expect(settled).toMatchObject({ ok: true });
    expect(await receivableIsClear(db, "u1")).toBe(true);
  });
});
