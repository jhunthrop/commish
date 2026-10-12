import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@research/db/client";
import { DB_POOL_CONFIG } from "@research/db/config";
import { TEST_DATABASE_URL, createTestDb } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import { players } from "@research/db/schema";
import { draftActions } from "@/db/schema";
import { DRAFT_ACTION_VERSION, type DraftAction } from "@research/domain/draft";
import { availablePool, bestAvailableFor, teamOnClock, type DraftState } from "@/draft-engine";
import { createDraftStore } from "./store";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "./test-support";

const DRAFT_ID = "draft_multi_instance";
const LEAGUE_ID = "league_multi_instance";

/** Separate from either simulated app instance below — used only to seed and truncate. */
const seedDb = createTestDb();

/**
 * TWO app instances, simulated the only way that is actually meaningful: two Drizzle clients
 * over two INDEPENDENT postgres-js connection pools, each with its own `createDraftStore` and
 * therefore its own in-process cache and its own mutex. A single shared `db` would prove
 * nothing — the whole class of bug here is one process not seeing what another process wrote.
 */
function instance() {
  const db = createDb(TEST_DATABASE_URL, {
    max: DB_POOL_CONFIG.testMaxConnections,
    idleTimeoutSeconds: DB_POOL_CONFIG.testIdleTimeoutSeconds,
  });
  const store = createDraftStore({ db, publish: async () => null, clock: { now: () => new Date().toISOString() } });
  return { db, store };
}

/** The one legal action for whichever team is on the clock, mirroring `scripts/drive-dev-draft.ts`. */
function firstPickFor(state: DraftState): DraftAction {
  const teamId = teamOnClock(state);
  if (teamId === null) throw new Error("No team is on the clock");
  const best = bestAvailableFor(state, teamId);
  if (best === null) throw new Error("No player is available to draft");
  return { v: DRAFT_ACTION_VERSION, type: "MAKE_PICK", timestamp: new Date().toISOString(), teamId, playerId: best.playerId };
}

/**
 * The on-clock team's pick of the two best available players, as two `MAKE_PICK` actions. Both
 * are individually legal from `state` — the team's roster is empty, so either player fits — but
 * only the first can ever be admitted once submitted, because the second is evaluated against a
 * log that already contains the first and turn order has moved on. That's the point: a lock
 * that merely rejected the loser via the sequence clash would produce the SAME two actions
 * without ever exercising the draft's own turn-order rule.
 */
function twoDistinctPicksFor(state: DraftState): [DraftAction, DraftAction] {
  const teamId = teamOnClock(state);
  if (teamId === null) throw new Error("No team is on the clock");
  const [first, second] = availablePool(state);
  if (first === undefined || second === undefined) throw new Error("Fewer than two players are available to draft");
  const pickOf = (playerId: string): DraftAction => ({
    v: DRAFT_ACTION_VERSION,
    type: "MAKE_PICK",
    timestamp: new Date().toISOString(),
    teamId,
    playerId,
  });
  return [pickOf(first.playerId), pickOf(second.playerId)];
}

/** Seeds a league/draft and starts it, so both instances see an in-progress snake draft. */
async function seedStartableDraft(): Promise<void> {
  await seedDraftFixture(seedDb, {
    draftId: DRAFT_ID,
    leagueId: LEAGUE_ID,
    format: "snake",
    teamCount: 2,
    slotConfig: SPRINT_ROSTER_SLOTS,
    kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
    auctionBudget: null,
  });
  await seedDb.insert(players).values([
    { id: "qb1", name: "QB One", position: "QB", nflTeam: "KC" },
    { id: "rb1", name: "RB One", position: "RB", nflTeam: "SF" },
    { id: "wr1", name: "WR One", position: "WR", nflTeam: "NYJ" },
    { id: "qb2", name: "QB Two", position: "QB", nflTeam: "KC" },
    { id: "rb2", name: "RB Two", position: "RB", nflTeam: "SF" },
    { id: "wr2", name: "WR Two", position: "WR", nflTeam: "NYJ" },
  ]);
  const seedStore = createDraftStore({
    db: seedDb,
    publish: async () => null,
    clock: { now: () => new Date().toISOString() },
  });
  const started = await seedStore.startDraft(DRAFT_ID);
  if (!started.ok) throw new Error(`seed failed to start draft: ${started.reason}`);
}

describe("two app instances against one draft", () => {
  beforeEach(async () => {
    await truncateAll(seedDb);
    await seedStartableDraft();
  });

  it("shows instance B a pick that instance A made, without restarting B", async () => {
    const a = instance();
    const b = instance();

    // Warm B's cache FIRST, so it holds a materialization that is about to go stale.
    const before = await b.store.getDraftState(DRAFT_ID);
    expect(before?.picks).toHaveLength(0);

    const aState = await a.store.getDraftState(DRAFT_ID);
    const applied = await a.store.applyAction(DRAFT_ID, firstPickFor(aState!));
    expect(applied.ok).toBe(true);

    const after = await b.store.getDraftState(DRAFT_ID);
    expect(after?.picks).toHaveLength(1);
    expect(after?.sequence).toBe(before!.sequence + 1);

    await a.db.$client.end();
    await b.db.$client.end();
  });

  it("accepts exactly one of two simultaneous picks and rejects the other cleanly", async () => {
    const a = instance();
    const b = instance();

    const state = await a.store.getDraftState(DRAFT_ID);
    await b.store.getDraftState(DRAFT_ID); // warm B too, so both hold the same view
    const action = firstPickFor(state!);

    const [resultA, resultB] = await Promise.all([
      a.store.applyAction(DRAFT_ID, action),
      b.store.applyAction(DRAFT_ID, action),
    ]);

    const accepted = [resultA, resultB].filter((result) => result.ok);
    expect(accepted).toHaveLength(1);

    const rejected = [resultA, resultB].find((result) => !result.ok);
    // A user-facing plain-language reason, per conventions.md. Never a driver message.
    expect(rejected && "reason" in rejected ? rejected.reason : "").not.toContain("duplicate key");

    // And exactly one pick landed in the log, not two.
    const [{ count }] = await a.db
      .select({ count: sql<number>`count(*)::int` })
      .from(draftActions)
      .where(eq(draftActions.draftId, DRAFT_ID));
    expect(count).toBe(state!.sequence + 1);

    await a.db.$client.end();
    await b.db.$client.end();
  });

  it("serializes two different legal actions rather than losing one to a sequence clash", async () => {
    const a = instance();
    const b = instance();
    const state = await a.store.getDraftState(DRAFT_ID);

    // Two distinct picks, both legal from `state`, submitted at once. Under a row lock the
    // second one re-reads the log inside the lock, sees the first, and is admitted or rejected
    // on the DRAFT'S OWN RULES (whose turn it is) rather than on a sequence collision.
    const [first, second] = twoDistinctPicksFor(state!);
    const results = await Promise.all([a.store.applyAction(DRAFT_ID, first), b.store.applyAction(DRAFT_ID, second)]);

    // EXACTLY one, not "at least one": per twoDistinctPicksFor's own docblock, the second action
    // can never be admitted once the first commits, because it is the same team picking again
    // out of turn. Loose enough to tolerate a double-write, this assertion would not have been
    // what held the line — a real row count is.
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    for (const result of results) {
      if (!result.ok) expect(result.reason).not.toBe("Someone else acted first. Try again.");
    }

    const [{ count }] = await a.db
      .select({ count: sql<number>`count(*)::int` })
      .from(draftActions)
      .where(eq(draftActions.draftId, DRAFT_ID));
    expect(count).toBe(state!.sequence + 1);

    await a.db.$client.end();
    await b.db.$client.end();
  });
});
