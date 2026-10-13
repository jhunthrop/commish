import { describe, it, expect, beforeEach } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "@research-ts/db/client";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { players } from "@research-ts/db/schema";
import { draftActions, draftSlotPreferences, drafts } from "@/db/schema";
import { draftOrderFor, drawSequenceFor } from "./order";
import { createDraftStore } from "./store";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "./test-support";
import { setSlotPreference, slotPreferencesFor, SLOT_PREFERENCE_REFUSALS } from "./slot-preference";

const db = createTestDb();
/** The second connection every two-transaction case below drives its other half on. */
const raceDb = createTestDb();
const KICKOFF = new Date("2026-09-01T00:00:00.000Z");

/**
 * Waits until some backend on this database is genuinely blocked on a lock — the same question
 * `src/integrity-service/lock-order.test.ts` asks Postgres for the same reason: on a loaded
 * machine a fixed sleep can expire before the other side has taken anything, and the test then
 * proves nothing in either direction. Unscoped safely: vitest runs test FILES sequentially
 * (`fileParallelism: false`), so the only transactions in flight here are the two under test.
 */
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
});

async function seed(teamCount = 12) {
  return seedDraftFixture(db, {
    draftId: "draft_1",
    leagueId: "league_1",
    format: "snake",
    teamCount,
    slotConfig: SPRINT_ROSTER_SLOTS,
    kickoffAt: KICKOFF,
    auctionBudget: null,
  });
}

async function rowFor(draftId: string, teamId: string) {
  const [row] = await db
    .select()
    .from(draftSlotPreferences)
    .where(and(eq(draftSlotPreferences.draftId, draftId), eq(draftSlotPreferences.teamId, teamId)));
  return row;
}

async function expectNoSlotPreferenceTookPlace(draftId: string, teamId: string): Promise<void> {
  expect(await rowFor(draftId, teamId)).toBeUndefined();
}

describe("setSlotPreference", () => {
  it("refuses a ranking once the draft has started", async () => {
    const { draftId, leagueId, teamIds, userIds } = await seed();
    await db.update(drafts).set({ status: "in_progress" }).where(eq(drafts.id, draftId));

    const result = await setSlotPreference(db, { leagueId, userId: userIds[0]!, ranking: [1, 2] });

    expect(result).toEqual({ ok: false, status: 409, reason: SLOT_PREFERENCE_REFUSALS.alreadyStarted });
    await expectNoSlotPreferenceTookPlace(draftId, teamIds[0]!);
  });

  it("refuses a slot number this league does not have", async () => {
    const { draftId, leagueId, teamIds, userIds } = await seed(12);

    const result = await setSlotPreference(db, { leagueId, userId: userIds[0]!, ranking: [13] });

    expect(result).toEqual({ ok: false, status: 422, reason: "Pick from slots 1 to 12." });
    await expectNoSlotPreferenceTookPlace(draftId, teamIds[0]!);
  });

  it("refuses a slot number below 1 the same way it refuses one too high", async () => {
    const { draftId, leagueId, teamIds, userIds } = await seed(12);

    const result = await setSlotPreference(db, { leagueId, userId: userIds[0]!, ranking: [0] });

    expect(result).toEqual({ ok: false, status: 422, reason: "Pick from slots 1 to 12." });
    await expectNoSlotPreferenceTookPlace(draftId, teamIds[0]!);
  });

  it("refuses a repeated slot, because a ranking is an order and not a wish list", async () => {
    const { draftId, leagueId, teamIds, userIds } = await seed();

    const result = await setSlotPreference(db, { leagueId, userId: userIds[0]!, ranking: [2, 2] });

    expect(result).toMatchObject({ ok: false, status: 422 });
    await expectNoSlotPreferenceTookPlace(draftId, teamIds[0]!);
  });

  it("accepts a partial ranking, because most managers care about two slots and not twelve", async () => {
    const { draftId, leagueId, teamIds, userIds } = await seed();

    const result = await setSlotPreference(db, { leagueId, userId: userIds[0]!, ranking: [1, 12] });

    expect(result).toMatchObject({ ok: true });
    expect((await rowFor(draftId, teamIds[0]!))?.ranking).toEqual([1, 12]);
  });

  it("saves an empty ranking too, because 'I do not mind' is a real answer", async () => {
    const { leagueId, userIds } = await seed();

    const result = await setSlotPreference(db, { leagueId, userId: userIds[0]!, ranking: [] });

    expect(result).toEqual({ ok: true, ranking: [] });
  });

  it("answers 404 to somebody who is not in this league, never 403", async () => {
    const { draftId, leagueId, teamIds } = await seed();

    const result = await setSlotPreference(db, { leagueId, userId: "a_total_stranger", ranking: [1] });

    expect(result).toMatchObject({ ok: false, status: 404 });
    await expectNoSlotPreferenceTookPlace(draftId, teamIds[0]!);
  });

  it("overwrites a previous ranking in place rather than accumulating rows", async () => {
    const { draftId, leagueId, teamIds, userIds } = await seed();
    await setSlotPreference(db, { leagueId, userId: userIds[0]!, ranking: [1, 2] });

    await setSlotPreference(db, { leagueId, userId: userIds[0]!, ranking: [3] });

    expect((await rowFor(draftId, teamIds[0]!))?.ranking).toEqual([3]);
  });

  it("guards against the draft vanishing between the team lookup and the lock, even though it cannot happen through ordinary use", async () => {
    // `teamRow.draftId` is read from a real, just-completed join, so the re-select inside the
    // transaction can never come back empty through the schema's own FKs — proven the same way
    // `store.test.ts`'s "config join comes back empty" case is: a stub `tx` is the only way to
    // split an event real Postgres never lets split.
    const { leagueId, userIds } = await seed();
    const vanishing = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "transaction") {
          return (fn: (tx: unknown) => Promise<unknown>) =>
            fn({ select: () => ({ from: () => ({ where: () => ({ for: () => Promise.resolve([]) }) }) }) });
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as Db;

    const result = await setSlotPreference(vanishing, { leagueId, userId: userIds[0]!, ranking: [1] });

    expect(result).toMatchObject({ ok: false, status: 404 });
  });
});

/**
 * FINAL WHOLE-BRANCH REVIEW, F9 — THE WRITE THAT SAID `ok: true` AND DID NOTHING.
 *
 * `startDraft` (`./store`) used to read every team's ranking OUTSIDE its own transaction, before
 * `applyAction` ever took `drafts FOR UPDATE`. A `setSlotPreference` committing in that window
 * passed this module's status check (the draft was still `'scheduled'`), answered `ok: true`, and
 * changed nothing: the draw it was meant to feed had already run against a table that did not yet
 * hold its row. Ruling 27 says the panel tells the truth about what it did rather than accepting a
 * dead write, so the read moved inside the lock (`DraftActionSource`, `./store`).
 *
 * Both halves are driven on two real connections, because the whole point is which SIDE of a row
 * lock a read falls on, and that is not observable from one.
 */
describe("setSlotPreference against a concurrent start", () => {
  it("refuses a ranking that raced a start, rather than saving one the draw can no longer read", async () => {
    const { draftId, leagueId, teamIds, userIds } = await seed(2);

    // T_start, stood in for by a real transaction taking the identical row-exclusive lock the
    // start's own claim takes — the same technique `lock-order.test.ts` uses for `persistTick`,
    // because what is under test is the RANKING's behavior when it loses the row.
    let holdsDraftRow: () => void = () => {};
    const draftRowLocked = new Promise<void>((resolve) => (holdsDraftRow = resolve));
    let releaseStart: () => void = () => {};
    const startCommitted = new Promise<void>((resolve) => (releaseStart = resolve));
    const starting = db.transaction(async (tx) => {
      await tx.update(drafts).set({ status: "in_progress" }).where(eq(drafts.id, draftId));
      holdsDraftRow();
      await startCommitted;
    });
    await draftRowLocked;

    const ranking = setSlotPreference(raceDb, { leagueId, userId: userIds[0]!, ranking: [1] });

    expect(await waitForBlockedBackend()).toBe(true);
    releaseStart();
    await starting;

    // It waited, re-read the row the winner committed, and refused — never read a stale
    // `'scheduled'` and saved a ranking nothing would ever draw from.
    expect(await ranking).toEqual({ ok: false, status: 409, reason: SLOT_PREFERENCE_REFUSALS.alreadyStarted });
    await expectNoSlotPreferenceTookPlace(draftId, teamIds[0]!);
  });

  it("draws from a ranking that committed while the start was waiting for the draft row", async () => {
    // THE OTHER HALF, and the one that fails against the pre-F9 source: a ranking that lands
    // BEFORE the start takes its lock must be in the draw. The bystander below holds the draft row
    // `FOR NO KEY UPDATE` — chosen precisely because it conflicts with the start's `FOR UPDATE`
    // (so the start genuinely waits) but NOT with the `FOR KEY SHARE` a `draft_slot_preferences`
    // insert takes on the same row through its own foreign key (so the ranking can still commit
    // while the start is parked). The row is written directly rather than through
    // `setSlotPreference`, which would take `FOR UPDATE` and park behind the bystander too: what
    // is under test is which side of the lock the START's READ falls on, and the row's author is
    // beside the point.
    const { draftId, teamIds } = await seed(2);
    // Two teams x `SPRINT_ROSTER_SLOTS` — `buildDraftPool` refuses a pool too small to fill every
    // roster, and this test needs a start that actually runs.
    await db.insert(players).values([
      { id: "qb1", name: "QB One", position: "QB", nflTeam: "FA" },
      { id: "rb1", name: "RB One", position: "RB", nflTeam: "FA" },
      { id: "wr1", name: "WR One", position: "WR", nflTeam: "FA" },
      { id: "qb2", name: "QB Two", position: "QB", nflTeam: "FA" },
      { id: "rb2", name: "RB Two", position: "RB", nflTeam: "FA" },
      { id: "wr2", name: "WR Two", position: "WR", nflTeam: "FA" },
    ]);
    // The FIRST team in the draw sequence, asking for slot 2. With nobody else ranking anything,
    // that is the one preference a two-team draw can actually honor: unranked teams take the
    // lowest free slot at their own turn, so a first-drawn team claiming slot 2 pushes the
    // second-drawn team into slot 1 and reverses the order. A ranking the draw never read would
    // leave the sequence exactly as `drawSequenceFor` produced it.
    const draw = drawSequenceFor(draftId, teamIds);

    let holdsDraftRow: () => void = () => {};
    const draftRowLocked = new Promise<void>((resolve) => (holdsDraftRow = resolve));
    let releaseHold: () => void = () => {};
    const held = new Promise<void>((resolve) => (releaseHold = resolve));
    const holding = db.transaction(async (tx) => {
      await tx.select({ id: drafts.id }).from(drafts).where(eq(drafts.id, draftId)).for("no key update");
      holdsDraftRow();
      await held;
    });
    await draftRowLocked;

    const store = createDraftStore({
      db: raceDb,
      publish: async () => "1-0",
      clock: { now: () => "2026-08-25T00:00:00.000Z" },
      deliverNotice: async () => {},
    });
    const starting = store.startDraft(draftId);
    expect(await waitForBlockedBackend()).toBe(true);

    // Committed AFTER the start's own out-of-transaction reads are long done, and while its
    // transaction is parked on the draft row it has not been granted yet.
    await raceDb
      .insert(draftSlotPreferences)
      .values({ draftId, teamId: draw[0]!, ranking: [2], updatedAt: new Date() });

    releaseHold();
    await holding;
    const started = await starting;
    expect(started.ok ? "ok" : started.reason).toBe("ok");

    // The persisted `START_DRAFT` — the authoritative record — reversed the draw, which it can
    // only have done by reading a row that did not exist when `startDraft` was called.
    const [row] = await db
      .select({ action: draftActions.action })
      .from(draftActions)
      .where(eq(draftActions.draftId, draftId))
      .orderBy(asc(draftActions.sequence));
    expect((row!.action as { draftOrder: string[] }).draftOrder).toEqual([draw[1], draw[0]]);
    // And the ranking really was the cause, not the shuffle: with no preference at all this same
    // draft draws the other order, which is exactly what the pre-F9 read produced.
    expect(draftOrderFor(draftId, teamIds)).toEqual([draw[0], draw[1]]);
  });
});

describe("slotPreferencesFor", () => {
  it("returns every team's saved ranking, keyed by team id", async () => {
    const { draftId, leagueId, teamIds, userIds } = await seed();
    await setSlotPreference(db, { leagueId, userId: userIds[0]!, ranking: [1] });
    await setSlotPreference(db, { leagueId, userId: userIds[1]!, ranking: [2, 3] });

    expect(await slotPreferencesFor(db, draftId)).toEqual({
      [teamIds[0]!]: [1],
      [teamIds[1]!]: [2, 3],
    });
  });

  it("returns an empty map for a draft nobody has ranked anything in", async () => {
    const { draftId } = await seed();

    expect(await slotPreferencesFor(db, draftId)).toEqual({});
  });
});
