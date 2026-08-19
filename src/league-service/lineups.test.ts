import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { lineupSlots, matchups } from "@/db/schema";
import type { ScoreCache } from "@/stats-pipeline/score-cache";
import { getLineup, isWeekLocked, lineupView, setLineup } from "./lineups";
import { SLOTS, twoTeamLeague, validSwap } from "./test-support";

/** A recording stand-in for the injected score cache, so a test can assert exactly what was invalidated. */
function recordingScoreCache(): Pick<ScoreCache, "invalidate"> & { invalidate: ReturnType<typeof vi.fn> } {
  return { invalidate: vi.fn(async () => {}) };
}

const db = createTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("setLineup", () => {
  it("saves a legal lineup for a week and reads it back", async () => {
    const league = await twoTeamLeague(db);
    const result = await setLineup(db, { leagueId: league.leagueId, teamId: league.teamId, weekNumber: 1, slots: validSwap });
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
    await setLineup(db, { leagueId: league.leagueId, teamId: league.teamId, weekNumber: 1, slots: validSwap });
    await setLineup(db, { leagueId: league.leagueId, teamId: league.teamId, weekNumber: 1, slots: validSwap });
    const rows = await db.select().from(lineupSlots).where(and(eq(lineupSlots.teamId, league.teamId), eq(lineupSlots.weekNumber, 1)));
    expect(rows).toHaveLength(4);
  });

  it("rejects a player in the wrong slot with validateLineup's own reason", async () => {
    const league = await twoTeamLeague(db);
    const result = await setLineup(db, {
      leagueId: league.leagueId, teamId: league.teamId, weekNumber: 1,
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
      leagueId: league.leagueId, teamId: league.teamId, weekNumber: 1,
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
        leagueId: league.leagueId, teamId: league.teamId, weekNumber: 1,
        slots: [{ slot: "QB", slotIndex: 0, playerId: "qb1" }, { slot: "RB", slotIndex: 0, playerId: "rb_other" }],
      }),
    ).toEqual({ ok: false, status: 422, reason: "One of those players isn't on your team." });

    expect(
      await setLineup(db, {
        leagueId: league.leagueId, teamId: league.teamId, weekNumber: 1,
        slots: [{ slot: "QB", slotIndex: 0, playerId: "qb1" }, { slot: "RB", slotIndex: 0, playerId: "rb1" }, { slot: "BENCH", slotIndex: 0, playerId: "rb1" }],
      }),
    ).toEqual({ ok: false, status: 422, reason: "You can only start a player in one spot." });
  });

  it("refuses a week that has already been scored", async () => {
    const league = await twoTeamLeague(db);
    await db
      .update(matchups)
      .set({ homeScore: 100, awayScore: 90 })
      .where(and(eq(matchups.leagueId, league.leagueId), eq(matchups.weekNumber, 1)));
    expect(await isWeekLocked(db, league.leagueId, 1)).toBe(true);
    expect(
      await setLineup(db, { leagueId: league.leagueId, teamId: league.teamId, weekNumber: 1, slots: validSwap }),
    ).toEqual({ ok: false, status: 409, reason: "Week 1 is final, so its lineup can't change." });
  });

  it("refuses a week the league doesn't have", async () => {
    const league = await twoTeamLeague(db);
    expect(
      await setLineup(db, { leagueId: league.leagueId, teamId: league.teamId, weekNumber: 9, slots: validSwap }),
    ).toEqual({ ok: false, status: 404, reason: "That week isn't part of this league's season." });
  });

  it("invalidates the score cache for this league and week after a successful save", async () => {
    const league = await twoTeamLeague(db);
    const cache = recordingScoreCache();
    const result = await setLineup(db, { leagueId: league.leagueId, teamId: league.teamId, weekNumber: 1, slots: validSwap }, cache);
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
        leagueId: league.leagueId, teamId: league.teamId, weekNumber: 1,
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
