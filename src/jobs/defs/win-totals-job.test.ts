import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { Clock } from "@/domain/timing";
import { SCHEDULE_METRICS, SCHEDULE_SOURCE } from "@/projections/nflverse/schedule";
import { recordTeamObservations, teamObservationsAsOf } from "@/projections/team-store";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { VEGAS_METRICS, VEGAS_SOURCE } from "@/projections/vegas/ingest";
import { TerminalJobError } from "../contract";
import { parseWinTotalsPayload, runWinTotalsStep } from "./win-totals-job";

/** No network anywhere in here: every case drives a fixture `fetch`. */
const db = createTestDb();

const PUBLISHED_HEADER = "season,team,line,over_odds,under_odds,source,source_date";

const TEAMS = [
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
  "LA", "LAC", "LV", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS",
];

function csvFor(season: number, teams: readonly string[]): string {
  return [PUBLISHED_HEADER, ...teams.map((team) => `${season},${team},9.5,-110,-110,draftkings,${season}-07-04`)].join("\n");
}

function fetchReturning(body: string): typeof globalThis.fetch {
  return (async () => new Response(body, { status: 200 })) as unknown as typeof globalThis.fetch;
}

const CLOCK: Clock = { now: () => "2026-07-15T12:00:00.000Z" };

/** One scheduled game, so `firstKickoffFor` has a kickoff to compare the clock against. */
async function seedKickoff(database: Db, season: number, kickoff: string): Promise<void> {
  await recordTeamObservations(database, [
    // `firstKickoffFor` reads the kickoff instant off the row's own `asOf` stamp, under the
    // kickoff source — the same shape `scheduleObservations` writes.
    { season, week: 1, team: "BUF", source: SCHEDULE_SOURCE.kickoff, metric: SCHEDULE_METRICS.kickoffInstant, value: 1, asOf: new Date(kickoff) },
  ]);
}

describe("runWinTotalsStep", () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  it("writes a full league the publisher has posted, under the same stamp the committed file uses", async () => {
    const outcome = await runWinTotalsStep(db, CLOCK, { season: PRODUCT_SEASON }, { fetch: fetchReturning(csvFor(PRODUCT_SEASON, TEAMS)) });

    expect(outcome.summary).toContain("32 rows read");
    const stored = await teamObservationsAsOf(db, { season: PRODUCT_SEASON, week: 1, asOf: new Date(), source: VEGAS_SOURCE });
    expect(stored.filter((row) => row.metric === VEGAS_METRICS.winTotal)).toHaveLength(32);
    expect(stored.find((row) => row.team === "BUF" && row.metric === VEGAS_METRICS.winTotal)?.value).toBe(9.5);
  });

  it("writes nothing and says so when the publisher has posted only part of a league", async () => {
    const outcome = await runWinTotalsStep(db, CLOCK, { season: PRODUCT_SEASON }, { fetch: fetchReturning(csvFor(PRODUCT_SEASON, TEAMS.slice(0, 10))) });

    expect(outcome.summary).toContain("posted 10 team(s)");
    expect(outcome.summary).toContain("not posted yet");
    expect(await teamObservationsAsOf(db, { season: PRODUCT_SEASON, week: 1, asOf: new Date(), source: VEGAS_SOURCE })).toEqual([]);
  });

  it("skips entirely once the season has kicked off, without a fetch", async () => {
    await seedKickoff(db, PRODUCT_SEASON, "2026-09-10T00:20:00.000Z");
    let called = false;
    const spyFetch = (async () => {
      called = true;
      return new Response(csvFor(PRODUCT_SEASON, TEAMS), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    const outcome = await runWinTotalsStep(db, { now: () => "2026-09-20T12:00:00.000Z" }, { season: PRODUCT_SEASON }, { fetch: spyFetch });

    expect(outcome.summary).toContain("has kicked off");
    expect(called).toBe(false);
  });

  it("treats a renamed publisher column as terminal, since no retry ever fixes a rename", async () => {
    const broken = "season,team,win_total\n2026,BUF,10.5";
    await expect(runWinTotalsStep(db, CLOCK, { season: PRODUCT_SEASON }, { fetch: fetchReturning(broken) })).rejects.toBeInstanceOf(TerminalJobError);
  });
});

describe("parseWinTotalsPayload", () => {
  it("takes a season or nothing, and refuses anything else", () => {
    expect(parseWinTotalsPayload({})).toEqual({});
    expect(parseWinTotalsPayload({ season: 2026 })).toEqual({ season: 2026 });
    expect(() => parseWinTotalsPayload({ season: "2026" })).toThrow(/four-digit/);
    expect(() => parseWinTotalsPayload({ season: 26 })).toThrow(/four-digit/);
  });
});
