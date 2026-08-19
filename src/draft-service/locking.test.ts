import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/db/client";
import { DB_POOL_CONFIG } from "@/db/config";
import { TEST_DATABASE_URL, createTestDb, truncateAll } from "@/db/test-db";
import { players } from "@/db/schema";
import { DRAFT_ACTION_VERSION, type DraftAction } from "@/domain/draft";
import { bestAvailableFor, teamOnClock, type DraftState } from "@/draft-engine";
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
});
