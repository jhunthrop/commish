import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { auditEvents, lineupSlots, statWeeks } from "@/db/schema";
import type { WeekStatus } from "@/league";
import { createAuditLogger } from "@/integrity-service/audit-logger";
import type { ScoreCache } from "@/stats-pipeline/score-cache";
import { getLineup, isWeekLocked, lineupView, setLineup, type SetLineupInput } from "./lineups";
import { SLOTS, twoTeamLeague, validSwap } from "./test-support";

/** A recording stand-in for the injected score cache, so a test can assert exactly what was invalidated. */
function recordingScoreCache(): Pick<ScoreCache, "invalidate"> & { invalidate: ReturnType<typeof vi.fn> } {
  return { invalidate: vi.fn(async () => {}) };
}

const db = createTestDb();
const clock = { now: () => "2026-08-20T17:00:00.000Z" };
let counter = 0;
const logger = createAuditLogger({ newId: () => `evt_${(counter += 1)}` });

/** Writes (or overwrites) one week's `stat_weeks` row — the lock tests' only way to move a week off `scheduled`. */
async function setWeekStatus(week: number, status: WeekStatus): Promise<void> {
  await db.insert(statWeeks).values({ week, status }).onConflictDoUpdate({ target: statWeeks.week, set: { status } });
}

/** A legal lineup swap for the named week, on the caller's own team in `league` — always the commissioner, "u1" (`twoTeamLeague`). */
function validLineupInput(league: { readonly leagueId: string; readonly teamId: string }, weekNumber: number): SetLineupInput {
  return { leagueId: league.leagueId, teamId: league.teamId, weekNumber, slots: validSwap, userId: "u1" };
}

beforeEach(async () => {
  await truncateAll(db);
  counter = 0;
});

afterAll(async () => {
  await truncateAll(db);
});

describe("setLineup", () => {
  it("saves a legal lineup for a week and reads it back", async () => {
    const league = await twoTeamLeague(db);
    const result = await setLineup(db, { leagueId: league.leagueId, teamId: league.teamId, weekNumber: 1, slots: validSwap, userId: "u1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lineup.starters.map((s) => s.playerId)).toEqual(["qb2", "rb1"]);
    expect(result.lineup.locked).toBe(false);

    const saved = await getLineup(db, { teamId: league.teamId, weekNumber: 1, slotConfig: SLOTS });
    expect(saved.find((s) => s.slot === "QB")!.playerId).toBe("qb2");
    // Week 2 is untouched — a lineup is week-scoped.
    const other = await getLineup(db, { teamId: league.teamId, weekNumber: 2, slotConfig: SLOTS });
    expect(other.find((s) => s.slot === "QB")!.playerId).toBe("qb1");
  });

  it("replaces the previous save rather than accumulating rows", async () => {
    const league = await twoTeamLeague(db);
    await setLineup(db, { leagueId: league.leagueId, teamId: league.teamId, weekNumber: 1, slots: validSwap, userId: "u1" });
    await setLineup(db, { leagueId: league.leagueId, teamId: league.teamId, weekNumber: 1, slots: validSwap, userId: "u1" });
    const rows = await db.select().from(lineupSlots).where(and(eq(lineupSlots.teamId, league.teamId), eq(lineupSlots.weekNumber, 1)));
    expect(rows).toHaveLength(4);
  });

  it("rejects a player in the wrong slot with validateLineup's own reason", async () => {
    const league = await twoTeamLeague(db);
    const result = await setLineup(db, {
      leagueId: league.leagueId, teamId: league.teamId, weekNumber: 1, userId: "u1",
      slots: [
        { slot: "QB", slotIndex: 0, playerId: "rb1" },
        { slot: "RB", slotIndex: 0, playerId: "qb1" },
        { slot: "BENCH", slotIndex: 0, playerId: "qb2" },
        { slot: "BENCH", slotIndex: 1, playerId: "rb2" },
      ],
    });
    expect(result).toEqual({ ok: false, status: 422, reason: "RB is not eligible for the QB slot." });
  });

  it("rejects an empty starting slot", async () => {
    const league = await twoTeamLeague(db);
    const result = await setLineup(db, {
      leagueId: league.leagueId, teamId: league.teamId, weekNumber: 1, userId: "u1",
      slots: [
        { slot: "QB", slotIndex: 0, playerId: null },
        { slot: "RB", slotIndex: 0, playerId: "rb1" },
      ],
    });
    expect(result).toEqual({ ok: false, status: 422, reason: "The QB slot is empty." });
  });

  it("rejects a player who isn't on this team, and a player used twice", async () => {
    const league = await twoTeamLeague(db);
    expect(
      await setLineup(db, {
        leagueId: league.leagueId, teamId: league.teamId, weekNumber: 1, userId: "u1",
        slots: [{ slot: "QB", slotIndex: 0, playerId: "qb1" }, { slot: "RB", slotIndex: 0, playerId: "rb_other" }],
      }),
    ).toEqual({ ok: false, status: 422, reason: "One of those players isn't on your team." });

    expect(
      await setLineup(db, {
        leagueId: league.leagueId, teamId: league.teamId, weekNumber: 1, userId: "u1",
        slots: [{ slot: "QB", slotIndex: 0, playerId: "qb1" }, { slot: "RB", slotIndex: 0, playerId: "rb1" }, { slot: "BENCH", slotIndex: 0, playerId: "rb1" }],
      }),
    ).toEqual({ ok: false, status: 422, reason: "You can only start a player in one spot." });
  });

  it("locks a week the moment its first game kicks off, not when it finishes", async () => {
    const league = await twoTeamLeague(db, { weeks: 10 });
    await setWeekStatus(3, "in_progress");
    expect(await isWeekLocked(db, 3)).toBe(true);
    const result = await setLineup(db, validLineupInput(league, 3));
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(result.ok ? "" : result.reason).toBe("Week 3 has started, so its lineup can't change.");
  });

  it("leaves a week open while it is still scheduled", async () => {
    const league = await twoTeamLeague(db, { weeks: 10 });
    await setWeekStatus(4, "scheduled");
    await expect(setLineup(db, validLineupInput(league, 4))).resolves.toMatchObject({ ok: true });
  });

  it("treats a week with no stat_weeks row at all as open", async () => {
    // A week the ingestion worker has never reached is a week whose games have not been listed,
    // which is not the same as a week in progress. Locking on absence would freeze every
    // league's lineups the first time the worker was down.
    const league = await twoTeamLeague(db, { weeks: 10 });
    await expect(setLineup(db, validLineupInput(league, 9))).resolves.toMatchObject({ ok: true });
  });

  it("locks a week that has finished, the same as one still in progress", async () => {
    const league = await twoTeamLeague(db, { weeks: 10 });
    await setWeekStatus(1, "final");
    expect(await isWeekLocked(db, 1)).toBe(true);
    expect(await setLineup(db, validLineupInput(league, 1))).toEqual({
      ok: false,
      status: 409,
      reason: "Week 1 has started, so its lineup can't change.",
    });
  });

  it("refuses a save whose week is flipped to in_progress after the up-front lock check passed", async () => {
    // The read-validate-write hole: the up-front `isWeekLocked` read is followed by four more
    // round trips (roster, players, validation) before the upsert, and the ingestion worker flips
    // the week inside `persistTick`'s own transaction with no coordination. A lineup submitted in
    // that window used to be accepted after kickoff — a manager watching a running back get hurt
    // at 1:15pm and swapping him out at 1:16.
    //
    // Driven for real, not simulated: a concurrent transaction updates the week's row and holds
    // it uncommitted, so the up-front check reads the still-committed `scheduled` value while the
    // re-check's `FOR SHARE` blocks on the uncommitted row and sees `in_progress` once it lands.
    const league = await twoTeamLeague(db, { weeks: 10 });
    await setWeekStatus(2, "scheduled");

    let release: () => void = () => {};
    const flipped = new Promise<void>((resolve) => {
      release = resolve;
    });
    const flip = db.transaction(async (tx) => {
      await tx.update(statWeeks).set({ status: "in_progress" }).where(eq(statWeeks.week, 2));
      await flipped;
    });

    const saving = setLineup(db, validLineupInput(league, 2), undefined, { audit: logger, clock });
    // Long enough for `setLineup` to clear its up-front check and reach the locking read.
    await new Promise((resolve) => setTimeout(resolve, 150));
    release();
    await flip;

    expect(await saving).toMatchObject({ ok: false, status: 409 });
    const saved = await db.select().from(lineupSlots).where(eq(lineupSlots.teamId, league.teamId));
    expect(saved.filter((row) => row.weekNumber === 2)).toHaveLength(0);
    // `setLineup` checks the lock twice; the second check is inside the transaction. An audit
    // event written before that check would record a lineup change that never happened.
    // (Filtered to `lineup_change`: `twoTeamLeague` itself writes a `league_created` event via
    // the process-wide logger when it calls `createLeague`, so the table is never actually empty.)
    expect(await db.select().from(auditEvents).where(eq(auditEvents.eventType, "lineup_change"))).toHaveLength(0);
  });

  it("records nothing when the week is locked up front and the write is refused", async () => {
    const league = await twoTeamLeague(db, { weeks: 10 });
    await setWeekStatus(3, "in_progress");
    const result = await setLineup(db, validLineupInput(league, 3), undefined, { audit: logger, clock });
    expect(result.ok).toBe(false);
    expect(await db.select().from(auditEvents).where(eq(auditEvents.eventType, "lineup_change"))).toHaveLength(0);
  });

  it("records the lineup change inside the same transaction that holds the week's share lock", async () => {
    const league = await twoTeamLeague(db);
    const result = await setLineup(db, validLineupInput(league, 1), undefined, { audit: logger, clock });
    expect(result.ok).toBe(true);

    const rows = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "lineup_change"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ chainScope: league.leagueId, actorId: "u1", actorType: "user", leagueId: league.leagueId });
    expect(rows[0]!.payload).toEqual({
      teamId: league.teamId,
      weekNumber: 1,
      starters: [
        { slot: "QB", slotIndex: 0, playerId: "qb2" },
        { slot: "RB", slotIndex: 0, playerId: "rb1" },
      ],
    });
    expect(rows[0]!.occurredAt.toISOString()).toBe(clock.now());
  });

  it("rolls back the lineup write when the audit append fails — ruling 4, the opposite of publishing", async () => {
    const league = await twoTeamLeague(db);
    const brokenAudit = { ...logger, record: async () => { throw new Error("audit append failed"); } };
    await expect(setLineup(db, validLineupInput(league, 1), undefined, { audit: brokenAudit, clock })).rejects.toThrow("audit append failed");

    const saved = await db.select().from(lineupSlots).where(eq(lineupSlots.teamId, league.teamId));
    expect(saved.filter((row) => row.weekNumber === 1)).toHaveLength(0);
  });

  it("refuses a week the league doesn't have", async () => {
    const league = await twoTeamLeague(db);
    expect(
      await setLineup(db, { leagueId: league.leagueId, teamId: league.teamId, weekNumber: 9, slots: validSwap, userId: "u1" }),
    ).toEqual({ ok: false, status: 404, reason: "That week isn't part of this league's season." });
  });

  it("invalidates the score cache for this league and week after a successful save", async () => {
    const league = await twoTeamLeague(db);
    const cache = recordingScoreCache();
    const result = await setLineup(db, { leagueId: league.leagueId, teamId: league.teamId, weekNumber: 1, slots: validSwap, userId: "u1" }, cache);
    expect(result.ok).toBe(true);
    expect(cache.invalidate).toHaveBeenCalledTimes(1);
    expect(cache.invalidate).toHaveBeenCalledWith(league.leagueId, 1);
  });

  it("does not invalidate the score cache when the save is rejected", async () => {
    const league = await twoTeamLeague(db);
    const cache = recordingScoreCache();
    const result = await setLineup(
      db,
      {
        leagueId: league.leagueId, teamId: league.teamId, weekNumber: 1, userId: "u1",
        slots: [
          { slot: "QB", slotIndex: 0, playerId: null },
          { slot: "RB", slotIndex: 0, playerId: "rb1" },
        ],
      },
      cache,
    );
    expect(result.ok).toBe(false);
    expect(cache.invalidate).not.toHaveBeenCalled();
  });
});

describe("lineupView", () => {
  it("returns the drafted default with names and positions for a week nobody has edited", async () => {
    const league = await twoTeamLeague(db);
    const view = await lineupView(db, { leagueId: league.leagueId, teamId: league.teamId, weekNumber: 1 });
    expect(view!.starters.map((s) => s.playerName)).toEqual(["QB One", "RB One"]);
    expect(view!.bench.map((s) => s.playerId)).toEqual(["qb2", "rb2"]);
    expect(view!.locked).toBe(false);
  });
});
