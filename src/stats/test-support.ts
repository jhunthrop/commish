import { describe, expect, it } from "vitest";
import type { Position, StatLine } from "@/domain/player";
import type { GameStatus, StatsProvider } from "./provider";

const POSITIONS: readonly Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

const GAME_STATUSES: readonly GameStatus[] = ["scheduled", "in_progress", "final"];

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
 * Yardage is the one family of stat fields real NFL data reports negative: a sack-for-loss, a
 * broken-up screen, a QB scramble that ends behind the line. Every other field is a count
 * (touchdowns, receptions, attempts, fumbles, sacks, interceptions) and a negative count is
 * always a parsing bug, never a real value — clamping yardage to non-negative would silently
 * score a real loss as a null play, which is the wrong kind of "safe."
 */
const YARDAGE_FIELDS: ReadonlySet<(typeof STAT_FIELDS)[number]> = new Set(["passingYards", "rushingYards", "receivingYards"]);

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

    it("lists at least one player at every position, DEF included", async () => {
      // A legal-but-incomplete position union passes the previous case even if an adapter drops
      // a whole position — DEF is the likeliest gap, since a real feed models it as a team
      // defense/special-teams unit rather than an individual athlete and an adapter has to
      // synthesize a Player row for it. This is the case that would catch that silently.
      const players = await (await factory()).listPlayers();
      const seen = new Set(players.map((player) => player.position));
      for (const position of POSITIONS) expect(seen).toContain(position);
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

    it("returns every stat field as a finite number, non-negative except for yardage", async () => {
      // Every implementation over a real feed parses strings into numbers, and the failure mode
      // is NaN silently reaching the scoring engine and turning a team's total into NaN. This is
      // the assertion that makes that a test failure instead of a Sunday. Yardage is exempted
      // from the non-negative half of this check — see YARDAGE_FIELDS — because real NFL data
      // reports it negative and a provider that clamped it would be wrong, not safe.
      const lines = await (await factory()).getWeeklyStatLines(1);
      for (const line of lines) {
        for (const field of STAT_FIELDS) {
          expect(Number.isFinite(line[field])).toBe(true);
          if (!YARDAGE_FIELDS.has(field)) expect(line[field]).toBeGreaterThanOrEqual(0);
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

    it("lists games for the week that was asked for, each with a known status and two teams", async () => {
      const games = await (await factory()).listGames(1);
      expect(games.length).toBeGreaterThan(0);
      for (const game of games) {
        expect(game.gameId).toMatch(/\S/);
        expect(game.week).toBe(1);
        expect(GAME_STATUSES).toContain(game.status);
        expect(game.homeNflTeam).toMatch(/\S/);
        expect(game.awayNflTeam).toMatch(/\S/);
        expect(game.homeNflTeam).not.toBe(game.awayNflTeam);
      }
    });

    it("never lists the same game id twice in one week", async () => {
      const games = await (await factory()).listGames(1);
      const ids = games.map((game) => game.gameId);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("answers a week outside the season with no games, the same way it answers with no stat lines", async () => {
      // `seedPlayers` terminates on an empty stat-line array and the ingestion worker terminates
      // on an empty game list. Two loops, one boundary — they must agree.
      const provider = await factory();
      await expect(provider.listGames(0)).resolves.toEqual([]);
      await expect(provider.listGames(99)).resolves.toEqual([]);
    });

    it("stamps a game's stat lines with that game's week", async () => {
      const provider = await factory();
      const [game] = await provider.listGames(1);
      expect(game).toBeDefined();
      const lines = await provider.getGameStatLines(game!);
      for (const line of lines) expect(line.week).toBe(1);
    });

    it("only reports a game's stats for players it lists, on one of that game's two teams", async () => {
      // The per-game read's own version of the listed-players rule, plus the assertion the
      // week-level read cannot make: a box score keyed to the wrong game would still pass the
      // week-level check and would silently attribute a player's points to the wrong fixture.
      const provider = await factory();
      const teamById = new Map((await provider.listPlayers()).map((player) => [player.id, player.nflTeam]));
      for (const game of await provider.listGames(1)) {
        for (const line of await provider.getGameStatLines(game)) {
          expect(teamById.has(line.playerId)).toBe(true);
          expect([game.homeNflTeam, game.awayNflTeam]).toContain(teamById.get(line.playerId));
        }
      }
    });

    it("returns the same week from the per-game reads as it does from the week read", async () => {
      // THE anti-drift device for this task. `getWeeklyStatLines` is what `seedPlayers` uses and
      // the per-game reads are what the ingestion worker uses; two independent expressions of
      // "week 1's stats" is exactly how a seeded season and a live season end up disagreeing.
      const provider = await factory();
      const games = await provider.listGames(1);
      const perGame = (await Promise.all(games.map((game) => provider.getGameStatLines(game)))).flat();
      const weekly = await provider.getWeeklyStatLines(1);
      const key = (line: StatLine): string => `${line.playerId}:${line.week}`;
      expect(new Set(perGame.map(key))).toEqual(new Set(weekly.map(key)));
      const byKey = new Map(perGame.map((line) => [key(line), line]));
      for (const line of weekly) expect(byKey.get(key(line))).toEqual(line);
    });

    it("returns a final game's stat lines identically on a second read", async () => {
      // The property the worker's request budget is built on: once a game is final its box score
      // is a fixed fact, so the worker fetches it once and never again. If this is ever false for
      // a provider, that provider must not be run in final-only mode.
      const provider = await factory();
      const finals = (await provider.listGames(1)).filter((game) => game.status === "final");
      expect(finals.length).toBeGreaterThan(0);
      const first = await provider.getGameStatLines(finals[0]!);
      const second = await provider.getGameStatLines(finals[0]!);
      expect(second).toEqual(first);
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
