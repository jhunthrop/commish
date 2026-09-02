import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { nflPlayers } from "@/db/schema";
import { recordPropObservations } from "./props-store";
import {
  candidateSeasonRoster,
  distinctObservedPropNames,
  normalizePropName,
  observationCountsByPropName,
  playerIdForPropName,
  recordPropPlayerMap,
  resolvePropNames,
  seasonOfKickoff,
  type PlayerMapCandidate,
  type PropNameToResolve,
} from "./player-map";

describe("normalizePropName — the same reduction preseason/benchmarks.ts's normalizeName uses", () => {
  it("strips apostrophes and lowercases", () => {
    expect(normalizePropName("Ja'Marr Chase")).toBe("jamarr chase");
  });

  it("collapses a hyphen to a space", () => {
    expect(normalizePropName("Amon-Ra St. Brown")).toBe("amonra st brown");
  });

  it("strips periods from initials", () => {
    expect(normalizePropName("D.J. Moore")).toBe("dj moore");
  });

  it("drops a generational suffix", () => {
    expect(normalizePropName("Marvin Harrison Jr.")).toBe("marvin harrison");
  });

  it("normalizes diacritics away", () => {
    expect(normalizePropName("Pierre Strong")).toBe(normalizePropName("Pierré Strong"));
  });

  it("never strips a suffix word that is someone's entire first name", () => {
    expect(normalizePropName("Jr")).toBe("jr");
  });
});

describe("seasonOfKickoff — the NFL season a kickoff belongs to", () => {
  it("a September kickoff belongs to that calendar year's season", () => {
    expect(seasonOfKickoff(new Date("2023-09-08T00:20:00.000Z"))).toBe(2023);
  });

  it("a December kickoff belongs to that calendar year's season", () => {
    expect(seasonOfKickoff(new Date("2023-12-25T18:00:00.000Z"))).toBe(2023);
  });

  it("a January kickoff (week 18) belongs to the PREVIOUS calendar year's season", () => {
    expect(seasonOfKickoff(new Date("2024-01-07T21:00:00.000Z"))).toBe(2023);
  });

  it("a February kickoff (the Super Bowl) belongs to the previous calendar year's season", () => {
    expect(seasonOfKickoff(new Date("2024-02-11T23:30:00.000Z"))).toBe(2023);
  });
});

function candidate(over: Partial<PlayerMapCandidate> = {}): PlayerMapCandidate {
  return { playerId: "p1", name: "Josh Allen", ...over };
}

function toResolve(over: Partial<PropNameToResolve> = {}): PropNameToResolve {
  return { propName: "Josh Allen", season: 2023, ...over };
}

describe("resolvePropNames — normalization + ambiguity handling", () => {
  it("matches a name that agrees exactly with one season candidate", () => {
    const candidates = new Map([[2023, [candidate()]]]);
    const { matched, unmatched } = resolvePropNames([toResolve()], candidates);
    expect(unmatched).toEqual([]);
    expect(matched).toEqual([{ propName: "Josh Allen", season: 2023, playerId: "p1", method: "exact" }]);
  });

  it("matches through normalization (suffix, punctuation) even when the raw strings differ", () => {
    const candidates = new Map([[2023, [candidate({ playerId: "p2", name: "Marvin Harrison Jr." })]]]);
    const { matched } = resolvePropNames([toResolve({ propName: "Marvin Harrison" })], candidates);
    expect(matched).toEqual([{ propName: "Marvin Harrison", season: 2023, playerId: "p2", method: "exact" }]);
  });

  it("reports not_found when the season's roster holds no such name", () => {
    const candidates = new Map([[2023, [candidate({ name: "Somebody Else" })]]]);
    const { matched, unmatched } = resolvePropNames([toResolve()], candidates);
    expect(matched).toEqual([]);
    expect(unmatched).toEqual([{ propName: "Josh Allen", season: 2023, reason: "not_found" }]);
  });

  it("reports ambiguous, and matches NEITHER, when two season candidates share the exact normalized name", () => {
    const candidates = new Map([
      [2023, [candidate({ playerId: "qb" }), candidate({ playerId: "te" })]],
    ]);
    const { matched, unmatched } = resolvePropNames([toResolve()], candidates);
    expect(matched).toEqual([]);
    expect(unmatched).toEqual([{ propName: "Josh Allen", season: 2023, reason: "ambiguous" }]);
  });

  it("falls back to first-initial + surname when the full name matches nobody, and it is unique", () => {
    const candidates = new Map([[2023, [candidate({ playerId: "p3", name: "Joshua Allen" })]]]);
    const { matched } = resolvePropNames([toResolve({ propName: "Josh Allen" })], candidates);
    expect(matched).toEqual([{ propName: "Josh Allen", season: 2023, playerId: "p3", method: "loose" }]);
  });

  it("refuses the loose fallback when two candidates share the loose key", () => {
    const candidates = new Map([
      [2023, [candidate({ playerId: "p4", name: "Joshua Allen" }), candidate({ playerId: "p5", name: "Jordan Allen" })]],
    ]);
    const { matched, unmatched } = resolvePropNames([toResolve({ propName: "Josh Allen" })], candidates);
    expect(matched).toEqual([]);
    expect(unmatched).toEqual([{ propName: "Josh Allen", season: 2023, reason: "ambiguous" }]);
  });

  it("scopes candidates to the prop name's own season -- the same name resolves differently across seasons", () => {
    const candidates = new Map([
      [2023, [candidate({ playerId: "p-2023", name: "Josh Allen" })]],
      [2024, [candidate({ playerId: "p-2024", name: "Josh Allen" })]],
    ]);
    const { matched } = resolvePropNames([toResolve({ season: 2023 }), toResolve({ season: 2024 })], candidates);
    expect(matched.map((m) => [m.season, m.playerId])).toEqual([[2023, "p-2023"], [2024, "p-2024"]]);
  });

  it("reports not_found (not a crash) for a season with no candidates at all", () => {
    const { matched, unmatched } = resolvePropNames([toResolve({ season: 2099 })], new Map());
    expect(matched).toEqual([]);
    expect(unmatched).toEqual([{ propName: "Josh Allen", season: 2099, reason: "not_found" }]);
  });
});

const db = createTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("candidateSeasonRoster — the season-scoped candidate set from nfl_players", () => {
  beforeEach(async () => {
    await db.insert(nflPlayers).values([
      { id: "active-2023", name: "In Season", position: "WR", rookieSeason: 2020, lastSeason: 2024 },
      { id: "too-early", name: "Not Yet Drafted", position: "WR", rookieSeason: 2024, lastSeason: 2025 },
      { id: "already-gone", name: "Long Retired", position: "WR", rookieSeason: 2010, lastSeason: 2015 },
      { id: "no-career-span", name: "Unknown Span", position: "WR", rookieSeason: null, lastSeason: null },
    ]);
  });

  it("includes only players whose rookie-to-last-season span covers the requested season", async () => {
    const roster = await candidateSeasonRoster(db, 2023);
    expect(roster.map((r) => r.playerId)).toEqual(["active-2023"]);
  });

  it("excludes a player with no recorded career span rather than guessing they were active", async () => {
    const roster = await candidateSeasonRoster(db, 2023);
    expect(roster.some((r) => r.playerId === "no-career-span")).toBe(false);
  });
});

describe("distinctObservedPropNames — every (name, season) the archive has actually seen", () => {
  it("de-duplicates two bookmakers' rows for the same player and game into one (name, season) pair", async () => {
    await recordPropObservations(db, [
      { eventId: "e-week1", commenceTime: new Date("2023-09-10T17:00:00.000Z"), bookmaker: "dk", market: "player_pass_yds", playerName: "Josh Allen", point: 245.5, overPrice: -110, underPrice: -110, fetchedAt: new Date("2023-09-09T00:00:00.000Z") },
      { eventId: "e-week1", commenceTime: new Date("2023-09-10T17:00:00.000Z"), bookmaker: "fd", market: "player_pass_yds", playerName: "Josh Allen", point: 246.5, overPrice: -105, underPrice: -115, fetchedAt: new Date("2023-09-09T00:00:00.000Z") },
    ]);
    expect(await distinctObservedPropNames(db)).toEqual([{ propName: "Josh Allen", season: 2023 }]);
  });

  it("derives the season from commence_time -- a January game still belongs to the PREVIOUS season", async () => {
    await recordPropObservations(db, [
      { eventId: "e-week18", commenceTime: new Date("2024-01-07T21:00:00.000Z"), bookmaker: "dk", market: "player_rush_yds", playerName: "Josh Allen", point: 40.5, overPrice: -110, underPrice: -110, fetchedAt: new Date("2024-01-06T00:00:00.000Z") },
    ]);
    expect(await distinctObservedPropNames(db)).toEqual([{ propName: "Josh Allen", season: 2023 }]);
  });

  it("keeps two different seasons' rows for the same name apart", async () => {
    await recordPropObservations(db, [
      { eventId: "e1", commenceTime: new Date("2023-09-10T17:00:00.000Z"), bookmaker: "dk", market: "player_pass_yds", playerName: "Josh Allen", point: 245.5, overPrice: -110, underPrice: -110, fetchedAt: new Date("2023-09-09T00:00:00.000Z") },
      { eventId: "e2", commenceTime: new Date("2024-09-08T17:00:00.000Z"), bookmaker: "dk", market: "player_pass_yds", playerName: "Josh Allen", point: 250.5, overPrice: -110, underPrice: -110, fetchedAt: new Date("2024-09-07T00:00:00.000Z") },
    ]);
    expect(await distinctObservedPropNames(db)).toEqual(
      expect.arrayContaining([{ propName: "Josh Allen", season: 2023 }, { propName: "Josh Allen", season: 2024 }]),
    );
  });
});

describe("observationCountsByPropName — the observation-weighted match-rate input", () => {
  it("counts every archived row per (name, season), not just distinct names", async () => {
    await recordPropObservations(db, [
      { eventId: "e1", commenceTime: new Date("2023-09-10T17:00:00.000Z"), bookmaker: "dk", market: "player_pass_yds", playerName: "Josh Allen", point: 245.5, overPrice: -110, underPrice: -110, fetchedAt: new Date("2023-09-09T00:00:00.000Z") },
      { eventId: "e1", commenceTime: new Date("2023-09-10T17:00:00.000Z"), bookmaker: "fd", market: "player_pass_yds", playerName: "Josh Allen", point: 246.5, overPrice: -105, underPrice: -115, fetchedAt: new Date("2023-09-09T00:00:00.000Z") },
      { eventId: "e2", commenceTime: new Date("2023-09-11T00:20:00.000Z"), bookmaker: "dk", market: "player_receptions", playerName: "Stefon Diggs", point: 5.5, overPrice: -120, underPrice: 100, fetchedAt: new Date("2023-09-09T00:00:00.000Z") },
    ]);
    const counts = await observationCountsByPropName(db);
    expect(counts.get("Josh Allen|2023")).toBe(2);
    expect(counts.get("Stefon Diggs|2023")).toBe(1);
  });
});

describe("recordPropPlayerMap / playerIdForPropName — the builder and the reader", () => {
  beforeEach(async () => {
    await db.insert(nflPlayers).values([{ id: "p1", name: "Josh Allen", position: "QB", rookieSeason: 2018, lastSeason: 2026 }]);
  });

  it("writes a resolved mapping and reads it back", async () => {
    const written = await recordPropPlayerMap(db, [{ propName: "Josh Allen", season: 2023, playerId: "p1", method: "exact" }]);
    expect(written).toBe(1);
    expect(await playerIdForPropName(db, "Josh Allen", 2023)).toBe("p1");
  });

  it("returns null for a name/season the map holds nothing for", async () => {
    expect(await playerIdForPropName(db, "Nobody", 2023)).toBeNull();
  });

  it("is idempotent -- re-recording the same mapping writes nothing new", async () => {
    await recordPropPlayerMap(db, [{ propName: "Josh Allen", season: 2023, playerId: "p1", method: "exact" }]);
    const second = await recordPropPlayerMap(db, [{ propName: "Josh Allen", season: 2023, playerId: "p1", method: "exact" }]);
    expect(second).toBe(0);
  });
});
