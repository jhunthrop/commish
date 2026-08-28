import { describe, expect, it } from "vitest";
import { normalizeName, resolveRankings, type RankingCandidate, type RosterIdentity } from "./benchmarks";
import { parseExpertConsensus } from "./publishers";

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

  it("leaves a kicker or a team defence unresolved rather than guessing, and says so in the rate", () => {
    const resolution = resolveRankings(
      [candidate(), candidate({ name: "Buffalo Bills", position: "DST", team: "BUF" })],
      ROSTER,
    );
    expect(resolution.resolved).toHaveLength(1);
    expect(resolution.unresolved.map((row) => row.name)).toEqual(["Buffalo Bills"]);
    expect(resolution.resolutionRate).toBe(0.5);
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
    );
    expect(board.candidates[0]!.team).toBeNull();
  });

  it("THROWS when the page shape changes, because a scrape's failure mode is a silent empty board", () => {
    expect(() => parseExpertConsensus("<html>nothing here</html>", 2024)).toThrow(/no ecrData block/);
  });

  it("throws rather than scoring one season's consensus against another's outcomes", () => {
    expect(() => parseExpertConsensus(page(JSON.stringify({ year: "2023", players: [] })), 2024)).toThrow(
      /board for 2023 when asked for 2024/,
    );
  });

  it("throws on a board with no ranked players at all", () => {
    expect(() => parseExpertConsensus(page(JSON.stringify({ year: "2024", players: [] })), 2024)).toThrow(
      /no ranked players/,
    );
  });
});
