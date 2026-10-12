import { describe, expect, it } from "vitest";
import { STAT_FIELDS } from "@research/domain/player";
import type { Position, StatLine } from "@research/domain/player";
import type { GameStatus, StatsProvider } from "./provider";

const POSITIONS: readonly Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

const GAME_STATUSES: readonly GameStatus[] = ["scheduled", "in_progress", "final"];

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

    it("names the last week of its own season, answers it with games, and answers the week after it with none", async () => {
      // The ingestion worker clamps its forward-advancing week pointer to this number. Both halves
      // matter and each fails differently. A provider that OVERSHOOTS leaves the pointer stalled on
      // a week that can never get a `stat_weeks` row, spending a listing request every tick forever
      // — exactly what a pipeline-level constant of 18 did to the 17-week mock dataset. A provider
      // that UNDERSHOOTS silently drops the last week of its own season from the product.
      const provider = await factory();
      expect(Number.isInteger(provider.lastWeekOfSeason)).toBe(true);
      expect(provider.lastWeekOfSeason).toBeGreaterThan(0);
      expect((await provider.listGames(provider.lastWeekOfSeason)).length).toBeGreaterThan(0);
      await expect(provider.listGames(provider.lastWeekOfSeason + 1)).resolves.toEqual([]);
    });

    it("says whether its calls cost anything upstream", async () => {
      // Read by the edge (`src/stats-pipeline/index.ts`) to decide whether the monthly request
      // ledger counts this provider at all. A wrong answer is expensive in one direction (a metered
      // provider spending uncounted against a real key) and quietly confusing in the other (a free
      // provider exhausting a ceiling with requests nothing ever made).
      expect(["free", "metered"]).toContain((await factory()).requestCost);
    });

    it("lists the same game ids on a second call for the same week", async () => {
      // `final-only` keys its fetch-once marker on `gameId` (`stats:game:<id>:final`). An id that
      // changes between calls turns fetch-once into fetch-forever: every tick sees an unmarked
      // game, re-fetches its box score, and the monthly budget goes with it.
      const provider = await factory();
      const first = await provider.listGames(1);
      const second = await provider.listGames(1);
      expect(second.map((game) => game.gameId)).toEqual(first.map((game) => game.gameId));
    });

    it("never reports the same player twice across the union of a week's per-game reads", async () => {
      // The week-level uniqueness case below asserts this through `getWeeklyStatLines`, and the
      // per-game/week agreement case compares SETS, which collapse duplicates — so neither one
      // states the property the ingestion worker actually depends on. A player appearing in two of
      // a week's box scores repeats a `(player_id, week)` conflict key inside one multi-row upsert,
      // and Postgres rejects that statement whole (`21000`), failing the entire tick.
      const provider = await factory();
      const perGame = (await Promise.all((await provider.listGames(1)).map((game) => provider.getGameStatLines(game)))).flat();
      const ids = perGame.map((line) => line.playerId);
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

    it("ranks at least one player by ADP, every value positive and finite", async () => {
      // The draft pool leads with ADP order (`rankedPlayers`), so a provider whose ADP feed maps
      // to nothing would silently demote EVERY player to the projection-ordered tail — the exact
      // "demo players outrank real NFL players" failure this arm of the seam exists to end. The
      // positive-and-finite half is the same NaN discipline the stat-line case above enforces: a
      // string that fails to parse must be dropped, never emitted as 0 or NaN, because
      // `rankedPlayers` sorts by this number.
      const entries = await (await factory()).listAdp();
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(Number.isFinite(entry.adp)).toBe(true);
        expect(entry.adp).toBeGreaterThan(0);
      }
    });

    it("lists ADP only for players it also lists", async () => {
      // Same law as the stat-line cases: `ingestAdp` writes `players.adp` by id, so an ADP keyed
      // to an unlisted id can never land on a row — it would be quietly dropped at ingestion,
      // which is a provider bug hiding behind a database no-op.
      const provider = await factory();
      const listed = new Set((await provider.listPlayers()).map((player) => player.id));
      for (const entry of await provider.listAdp()) {
        expect(listed.has(entry.playerId)).toBe(true);
      }
    });

    it("never lists the same player twice in its ADP", async () => {
      // One player, one market position. A duplicate makes the ingested value order-dependent —
      // whichever entry the upsert applies last wins — which is nondeterminism dressed as data.
      const entries = await (await factory()).listAdp();
      const ids = entries.map((entry) => entry.playerId);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
}
