import { describe, expect, it } from "vitest";
import { BENCHMARK_BOARD_FLOOR, normalizeName, resolveRankings, type RankingCandidate, type RosterIdentity } from "./benchmarks";
import { parseAverageDraftPosition, parseExpertConsensus, type FfcResponse } from "./publishers";
import { HISTORICAL_ROSTER_FLOOR } from "../nflverse/rosters";

/**
 * A name join is the thing this codebase otherwise refuses to do, so the tests are about the two
 * failure modes that matter: a WRONG match puts one man's market price on another's board line and
 * is invisible forever after, while an UNRESOLVED one shows up in the resolution rate. Every rule
 * here is built so an ambiguous case fails the second way.
 */

const ROSTER: readonly RosterIdentity[] = [
  { playerId: "gsis-allen-qb", name: "Josh Allen", position: "QB", team: "BUF" },
  { playerId: "gsis-allen-lb", name: "Josh Allen", position: "LB", team: "JAX" },
  { playerId: "gsis-chase", name: "Ja'Marr Chase", position: "WR", team: "CIN" },
  { playerId: "gsis-stbrown", name: "Amon-Ra St. Brown", position: "WR", team: "DET" },
  { playerId: "gsis-palmer", name: "Joshua Palmer", position: "WR", team: "LAC" },
  { playerId: "gsis-juszczyk", name: "Kyle Juszczyk", position: "FB", team: "SF" },
  { playerId: "gsis-smith-a", name: "Aaron Smith", position: "WR", team: "NYJ" },
  { playerId: "gsis-smith-b", name: "Adam Smith", position: "WR", team: "NYG" },
];

function candidate(overrides: Partial<RankingCandidate> = {}): RankingCandidate {
  return { name: "Josh Allen", position: "QB", team: "BUF", rank: 26.4, ...overrides };
}

describe("normalizeName", () => {
  it("reduces a name to what two publishers can be expected to agree on", () => {
    expect(normalizeName("Ja'Marr Chase")).toBe("jamarr chase");
    expect(normalizeName("Amon-Ra St. Brown")).toBe("amonra st brown");
    expect(normalizeName("D.J. Moore")).toBe("dj moore");
    expect(normalizeName("Marvin Harrison Jr.")).toBe("marvin harrison");
  });

  it("strips diacritics rather than treating them as different letters", () => {
    expect(normalizeName("Pierre Strong")).toBe(normalizeName("Pierré Strong"));
  });

  it("keeps a suffix that is the only surname there is", () => {
    // Dropping every suffix token unconditionally would reduce a one-word name to nothing.
    expect(normalizeName("Jr")).toBe("jr");
  });
});

describe("resolveRankings", () => {
  it("matches on name and position and returns the universe id", () => {
    const resolution = resolveRankings([candidate()], ROSTER);
    expect(resolution.resolved).toEqual([{ playerId: "gsis-allen-qb", rank: 26.4 }]);
    expect(resolution.resolutionRate).toBe(1);
  });

  it("SETTLES THE TWO JOSH ALLENS by position, which is the case a name join cannot do alone", () => {
    expect(resolveRankings([candidate({ position: "LB" })], ROSTER).resolved[0]!.playerId).toBe("gsis-allen-lb");
  });

  it("narrows a shared name and position by team", () => {
    const twins: readonly RosterIdentity[] = [
      { playerId: "a", name: "Mike Williams", position: "WR", team: "NYJ" },
      { playerId: "b", name: "Mike Williams", position: "WR", team: "LAC" },
    ];
    expect(resolveRankings([candidate({ name: "Mike Williams", position: "WR", team: "LAC" })], twins).resolved[0]!.playerId).toBe("b");
  });

  it("MATCHES NEITHER when two people share a name and position and the team does not separate them", () => {
    // A coin flip would put a real market price on the wrong man, and nothing downstream could see
    // it. An unresolved line is visible in the resolution rate.
    const twins: readonly RosterIdentity[] = [
      { playerId: "a", name: "Mike Williams", position: "WR", team: "NYJ" },
      { playerId: "b", name: "Mike Williams", position: "WR", team: "LAC" },
    ];
    const resolution = resolveRankings([candidate({ name: "Mike Williams", position: "WR", team: null })], twins);
    expect(resolution.resolved).toHaveLength(0);
    expect(resolution.unresolved).toHaveLength(1);
  });

  it("narrows both sides' position spellings, so a fullback matches a running back", () => {
    expect(resolveRankings([candidate({ name: "Kyle Juszczyk", position: "RB", team: "SF" })], ROSTER).resolved[0]!.playerId).toBe(
      "gsis-juszczyk",
    );
  });

  it("falls back to a surname and a first initial only when exactly one person answers to it", () => {
    // `Josh Palmer` and `Joshua Palmer` are the same man beyond any doubt, and publishers disagree
    // about given names far more often than about surnames.
    expect(resolveRankings([candidate({ name: "Josh Palmer", position: "WR", team: "LAC" })], ROSTER).resolved[0]!.playerId).toBe(
      "gsis-palmer",
    );
  });

  it("REFUSES the loose fallback where two people would answer to it", () => {
    // Aaron and Adam Smith share a surname, a first initial and a position. The loosening must not
    // start joining brothers together.
    const resolution = resolveRankings([candidate({ name: "Andrew Smith", position: "WR", team: "NYJ" })], ROSTER);
    expect(resolution.resolved).toHaveLength(0);
  });

  /**
   * THE TWO POSITIONS THIS RESOLVER USED TO LOSE ENTIRELY (the 2026-09-05 round). Measured against
   * the real 2025 FFC board: 249 rows published, 205 resolved, and every one of the 44 misses was a
   * kicker (published as `PK`, spelled `K` on the roster) or a team defence (not a person, so it has
   * no roster row and never will). The store therefore held no market price for either position,
   * which is what gate G2 and the market-order fallback both need.
   */
  it("places a team defence by TEAM CODE, since it is not a person and has no roster row", () => {
    const resolution = resolveRankings(
      [candidate(), candidate({ name: "Buffalo Bills", position: "DST", team: "BUF" })],
      ROSTER,
    );
    expect(resolution.resolved).toHaveLength(2);
    expect(resolution.resolved.map((row) => row.playerId)).toContain("team-def:BUF");
    expect(resolution.unresolved).toEqual([]);
    expect(resolution.resolutionRate).toBe(1);
  });

  it("absorbs the market's own mixed team spellings, which are neither feed's consistently", () => {
    // The real board carries `LAR` (the product's spelling) and `WAS` (the source's) in one list.
    const resolution = resolveRankings(
      [
        candidate({ name: "Los Angeles Rams", position: "DEF", team: "LAR" }),
        candidate({ name: "Washington Commanders", position: "DEF", team: "WAS" }),
      ],
      ROSTER,
    );
    expect(resolution.resolved.map((row) => row.playerId)).toEqual(["team-def:LA", "team-def:WAS"]);
  });

  it("leaves a defence whose team code neither feed answers to unresolved, rather than guessing", () => {
    const resolution = resolveRankings([candidate({ name: "Nowhere Defense", position: "DEF", team: "XXX" })], ROSTER);
    expect(resolution.resolved).toEqual([]);
    expect(resolution.unresolved.map((row) => row.name)).toEqual(["Nowhere Defense"]);
  });

  it("never lists one club's defence twice, however a publisher spells it", () => {
    const resolution = resolveRankings(
      [
        candidate({ name: "Los Angeles Rams", position: "DEF", team: "LAR", rank: 90 }),
        candidate({ name: "LA Rams D/ST", position: "D/ST", team: "LAR", rank: 140 }),
      ],
      ROSTER,
    );
    expect(resolution.resolved).toEqual([{ playerId: "team-def:LA", rank: 90 }]);
    expect(resolution.unresolved).toHaveLength(1);
  });

  it("places a kicker the market publishes as PK against a roster that spells him K", () => {
    const resolution = resolveRankings(
      [candidate({ name: "Tyler Bass", position: "PK", team: "BUF" })],
      [...ROSTER, { playerId: "gsis-bass-k", name: "Tyler Bass", position: "K", team: "BUF" }],
    );
    expect(resolution.resolved.map((row) => row.playerId)).toEqual(["gsis-bass-k"]);
  });

  it("keeps the better rank when a publisher lists the same man twice", () => {
    const resolution = resolveRankings([candidate({ rank: 12 }), candidate({ rank: 40 })], ROSTER);
    expect(resolution.resolved).toEqual([{ playerId: "gsis-allen-qb", rank: 12 }]);
  });

  it("says the rate is unknown for an empty board rather than claiming a perfect one", () => {
    expect(resolveRankings([], ROSTER).resolutionRate).toBeNull();
  });
});

describe("parseExpertConsensus", () => {
  const page = (body: string): string => `<html><script>var ecrData = ${body};\n</script></html>`;
  /** Long after any season this suite names, so the convention stamp wins and these tests are
   *  about the parser rather than about the clock. */
  const READ_AT = new Date("2030-01-01T00:00:00.000Z");

  it("reads the board out of the page's embedded JSON", () => {
    const board = parseExpertConsensus(
      page(
        JSON.stringify({
          year: "2024",
          last_updated: "9/06",
          players: [{ player_name: "CeeDee Lamb", player_position_id: "WR", player_team_id: "DAL", rank_ecr: 1 }],
        }),
      ),
      2024,
      READ_AT,
    );
    expect(board.candidates).toEqual([{ name: "CeeDee Lamb", position: "WR", team: "DAL", rank: 1 }]);
    expect(board.publisherStamp).toBe("9/06");
  });

  it("reads the archive's own FA placeholder as NO team rather than as a club called FA", () => {
    const board = parseExpertConsensus(
      page(
        JSON.stringify({
          year: "2024",
          players: [{ player_name: "Tyreek Hill", player_position_id: "WR", player_team_id: "FA", rank_ecr: 3 }],
        }),
      ),
      2024,
      READ_AT,
    );
    expect(board.candidates[0]!.team).toBeNull();
  });

  it("THROWS when the page shape changes, because a scrape's failure mode is a silent empty board", () => {
    expect(() => parseExpertConsensus("<html>nothing here</html>", 2024, READ_AT)).toThrow(/no ecrData block/);
  });

  it("throws rather than scoring one season's consensus against another's outcomes", () => {
    expect(() => parseExpertConsensus(page(JSON.stringify({ year: "2023", players: [] })), 2024, READ_AT)).toThrow(
      /board for 2023 when asked for 2024/,
    );
  });

  /**
   * THE STAMP CANNOT CLAIM THE FUTURE. Asked for a season that has not started, the September
   * convention would date a board we are holding today to eleven days from now, and a present-tense
   * reader gating on `as_of <= now` would print a dash beside a number we already have.
   */
  it("stamps a board we read before its convention date with the moment we read it", () => {
    const board = parseExpertConsensus(
      page(JSON.stringify({ year: "2026", players: [{ player_name: "Ja'Marr Chase", player_position_id: "WR", rank_ecr: 1 }] })),
      2026,
      new Date("2026-08-28T12:00:00.000Z"),
    );
    expect(board.publishedAt).toEqual(new Date("2026-08-28T12:00:00.000Z"));
  });

  it("leaves an archived board on the published convention, so no measurement moves", () => {
    const board = parseExpertConsensus(
      page(JSON.stringify({ year: "2024", players: [{ player_name: "CeeDee Lamb", player_position_id: "WR", rank_ecr: 1 }] })),
      2024,
      READ_AT,
    );
    expect(board.publishedAt).toEqual(new Date(Date.UTC(2024, 8, 8)));
  });

  it("throws on a board with no ranked players at all", () => {
    expect(() => parseExpertConsensus(page(JSON.stringify({ year: "2024", players: [] })), 2024, READ_AT)).toThrow(
      /no ranked players/,
    );
  });
});

describe("parseAverageDraftPosition", () => {
  /** Long after any season this suite names, so the convention stamp wins and these tests are
   *  about the parser rather than about the clock — the identical fixture `parseExpertConsensus`'s
   *  own describe block uses, for the identical reason. */
  const READ_AT = new Date("2030-01-01T00:00:00.000Z");

  const body = (overrides: Partial<FfcResponse> = {}): FfcResponse => ({
    meta: { end_date: "2024-08-27" },
    players: [{ name: "CeeDee Lamb", position: "WR", team: "DAL", adp: 1.4 }],
    ...overrides,
  });

  it("reads the board out of the feed's own JSON body", () => {
    const board = parseAverageDraftPosition(body(), 2024, READ_AT);
    expect(board.candidates).toEqual([{ name: "CeeDee Lamb", position: "WR", team: "DAL", rank: 1.4 }]);
    expect(board.publisherStamp).toBe("2024-08-27");
  });

  it("throws on a board with no ranked players at all", () => {
    expect(() => parseAverageDraftPosition(body({ players: [] }), 2024, READ_AT)).toThrow(
      /published no 2024 board/,
    );
  });

  it("throws on a board with no draft window, rather than treating an undated market price as a benchmark", () => {
    expect(() => parseAverageDraftPosition(body({ meta: {} }), 2024, READ_AT)).toThrow(/carries no draft window/);
    expect(() => parseAverageDraftPosition(body({ meta: { end_date: "not-a-date" } }), 2024, READ_AT)).toThrow(
      /carries no draft window/,
    );
  });

  it("leaves an ARCHIVED board on the published convention (the day after its window closed), so no past measurement moves", () => {
    // READ_AT is 2030 — long after 2024's window closed — so the convention is the earlier of the
    // two and must win exactly as it always has.
    const board = parseAverageDraftPosition(body({ meta: { end_date: "2024-08-27" } }), 2024, READ_AT);
    expect(board.publishedAt).toEqual(new Date(Date.UTC(2024, 7, 28)));
  });

  /**
   * THE STAMP CANNOT CLAIM THE FUTURE (live-board plan, Task 4 fix round — the identical defect
   * `parseExpertConsensus`'s own equivalent test already pins). Fetched WHILE the CURRENT season's
   * draft window is still open, the day-after convention would date data we are holding right now
   * to tomorrow, and a live board's `now`-bounded gate would find nothing.
   */
  it("stamps a board fetched before its convention date with the moment we fetched it", () => {
    const fetchedAt = new Date("2026-09-01T15:00:00.000Z");
    const board = parseAverageDraftPosition(body({ meta: { end_date: "2026-09-01" } }), 2026, fetchedAt);
    expect(board.publishedAt).toEqual(fetchedAt);
  });

  it("is exactly the boundary, not past it: a fetch at the instant the convention would stamp still takes the convention", () => {
    const convention = new Date(Date.UTC(2026, 8, 2)); // 2026-09-01's end_date, +1 day
    const board = parseAverageDraftPosition(body({ meta: { end_date: "2026-09-01" } }), 2026, convention);
    expect(board.publishedAt).toEqual(convention);
  });
});

/**
 * THE MARKET FEED'S OWN FLOOR, PINNED SEPARATELY FROM THE ROSTER FLOOR (fit-round Task 1).
 *
 * `market-curve-fit.ts` and `blend-fit.ts` used to start their train window at
 * `HISTORICAL_ROSTER_FLOOR`, which was right only while the two numbers agreed. The roster floor
 * moved to 2003; the ADP boards did not and cannot. This assertion is what stops the two being
 * conflated again — if a future round moves the roster floor, nothing here follows it.
 */
describe("BENCHMARK_BOARD_FLOOR", () => {
  it("records the earliest season this store holds a published ADP board for, and is not the roster floor", () => {
    expect(BENCHMARK_BOARD_FLOOR).toBe(2013);
    expect(BENCHMARK_BOARD_FLOOR).not.toBe(HISTORICAL_ROSTER_FLOOR);
    expect(BENCHMARK_BOARD_FLOOR).toBeGreaterThan(HISTORICAL_ROSTER_FLOOR);
  });
});
