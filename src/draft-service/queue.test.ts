import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createTestDb } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import { players } from "@research/db/schema";
import type { RealtimeEventType } from "@/lib/realtime/events";
import { createDraftStore } from "./store";
import { getTeamQueue, setTeamQueue } from "./queue";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "./test-support";

const db = createTestDb();
const clock = { now: () => "2026-09-01T00:00:00.000Z" };

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

async function fixture() {
  const f = await seedDraftFixture(db, {
    draftId: "draft_queue", leagueId: "league_queue", format: "snake", teamCount: 2,
    slotConfig: SPRINT_ROSTER_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
  });
  await db.insert(players).values([
    { id: "qb1", name: "QB One", position: "QB", nflTeam: "KC" },
    { id: "rb1", name: "RB One", position: "RB", nflTeam: "SF" },
    { id: "wr1", name: "WR One", position: "WR", nflTeam: "NYJ" },
    { id: "qb2", name: "QB Two", position: "QB", nflTeam: "KC" },
    { id: "rb2", name: "RB Two", position: "RB", nflTeam: "SF" },
    { id: "wr2", name: "WR Two", position: "WR", nflTeam: "NYJ" },
  ]);
  const published: RealtimeEventType[] = [];
  const store = createDraftStore({
    db,
    clock,
    publish: async ({ type }) => {
      published.push(type);
      return "1-0";
    },
  });
  return { ...f, store, published };
}

describe("setTeamQueue", () => {
  it("stores a queue before the draft has started and publishes draft.queue", async () => {
    const f = await fixture();
    const result = await setTeamQueue({ db, store: f.store, clock }, { draftId: f.draftId, teamId: f.teamIds[0]!, playerIds: ["rb1", "qb1"] });
    expect(result).toEqual({ ok: true, queue: ["rb1", "qb1"] });
    expect(f.published).toEqual(["draft.queue"]);
    expect(await getTeamQueue(f.store, f.draftId, f.teamIds[0]!)).toEqual(["rb1", "qb1"]);
  });

  it("keeps every other team's queue empty", async () => {
    const f = await fixture();
    await setTeamQueue({ db, store: f.store, clock }, { draftId: f.draftId, teamId: f.teamIds[0]!, playerIds: ["rb1"] });
    expect(await getTeamQueue(f.store, f.draftId, f.teamIds[1]!)).toEqual([]);
  });

  it("rejects a player id that isn't a real player, in plain language", async () => {
    const f = await fixture();
    const result = await setTeamQueue({ db, store: f.store, clock }, { draftId: f.draftId, teamId: f.teamIds[0]!, playerIds: ["rb1", "ghost"] });
    expect(result).toEqual({ ok: false, reason: "We couldn't find one of those players. Refresh and try again." });
    expect(f.published).toEqual([]);
  });

  it("passes the reducer's own reason straight through", async () => {
    const f = await fixture();
    const result = await setTeamQueue({ db, store: f.store, clock }, { draftId: f.draftId, teamId: f.teamIds[0]!, playerIds: ["rb1", "rb1"] });
    expect(result).toEqual({ ok: false, reason: "Each player may appear in your queue only once." });
  });

  it("survives a replay: the queue is rebuilt from the action log alone", async () => {
    const f = await fixture();
    await setTeamQueue({ db, store: f.store, clock }, { draftId: f.draftId, teamId: f.teamIds[0]!, playerIds: ["rb1", "qb1"] });
    f.store.invalidate(f.draftId);
    expect(await getTeamQueue(f.store, f.draftId, f.teamIds[0]!)).toEqual(["rb1", "qb1"]);
  });

  it("makes the clock autopick from the queue instead of the pool", async () => {
    const f = await fixture();
    // rb1 is not the pool's best player, so picking it proves the queue won.
    await setTeamQueue({ db, store: f.store, clock }, { draftId: f.draftId, teamId: f.teamIds[0]!, playerIds: ["rb1"] });
    await f.store.startDraft(f.draftId);
    const expired = await f.store.applyAction(f.draftId, { v: 1, type: "TIMER_EXPIRE", timestamp: "2026-09-20T00:00:00.000Z" });
    expect(expired.ok).toBe(true);
    const state = await f.store.getDraftState(f.draftId);
    expect(state?.picks[0]).toMatchObject({ teamId: f.teamIds[0]!, playerId: "rb1", auto: true });
  });

  it("clears a queue without touching the players table, since an empty queue names nobody to validate", async () => {
    const f = await fixture();
    await setTeamQueue({ db, store: f.store, clock }, { draftId: f.draftId, teamId: f.teamIds[0]!, playerIds: ["rb1"] });
    const result = await setTeamQueue({ db, store: f.store, clock }, { draftId: f.draftId, teamId: f.teamIds[0]!, playerIds: [] });
    expect(result).toEqual({ ok: true, queue: [] });
    expect(await getTeamQueue(f.store, f.draftId, f.teamIds[0]!)).toEqual([]);
  });

  it("returns null for a draft that doesn't exist", async () => {
    const f = await fixture();
    expect(await getTeamQueue(f.store, "nope", f.teamIds[0]!)).toBeNull();
  });
});
