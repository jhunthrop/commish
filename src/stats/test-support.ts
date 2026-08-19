import { describe, expect, it } from "vitest";
import type { Position } from "@/domain/player";
import type { StatsProvider } from "./provider";

const POSITIONS: readonly Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

const STAT_FIELDS = [
  "passingYards",
  "passingTouchdowns",
  "interceptions",
  "rushingYards",
  "rushingTouchdowns",
  "receivingYards",
  "receivingTouchdowns",
  "receptions",
  "fumblesLost",
  "fieldGoalsMade",
  "extraPointsMade",
  "sacks",
  "defensiveInterceptions",
  "defensiveTouchdowns",
] as const;

/**
 * The contract EVERY `StatsProvider` implementation must satisfy, written against the interface
 * and never against an implementation's internals — so a future licensed feed is verified by
 * this same suite unchanged rather than by a second suite that agrees with it by coincidence.
 *
 * It asserts SHAPE and INVARIANTS, not values. Determinism is deliberately not asserted here: it
 * is true of the mock and false of any live feed, so it belongs in the mock's own test where it
 * is a real property, not in a contract a live provider would have to fail.
 */
export function describeStatsProviderContract(label: string, factory: () => StatsProvider | Promise<StatsProvider>): void {
  describe(`${label} satisfies the StatsProvider contract`, () => {
    it("lists players with a stable id, a real name, a known position and an NFL team", async () => {
      const players = await (await factory()).listPlayers();
      expect(players.length).toBeGreaterThan(0);
      for (const player of players) {
        expect(player.id).toMatch(/\S/);
        expect(player.name).toMatch(/\S/);
        expect(POSITIONS).toContain(player.position);
        expect(player.nflTeam).toMatch(/\S/);
      }
    });

    it("never lists the same player id twice", async () => {
      const players = await (await factory()).listPlayers();
      const ids = players.map((player) => player.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("returns stat lines stamped with the week that was asked for", async () => {
      const lines = await (await factory()).getWeeklyStatLines(1);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(line.week).toBe(1);
    });

    it("returns every stat field as a finite, non-negative number", async () => {
      // Every implementation over a real feed parses strings into numbers, and the failure mode
      // is NaN silently reaching the scoring engine and turning a team's total into NaN. This is
      // the assertion that makes that a test failure instead of a Sunday.
      const lines = await (await factory()).getWeeklyStatLines(1);
      for (const line of lines) {
        for (const field of STAT_FIELDS) {
          expect(Number.isFinite(line[field])).toBe(true);
          expect(line[field]).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it("only reports stats for players it also lists", async () => {
      const provider = await factory();
      const listed = new Set((await provider.listPlayers()).map((player) => player.id));
      for (const line of await provider.getWeeklyStatLines(1)) {
        expect(listed.has(line.playerId)).toBe(true);
      }
    });

    it("never reports the same player twice in one week", async () => {
      const lines = await (await factory()).getWeeklyStatLines(1);
      const ids = lines.map((line) => line.playerId);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("answers a week outside the season with an empty list rather than an error", async () => {
      // `seedPlayers` walks weeks upward until it gets an empty array, so this is not a
      // nicety — it is the loop's termination condition.
      const provider = await factory();
      await expect(provider.getWeeklyStatLines(0)).resolves.toEqual([]);
      await expect(provider.getWeeklyStatLines(99)).resolves.toEqual([]);
    });
  });
}
