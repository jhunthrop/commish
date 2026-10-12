import { describe, it, expect } from "vitest";
import type { Player, StatLine } from "@research-ts/domain/player";
import { PPR_SCORING } from "@research-ts/domain/scoring";
import { computeFantasyPoints } from "@research-ts/scoring";
import { createMockStatsProvider } from "./mock-stats-provider";
import { PLAYER_COUNT, type Dataset } from "./generate-dataset";
import { describeStatsProviderContract } from "../test-support";

function player(id: string, nflTeam: string): Player {
  return { id, name: id, position: "WR", nflTeam, headshotUrl: null, adp: null };
}

function line(playerId: string, week: number): StatLine {
  return {
    playerId,
    week,
    passingYards: 0,
    passingTouchdowns: 0,
    interceptions: 0,
    rushingYards: 0,
    rushingTouchdowns: 0,
    receivingYards: 0,
    receivingTouchdowns: 0,
    receptions: 0,
    fumblesLost: 0,
    fieldGoalsMade: 0,
    extraPointsMade: 0,
    sacks: 0,
    defensiveInterceptions: 0,
    defensiveTouchdowns: 0,
  };
}

describeStatsProviderContract("MockStatsProvider", () => createMockStatsProvider());

describe("MockStatsProvider", () => {
  const provider = createMockStatsProvider();

  it("lists every player", async () => {
    expect(await provider.listPlayers()).toHaveLength(PLAYER_COUNT);
  });
  it("returns one stat line per player for a valid week", async () => {
    const lines = await provider.getWeeklyStatLines(3);
    expect(lines).toHaveLength(PLAYER_COUNT);
    expect(lines.every((l) => l.week === 3)).toBe(true);
  });
  it("returns an empty list for a week outside the season", async () => {
    expect(await provider.getWeeklyStatLines(18)).toEqual([]);
    expect(await provider.getWeeklyStatLines(0)).toEqual([]);
  });

  it("derives an even number of games from the committed dataset, covering all 32 teams, so no player's stat line is dropped", async () => {
    // getWeeklyStatLines now composes over deriveMockGames, which drops an odd-one-out team.
    // The committed dataset covers all 32 NFL teams every week (verified above: PLAYER_COUNT
    // lines survive for week 3 with no drop), so that filter is a no-op here. This pins the
    // team/game counts so a future dataset regeneration that broke the even split would fail
    // loudly instead of silently dropping players from the seed.
    const games = await provider.listGames(3);
    expect(games).toHaveLength(16);
    const teams = new Set(games.flatMap((game) => [game.homeNflTeam, game.awayNflTeam]));
    expect(teams.size).toBe(32);
  });

  it("treats every week as final by default, keeping Plan A's behavior byte-identical", async () => {
    const games = await provider.listGames(3);
    expect(games.every((game) => game.status === "final")).toBe(true);
  });

  it("treats the configured live week as in_progress and every other week as final", async () => {
    const live = createMockStatsProvider(undefined, { liveWeek: 3 });
    const liveGames = await live.listGames(3);
    expect(liveGames.length).toBeGreaterThan(0);
    expect(liveGames.every((game) => game.status === "in_progress")).toBe(true);
    const otherGames = await live.listGames(4);
    expect(otherGames.length).toBeGreaterThan(0);
    expect(otherGames.every((game) => game.status === "final")).toBe(true);
  });
});

describe("MockStatsProvider ADP", () => {
  const provider = createMockStatsProvider();

  it("is deterministic: two independently built providers agree entry for entry", async () => {
    // The contract suite deliberately does not assert determinism (it is false of a live feed),
    // so it lives here, where it is a real property: mock-mode tests and dev seeds must produce
    // the same draft board on every run.
    const first = await createMockStatsProvider().listAdp();
    const second = await createMockStatsProvider().listAdp();
    expect(second).toEqual(first);
  });

  it("ranks every dataset player exactly once, ADP 1..N", async () => {
    const entries = await provider.listAdp();
    expect(entries).toHaveLength(PLAYER_COUNT);
    expect(new Set(entries.map((entry) => entry.playerId)).size).toBe(PLAYER_COUNT);
    expect([...entries.map((entry) => entry.adp)].sort((a, b) => a - b)).toEqual(
      Array.from({ length: PLAYER_COUNT }, (_, index) => index + 1),
    );
  });

  it("orders by PPR season total, best first — the same market meaning a real feed carries", async () => {
    const players = await provider.listPlayers();
    const positionById = new Map(players.map((p) => [p.id, p.position]));
    const totals = new Map<string, number>();
    for (let week = 1; week <= provider.lastWeekOfSeason; week++) {
      for (const statLine of await provider.getWeeklyStatLines(week)) {
        totals.set(
          statLine.playerId,
          (totals.get(statLine.playerId) ?? 0) + computeFantasyPoints(statLine, positionById.get(statLine.playerId)!, PPR_SCORING),
        );
      }
    }
    const entries = [...(await provider.listAdp())].sort((a, b) => a.adp - b.adp);
    for (let i = 1; i < entries.length; i++) {
      expect(totals.get(entries[i - 1]!.playerId) ?? 0).toBeGreaterThanOrEqual(totals.get(entries[i]!.playerId) ?? 0);
    }
  });

  it("breaks a total tie by id and skips a stat line for an unlisted player, over a hand-rolled dataset", async () => {
    // Two players with identical (zero) totals — the ghost line ranks nobody, so both players
    // tie and the id decides, keeping the order total the same way rankedPlayers' own
    // tie-break does.
    const dataset: Dataset = { players: [player("b_tied", "SF"), player("a_tied", "SEA")], statLines: [line("ghost", 1)] };
    const entries = await createMockStatsProvider(dataset).listAdp();
    expect(entries).toEqual([
      { playerId: "a_tied", adp: 1 },
      { playerId: "b_tied", adp: 2 },
    ]);
  });
});

describe("MockStatsProvider with a hand-rolled dataset carrying a stat line for an unlisted player", () => {
  // A stat line whose playerId isn't in the dataset's own player list can't happen from
  // generate-dataset.ts, but nothing in a Dataset's shape forbids it, and `deriveMockGames`
  // already drops such a line when building the week's fixtures. This proves the provider's own
  // team lookups agree with that drop instead of throwing or silently keying off "".
  const dataset: Dataset = {
    players: [player("home", "SEA"), player("away", "SF")],
    statLines: [line("home", 1), line("away", 1), line("ghost", 1)],
  };
  const provider = createMockStatsProvider(dataset);

  it("excludes the unlisted player's line from a game's stat lines", async () => {
    const [game] = await provider.listGames(1);
    expect(game).toBeDefined();
    const lines = await provider.getGameStatLines(game!);
    expect(lines.map((l) => l.playerId).sort()).toEqual(["away", "home"]);
  });

  it("excludes the unlisted player's line from the week's stat lines", async () => {
    const lines = await provider.getWeeklyStatLines(1);
    expect(lines.map((l) => l.playerId).sort()).toEqual(["away", "home"]);
  });
});
