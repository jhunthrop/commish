import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@research/db/test-db";
import { nflPlayers } from "@research/db/schema";
import { PPR_SCORING } from "@research/domain/scoring";
import { STAT_FIELDS, type Position, type StatLine } from "@research/domain/player";
import { replay, type ProjectionInput, type ProjectionSource } from "./backtest";
import { INJURY_METRICS, INJURY_SOURCE, REPORT_STATUS } from "./news/retrieve";
import { recordPlayerTeams } from "./team-store";
import { naiveProjection, NAIVE_SOURCE_NAME } from "./benchmarks/naive";
import type { SeasonStatLine } from "./lines";
import { statLineObservations } from "./nflverse/stat-lines";
import { recordObservations } from "./store";

const db = createTestDb();

/** Week W is replayed knowing everything stamped up to the Thursday before its games. */
const REPLAY_MOMENT: Readonly<Record<number, Date>> = {
  1: new Date("2024-09-05T00:00:00.000Z"),
  2: new Date("2024-09-12T00:00:00.000Z"),
  3: new Date("2024-09-19T00:00:00.000Z"),
};
const asOfForWeek = (week: number) => REPLAY_MOMENT[week]!;

/** When each week's own results became knowable — always after that week's replay moment. */
const RESULTS_KNOWN: Readonly<Record<number, Date>> = {
  1: new Date("2024-09-10T00:00:00.000Z"),
  2: new Date("2024-09-17T00:00:00.000Z"),
  3: new Date("2024-09-24T00:00:00.000Z"),
};

const ROSTER: readonly (readonly [string, Position])[] = [
  ["star", "WR"],
  ["starter", "RB"],
  ["deep", "WR"],
  ["rookie", "TE"],
];

function line(season: number, week: number, playerId: string, over: Partial<StatLine>, asOf: Date): SeasonStatLine {
  return {
    season,
    asOf,
    line: {
      playerId,
      week,
      ...(Object.fromEntries(STAT_FIELDS.map((field) => [field, 0])) as Omit<StatLine, "playerId" | "week">),
      ...over,
    },
  };
}

async function store(lines: readonly SeasonStatLine[]): Promise<void> {
  await recordObservations(db, statLineObservations(lines));
}

const PRIOR_SEASON_STAMP = new Date("2024-01-15T00:00:00.000Z");

beforeEach(async () => {
  await truncateAll(db);
  // Positions come from the HISTORICAL universe, so that a replay of a season whose players have
  // since retired scores them rather than silently dropping them.
  await db.insert(nflPlayers).values(
    ROSTER.map(([id, position]) => ({ id, pfrId: id, name: id, position, latestTeam: "KC", rookieSeason: 2020, lastSeason: 2024 })),
  );
  // 2023: what the naive benchmark projects from. The ordering it will predict is
  // star > starter > deep, and `rookie` has no prior season at all.
  await store([
    line(2023, 1, "star", { receptions: 10, receivingYards: 140 }, PRIOR_SEASON_STAMP),
    line(2023, 2, "star", { receptions: 8, receivingYards: 100 }, PRIOR_SEASON_STAMP),
    line(2023, 1, "starter", { rushingYards: 90, receptions: 3 }, PRIOR_SEASON_STAMP),
    line(2023, 2, "starter", { rushingYards: 70, receptions: 1 }, PRIOR_SEASON_STAMP),
    line(2023, 1, "deep", { receptions: 2, receivingYards: 20 }, PRIOR_SEASON_STAMP),
    line(2023, 2, "deep", { receptions: 1, receivingYards: 9 }, PRIOR_SEASON_STAMP),
  ]);
  // 2024: what actually happened, each week stamped when it became knowable.
  for (const week of [1, 2, 3]) {
    await store([
      line(2024, week, "star", { receptions: 9, receivingYards: 120 }, RESULTS_KNOWN[week]!),
      line(2024, week, "starter", { rushingYards: 80, receptions: 2 }, RESULTS_KNOWN[week]!),
      line(2024, week, "deep", { receptions: 2, receivingYards: 15 }, RESULTS_KNOWN[week]!),
      line(2024, week, "rookie", { receptions: 4, receivingYards: 45 }, RESULTS_KNOWN[week]!),
    ]);
  }
});

afterAll(async () => {
  await truncateAll(db);
});

/** A source that records what it was shown and answers whatever it is told to. */
function spySource(answer: (input: ProjectionInput) => readonly StatLine[] = () => []) {
  const seen: ProjectionInput[] = [];
  const source: ProjectionSource = {
    name: "spy",
    project(input) {
      seen.push(input);
      return answer(input);
    },
  };
  return { source, seen };
}

const naiveSource: ProjectionSource = {
  name: NAIVE_SOURCE_NAME,
  project: ({ history, season, week }) => naiveProjection(history, { season, week }),
};

describe("replay cannot see the future — the reason this whole phase exists", () => {
  it("never shows a source a result stamped after the week's replay moment", async () => {
    const { source, seen } = spySource();

    await replay(db, { season: 2024, weeks: [2, 3], source, rules: PPR_SCORING, asOfForWeek });

    for (const input of seen) {
      for (const { season, line: shown, asOf } of input.history) {
        expect(asOf.getTime()).toBeLessThanOrEqual(input.asOf.getTime());
        // The sharper claim: nothing about the week being projected, nor any week after it.
        if (season === input.season) expect(shown.week).toBeLessThan(input.week);
      }
    }
  });

  it("does not leak a late-arriving stat correction backwards into an earlier replay", async () => {
    // A correction to week 1 published in week 3 must be invisible to the week-2 replay, and
    // visible to the week-3 one. This is the whole reason a restatement is a new row.
    // Published on the 18th: after week 2 was replayed (the 12th), before week 3 was (the 19th).
    await store([line(2024, 1, "deep", { receptions: 99 }, new Date("2024-09-18T00:00:00.000Z"))]);
    const { source, seen } = spySource();

    await replay(db, { season: 2024, weeks: [2, 3], source, rules: PPR_SCORING, asOfForWeek });

    const receptionsSeenIn = (week: number) =>
      seen
        .find((input) => input.week === week)!
        .history.find((row) => row.season === 2024 && row.line.playerId === "deep" && row.line.week === 1)!.line.receptions;
    expect(receptionsSeenIn(2)).toBe(2);
    expect(receptionsSeenIn(3)).toBe(99);
  });

  it("shows a source the prior season it is entitled to", async () => {
    const { source, seen } = spySource();
    await replay(db, { season: 2024, weeks: [2], source, rules: PPR_SCORING, asOfForWeek });
    expect(seen[0]!.history.some((row) => row.season === 2023)).toBe(true);
  });

  it("honours a narrower history window", async () => {
    const { source, seen } = spySource();
    await replay(db, { season: 2024, weeks: [2], source, rules: PPR_SCORING, asOfForWeek, historySeasons: 1 });
    expect(seen[0]!.history.every((row) => row.season === 2024)).toBe(true);
  });
});

describe("replay scoring", () => {
  it("scores each replayed week and names the source", async () => {
    const result = await replay(db, { season: 2024, weeks: [2, 3], source: naiveSource, rules: PPR_SCORING, asOfForWeek });

    expect(result.source).toBe(NAIVE_SOURCE_NAME);
    expect(result.weeks.map((week) => week.week)).toEqual([2, 3]);
    expect(result.weeks[0]!.asOf).toEqual(REPLAY_MOMENT[2]);
  });

  it("gets the ordering right when the projection has it right", async () => {
    // star > starter > deep in both the prior season and the actuals, so the naive floor should
    // order them perfectly. Rank correlation is the metric that decides whether a change ships.
    const result = await replay(db, { season: 2024, weeks: [2], source: naiveSource, rules: PPR_SCORING, asOfForWeek });
    expect(result.overall.rankCorrelation).toBe(1);
  });

  it("scores only players it both projected and has an outcome for, and says how many", async () => {
    // The rookie has an outcome and no projection; a projected player with no outcome is likewise
    // unscoreable. `sampleSize` is what stops a source being flattered by the players it skipped.
    const result = await replay(db, { season: 2024, weeks: [2], source: naiveSource, rules: PPR_SCORING, asOfForWeek });
    expect(result.overall.sampleSize).toBe(3);
  });

  it("pools every replayed week into the overall card", async () => {
    const result = await replay(db, { season: 2024, weeks: [2, 3], source: naiveSource, rules: PPR_SCORING, asOfForWeek });
    expect(result.overall.sampleSize).toBe(6);
    expect(result.weeks.every((week) => week.overall.sampleSize === 3)).toBe(true);
  });

  it("reports every rank band, present or empty — a band with no players says so", async () => {
    const result = await replay(db, { season: 2024, weeks: [2], source: naiveSource, rules: PPR_SCORING, asOfForWeek });
    expect(Object.keys(result.byRankBand)).toEqual(["elite", "starter", "deep", "fringe"]);
    expect(result.byRankBand.elite.sampleSize).toBe(3);
    expect(result.byRankBand.deep).toEqual({
      rankCorrelation: null,
      meanAbsoluteError: null,
      rootMeanSquaredError: null,
      sampleSize: 0,
    });
  });

  it("composes points through the league's own rules, not through one fixed scoring set", async () => {
    const noPpr = { ...PPR_SCORING, pointsPerReception: 0 };
    const ppr = await replay(db, { season: 2024, weeks: [2], source: naiveSource, rules: PPR_SCORING, asOfForWeek });
    const standard = await replay(db, { season: 2024, weeks: [2], source: naiveSource, rules: noPpr, asOfForWeek });
    expect(standard.overall.meanAbsoluteError).not.toBe(ppr.overall.meanAbsoluteError);
  });

  it("replays weeks in order however they are given", async () => {
    const { source, seen } = spySource();
    await replay(db, { season: 2024, weeks: [3, 2], source, rules: PPR_SCORING, asOfForWeek });
    expect(seen.map((input) => input.week)).toEqual([2, 3]);
  });

  it("refuses a week whose replay moment is unknown rather than inventing one", async () => {
    await expect(
      replay(db, { season: 2024, weeks: [9], source: naiveSource, rules: PPR_SCORING, asOfForWeek: () => undefined as never }),
    ).rejects.toThrow(/replay moment/i);
  });
});

/**
 * THE PER-PLAYER MOMENT, and the guarantee that makes it safe.
 *
 * `docs/research/2026-08-27-model-v3.md` found that four fifths of the injury wire is unreachable by
 * any whole-week replay moment, because one instant for the whole week must precede Thursday night
 * and the league files most of its report on the Friday. Replaying each man at his own game moves
 * that line, and the only thing standing between "moves the line" and "reads the future" is that a
 * player may still see nothing stamped after HIS OWN kickoff. That is what these two pin.
 */
describe("the per-player replay moment", () => {
  /** Thursday's club and Sunday's club, in the week being replayed. */
  const THURSDAY = new Date("2024-09-12T12:00:00.000Z");
  const SUNDAY = new Date("2024-09-15T12:00:00.000Z");
  const FRIDAY_FILING = new Date("2024-09-13T18:00:00.000Z");

  const asOfForPlayerGame = (week: number, team: string): Date | null =>
    week !== 2 ? null : team === "KC" ? THURSDAY : team === "BUF" ? SUNDAY : null;

  beforeEach(async () => {
    await recordPlayerTeams(db, [
      { season: 2024, week: 1, playerId: "star", team: "KC", asOf: RESULTS_KNOWN[1]! },
      { season: 2024, week: 1, playerId: "starter", team: "BUF", asOf: RESULTS_KNOWN[1]! },
    ]);
    // One designation about each man, filed on the Friday: after the Thursday game and before the
    // Sunday one. Exactly the row a whole-week moment can never reach.
    await recordObservations(
      db,
      ["star", "starter"].map((playerId) => ({
        season: 2024,
        week: 2,
        playerId,
        source: INJURY_SOURCE,
        metric: INJURY_METRICS.reportStatus,
        value: REPORT_STATUS.out,
        asOf: FRIDAY_FILING,
      })),
    );
  });

  it("READS THE FRIDAY FILING for the man who plays on Sunday, which no whole-week moment can", async () => {
    const { source, seen } = spySource();

    await replay(db, { season: 2024, weeks: [2], source, rules: PPR_SCORING, asOfForWeek, asOfForPlayerGame });

    expect(seen[0]!.news.map((row) => row.playerId)).toEqual(["starter"]);
  });

  it("REFUSES IT for the man whose own game was already played, which is the whole guarantee", async () => {
    const { source, seen } = spySource();

    await replay(db, { season: 2024, weeks: [2], source, rules: PPR_SCORING, asOfForWeek, asOfForPlayerGame });

    for (const row of seen[0]!.news) {
      const kickoff = asOfForPlayerGame(2, row.playerId === "star" ? "KC" : "BUF")!;
      expect(row.asOf.getTime()).toBeLessThanOrEqual(kickoff.getTime());
    }
    expect(seen[0]!.news.some((row) => row.playerId === "star")).toBe(false);
  });

  it("behaves exactly as before when no per-player moment is given", async () => {
    const { source, seen } = spySource();

    await replay(db, { season: 2024, weeks: [2], source, rules: PPR_SCORING, asOfForWeek });

    expect(seen[0]!.news).toEqual([]);
  });
});
