import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import { draftSlotPreferences, drafts } from "@/db/schema";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "./test-support";
import { setSlotPreference, slotPreferencesFor, SLOT_PREFERENCE_REFUSALS } from "./slot-preference";

const db = createTestDb();
const KICKOFF = new Date("2026-09-01T00:00:00.000Z");

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
