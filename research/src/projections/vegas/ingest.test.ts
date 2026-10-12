import { afterAll, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@research/db/test-db";
import {
  fetchPublishedWinTotals,
  normalizePublishedTeam,
  parseWinTotalsCsv,
  VEGAS_METRICS,
  VEGAS_SOURCE,
  winTotalObservations,
  type WinTotalRow,
} from "./ingest";

const db = createTestDb();

const HEADER = "season,team,win_total,over_price,under_price,actual_wins,source,source_date";

function row(overrides: Partial<WinTotalRow> = {}): WinTotalRow {
  return {
    season: 2024,
    team: "BUF",
    winTotal: 10.5,
    overPrice: -115,
    underPrice: -105,
    actualWins: 11,
    source: "not_tracked",
    sourceDate: "2024-08-30T00:00:00.000Z",
    ...overrides,
  };
}

describe("winTotalObservations — the pure CSV-row-to-store mapping", () => {
  it("writes exactly the three metrics, one row each, at week one", () => {
    const observations = winTotalObservations([row()]);
    expect(observations).toHaveLength(3);
    expect(observations.every((o) => o.week === 1)).toBe(true);
    expect(observations.every((o) => o.season === 2024 && o.team === "BUF")).toBe(true);
    expect(observations.every((o) => o.source === VEGAS_SOURCE)).toBe(true);
    expect(new Set(observations.map((o) => o.metric))).toEqual(
      new Set([VEGAS_METRICS.winTotal, VEGAS_METRICS.overPrice, VEGAS_METRICS.underPrice]),
    );
  });

  it("stamps every observation at the row's own source_date, not at ingest time", () => {
    const observations = winTotalObservations([row({ sourceDate: "2003-08-30T00:00:00.000Z" })]);
    expect(observations.every((o) => o.asOf.toISOString() === "2003-08-30T00:00:00.000Z")).toBe(true);
  });

  it("never writes actual_wins — Task 3's own delta reads it from the schedule store, not this CSV", () => {
    const observations = winTotalObservations([row({ actualWins: 14 })]);
    expect(observations.map((o) => o.metric)).not.toContain("actual_wins");
    expect(observations).toHaveLength(3);
  });

  it("carries each row's own value onto the matching metric", () => {
    const observations = winTotalObservations([row({ winTotal: 9.5, overPrice: 120, underPrice: -145 })]);
    const byMetric = new Map(observations.map((o) => [o.metric, o.value]));
    expect(byMetric.get(VEGAS_METRICS.winTotal)).toBe(9.5);
    expect(byMetric.get(VEGAS_METRICS.overPrice)).toBe(120);
    expect(byMetric.get(VEGAS_METRICS.underPrice)).toBe(-145);
  });

  it("refuses an unparseable source_date rather than storing a NaN stamp", () => {
    expect(() => winTotalObservations([row({ sourceDate: "not-a-date" })])).toThrow(/source_date/);
  });

  it("keeps two teams in the same season apart", () => {
    const observations = winTotalObservations([row({ team: "BUF" }), row({ team: "NYJ", winTotal: 7 })]);
    expect(observations).toHaveLength(6);
    expect(new Set(observations.map((o) => o.team))).toEqual(new Set(["BUF", "NYJ"]));
  });
});

describe("parseWinTotalsCsv — re-exported from Task 1's validator, same reader", () => {
  it("parses a well-formed row", () => {
    const text = `${HEADER}\n2024,BUF,10.5,-115,-105,11,not_tracked,2024-08-30T00:00:00.000Z\n`;
    expect(parseWinTotalsCsv(text)).toEqual([row()]);
  });
});

// The file-to-store path (`ingestWinTotalsCsv`) is proven in `scripts/lib/win-totals-csv.test.ts`,
// where the filesystem read moved (file-sourced data round, 2026-09-09).

afterAll(async () => {
  await truncateAll(db);
});

/**
 * THE PUBLISHER READ (dossier-voice round §3.6) — a fixture `fetch`, never the network: the round's
 * rule is that no test reaches out, and the behaviour under test is the shape assertion, the team
 * normalization and the "not posted" path, none of which needs a live publisher.
 */
describe("fetchPublishedWinTotals", () => {
  const PUBLISHED_HEADER = "season,team,line,over_odds,under_odds,source,source_date";

  function publishedCsv(lines: readonly string[]): string {
    return [PUBLISHED_HEADER, ...lines].join("\n");
  }

  function fetchReturning(body: string, status = 200): typeof globalThis.fetch {
    return (async () => new Response(body, { status })) as unknown as typeof globalThis.fetch;
  }

  /** A full league for one season, so `posted` is true. */
  function fullSeason(season: number, teams: readonly string[]): readonly string[] {
    return teams.map((team, index) => `${season},${team},${8 + (index % 3)}.5,-110,-110,draftkings,${season}-07-04`);
  }

  const TEAMS_2026 = [
    "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
    "LA", "LAC", "LV", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS",
  ];

  it("reads one season's rows and reports a full league as posted", async () => {
    const fetchMock = fetchReturning(publishedCsv([...fullSeason(2026, TEAMS_2026), "2025,BUF,11.5,-120,100,draftkings,2025-07-04"]));
    const published = await fetchPublishedWinTotals(2026, { fetch: fetchMock });

    expect(published.posted).toBe(true);
    expect(published.teamsPosted).toBe(32);
    expect(published.rows).toHaveLength(32);
    expect(published.rows.every((row) => row.season === 2026)).toBe(true);
    expect(published.rows[0]).toMatchObject({ team: "ARI", overPrice: -110, underPrice: -110, actualWins: null });
  });

  it("says a season nobody has posted is not posted, and writes nothing to say it with", async () => {
    const fetchMock = fetchReturning(publishedCsv(fullSeason(2025, TEAMS_2026)));
    const published = await fetchPublishedWinTotals(2026, { fetch: fetchMock });

    expect(published.posted).toBe(false);
    expect(published.teamsPosted).toBe(0);
    expect(published.rows).toEqual([]);
  });

  it("treats a half-posted season as not posted, never as a board where some teams have a market", async () => {
    const fetchMock = fetchReturning(publishedCsv(fullSeason(2026, TEAMS_2026.slice(0, 12))));
    const published = await fetchPublishedWinTotals(2026, { fetch: fetchMock });

    expect(published.posted).toBe(false);
    expect(published.teamsPosted).toBe(12);
  });

  it("refuses a file whose shape has changed, naming the column it wanted", async () => {
    const fetchMock = fetchReturning("season,team,win_total\n2026,BUF,10.5");
    await expect(fetchPublishedWinTotals(2026, { fetch: fetchMock })).rejects.toThrow(/no "line" column/);
  });

  it("refuses an empty file and a refused request rather than reading them as a quiet preseason", async () => {
    await expect(fetchPublishedWinTotals(2026, { fetch: fetchReturning(PUBLISHED_HEADER) })).rejects.toThrow(/no rows/);
    await expect(fetchPublishedWinTotals(2026, { fetch: fetchReturning("nope", 500) })).rejects.toThrow(/HTTP 500/);
  });

  it("normalizes the two team codes the publisher spells differently", () => {
    expect(normalizePublishedTeam("LAR", 2026)).toBe("LA");
    expect(normalizePublishedTeam("OAK", 2026)).toBe("LV");
    expect(normalizePublishedTeam("OAK", 2019)).toBe("OAK");
    expect(normalizePublishedTeam("BUF", 2026)).toBe("BUF");
  });
});
