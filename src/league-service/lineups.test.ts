import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { nflGames, statWeeks } from "@research-ts/db/schema";
import { auditEvents, leagues, lineupSlots, rosterSlots, teams, users } from "@/db/schema";
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
    ).toEqual({ ok: false, status: 422, reason: "One of those players is not on your team." });

    expect(
      await setLineup(db, {
        leagueId: league.leagueId, teamId: league.teamId, weekNumber: 1, userId: "u1",
        slots: [{ slot: "QB", slotIndex: 0, playerId: "qb1" }, { slot: "RB", slotIndex: 0, playerId: "rb1" }, { slot: "BENCH", slotIndex: 0, playerId: "rb1" }],
      }),
    ).toEqual({ ok: false, status: 422, reason: "You can only start a player in one spot." });
  });

  // PER-GAME LOCKS (roadmap item 2, 2026-08-30): an in-progress week no longer locks whole.
  // Each player locks at HIS kickoff — the following four cases pin the model's edges.
  it("accepts a mid-week swap between two players whose games have not started", async () => {
    const league = await twoTeamLeague(db, { weeks: 10 });
    await setWeekStatus(3, "in_progress");
    // No nfl_games rows for week 3: nobody has kicked off, so the swap is open.
    await expect(setLineup(db, validLineupInput(league, 3), undefined, { audit: logger, clock })).resolves.toMatchObject({ ok: true });
  });

  it("refuses to bench a starter whose game has started", async () => {
    const league = await twoTeamLeague(db, { weeks: 10 });
    await setWeekStatus(3, "in_progress");
    // qb1 (KC) starts and his game kicked off at noon ET; the test clock stands at 17:00Z.
    await db.insert(nflGames).values({ gameId: "t3kc", week: 3, homeNflTeam: "KC", awayNflTeam: "DEN", gameDate: "20260820", kickoffEt: "12:00p", status: "scheduled" });
    const result = await setLineup(db, validLineupInput(league, 3), undefined, { audit: logger, clock });
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(result.ok ? "" : result.reason).toBe("QB One's game has started, so he is locked in your lineup until the week ends.");
  });

  it("refuses to start a bench player whose game has already started", async () => {
    const league = await twoTeamLeague(db, { weeks: 10 });
    await setWeekStatus(3, "in_progress");
    // qb2 (SF) sits on the bench and his game kicked off; qb1's has not.
    await db.insert(nflGames).values({ gameId: "t3sf", week: 3, homeNflTeam: "SF", awayNflTeam: "SEA", gameDate: "20260820", kickoffEt: "12:00p", status: "scheduled" });
    const result = await setLineup(db, validLineupInput(league, 3), undefined, { audit: logger, clock });
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(result.ok ? "" : result.reason).toBe("QB Two's game has already started, so he cannot come off your bench this week.");
  });

  it("locks on the fixture's own status even when no kickoff time was published", async () => {
    const league = await twoTeamLeague(db, { weeks: 10 });
    await setWeekStatus(3, "in_progress");
    await db.insert(nflGames).values({ gameId: "t3kc2", week: 3, homeNflTeam: "KC", awayNflTeam: "DEN", gameDate: "", kickoffEt: "", status: "in_progress" });
    const result = await setLineup(db, validLineupInput(league, 3), undefined, { audit: logger, clock });
    expect(result).toMatchObject({ ok: false, status: 409 });
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

  it("locks a finished week whole — per-game granularity ends when the week does", async () => {
    const league = await twoTeamLeague(db, { weeks: 10 });
    await setWeekStatus(1, "final");
    expect(await isWeekLocked(db, 1)).toBe(true);
    expect(await setLineup(db, validLineupInput(league, 1))).toEqual({
      ok: false,
      status: 409,
      reason: "Week 1 has ended, so its lineup cannot change.",
    });
  });

  it("refuses a save whose week is flipped to FINAL after the up-front lock check passed", async () => {
    // The read-validate-write hole, retargeted by the per-game widening: the scheduled ->
    // in_progress flip no longer forbids a write (the per-slot diff guard rules by kickoff
    // clock, which cannot race the worker), so the boundary the FOR SHARE re-check defends is
    // now the flip to FINAL — the correction sweep settling a week under a late save.
    //
    // Driven for real, not simulated: a concurrent transaction updates the week's row and holds
    // it uncommitted, so the up-front check reads the still-committed `scheduled` value while the
    // re-check's `FOR SHARE` blocks on the uncommitted row and sees `final` once it lands.
    const league = await twoTeamLeague(db, { weeks: 10 });
    await setWeekStatus(2, "scheduled");

    let release: () => void = () => {};
    const flipped = new Promise<void>((resolve) => {
      release = resolve;
    });
    const flip = db.transaction(async (tx) => {
      await tx.update(statWeeks).set({ status: "final" }).where(eq(statWeeks.week, 2));
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
    await setWeekStatus(3, "final");
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

  it("refuses a league that doesn't exist", async () => {
    expect(
      await setLineup(db, { leagueId: "nope", teamId: "team_x", weekNumber: 1, slots: validSwap, userId: "u1" }),
    ).toEqual({ ok: false, status: 404, reason: "That league does not exist." });
  });

  it("refuses a week the league doesn't have", async () => {
    const league = await twoTeamLeague(db);
    expect(
      await setLineup(db, { leagueId: league.leagueId, teamId: league.teamId, weekNumber: 9, slots: validSwap, userId: "u1" }),
    ).toEqual({ ok: false, status: 404, reason: "That week is not part of this league's season." });
  });

  /**
   * `docs/decisions/audit-and-integrity.md`'s residual, closed: a team id from ANOTHER league,
   * driven through `setLineup` for THIS league's id, used to reach the roster/validation work
   * unchecked — safe only because the route derives both ids from the session actor rather than
   * from the request body. Task 4 (Step 5) is the next team-scoped writer, and adds the assertion
   * the residual asked for rather than copying the omission.
   */
  it("refuses a team that belongs to a different league", async () => {
    const league = await twoTeamLeague(db);
    await db.insert(users).values({ id: "u_other", email: "u_other@test.local", displayName: "Other" });
    await db.insert(leagues).values({ id: "league_other", name: "Other League", format: "snake", teamCount: 1, commissionerUserId: "u_other" });
    await db.insert(teams).values({ id: "team_other", leagueId: "league_other", userId: "u_other", name: "Other Team" });

    expect(
      await setLineup(db, { leagueId: league.leagueId, teamId: "team_other", weekNumber: 1, slots: validSwap, userId: "u1" }),
    ).toEqual({ ok: false, status: 404, reason: "That team is not part of this league." });
  });

  it("refuses a team id that doesn't exist at all", async () => {
    const league = await twoTeamLeague(db);
    expect(
      await setLineup(db, { leagueId: league.leagueId, teamId: "team_nope", weekNumber: 1, slots: validSwap, userId: "u1" }),
    ).toEqual({ ok: false, status: 404, reason: "That team is not part of this league." });
  });

  it("invalidates the score cache for this league and week after a successful save", async () => {
    const league = await twoTeamLeague(db);
    const cache = recordingScoreCache();
    const result = await setLineup(db, { leagueId: league.leagueId, teamId: league.teamId, weekNumber: 1, slots: validSwap, userId: "u1" }, cache);
    expect(result.ok).toBe(true);
    expect(cache.invalidate).toHaveBeenCalledTimes(1);
    expect(cache.invalidate).toHaveBeenCalledWith(league.leagueId, 1);
  });

  it("logs, but does not fail the save, when the cache invalidation itself throws", async () => {
    // The lineup is already committed by the time this runs — a Redis outage on the way out
    // must never undo an already-successful save.
    const league = await twoTeamLeague(db);
    const throwingCache: Pick<ScoreCache, "invalidate"> = {
      invalidate: async () => { throw new Error("redis down"); },
    };
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await setLineup(db, { leagueId: league.leagueId, teamId: league.teamId, weekNumber: 1, slots: validSwap, userId: "u1" }, throwingCache);
      expect(result.ok).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith(
        "[league-service] score cache invalidation failed",
        { leagueId: league.leagueId, weekNumber: 1 },
        expect.any(Error),
      );
    } finally {
      consoleSpy.mockRestore();
    }
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

  it("returns null for a league that doesn't exist", async () => {
    expect(await lineupView(db, { leagueId: "nope", teamId: "team_x", weekNumber: 1 })).toBeNull();
  });

  it("renders a null name and position for a roster slot's player id that isn't in the players table, and for a genuinely empty slot", async () => {
    // `roster_slots.player_id`/`lineup_slots.player_id` carry no foreign key to `players.id` —
    // unlike `player_stat_lines`, which cascades on delete — so a stale id here is real,
    // reachable data (e.g. a player pruned from a later reseed), not a defensive-only case. An
    // empty slot (`playerId: null`) is the other, ordinary way to reach the same fallback.
    const league = await twoTeamLeague(db);
    await db.update(rosterSlots).set({ playerId: "player_pruned" }).where(and(eq(rosterSlots.teamId, league.teamId), eq(rosterSlots.slot, "QB")));
    await db.update(rosterSlots).set({ playerId: null }).where(and(eq(rosterSlots.teamId, league.teamId), eq(rosterSlots.slot, "RB")));
    const view = await lineupView(db, { leagueId: league.leagueId, teamId: league.teamId, weekNumber: 1 });
    const qbSlot = view!.starters.find((s) => s.slot === "QB");
    expect(qbSlot).toMatchObject({ playerId: "player_pruned", playerName: null, position: null });
    const rbSlot = view!.starters.find((s) => s.slot === "RB");
    expect(rbSlot).toMatchObject({ playerId: null, playerName: null, position: null });
  });
});
